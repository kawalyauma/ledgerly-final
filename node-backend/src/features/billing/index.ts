import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";
import type { BackendFeature } from "../types.js";
import { isPlanKey, PLAN_NAMES, PLAN_RATES, PREMIUM_API_PREFIXES, type PlanKey } from "./plans.js";
import { encryptApiKey, isConfigured, loadSsentezoConfig, normalizeMsisdn, requestDeposit, transactionStatus, walletBalance } from "./ssentezo.js";

type Row = Record<string, any>;
const MIN_PAYMENT = 500, MAX_PAYMENT = 7_000_000;

/* ------------------------------------------------------------------ plan & term */

export async function subscriptionOf(runtime: Runtime, organizationId: string) {
  const row = (await runtime.db.query<Row>(`SELECT plan,status,notes,updated_at FROM billing_subscriptions WHERE organization_id=$1`, [organizationId])).rows[0];
  const plan: PlanKey = isPlanKey(row?.plan) ? row!.plan : "free";
  return { plan, status: (row?.status ?? "active") as "active" | "suspended", notes: (row?.notes ?? null) as string | null };
}

/** The school's current term (from School setup), else the calendar third of the year. */
async function currentPeriod(runtime: Runtime, organizationId: string) {
  const term = await runtime.db.query<Row>(`SELECT t.id,t.name,t.starts_on::text starts_on,t.ends_on::text ends_on,y.name year_name
      FROM school_terms t LEFT JOIN school_academic_years y ON y.id=t.academic_year_id AND y.organization_id=t.organization_id
      WHERE t.organization_id=$1 AND (CURRENT_DATE BETWEEN t.starts_on AND t.ends_on OR t.is_current)
      ORDER BY (CURRENT_DATE BETWEEN t.starts_on AND t.ends_on) DESC, t.is_current DESC, t.starts_on DESC LIMIT 1`, [organizationId]).catch(() => ({ rows: [] as Row[] }));
  const t = term.rows[0];
  if (t) return { key: `term:${t.id}`, label: [t.name, t.year_name].filter(Boolean).join(" · "), startsOn: t.starts_on as string | null, endsOn: t.ends_on as string | null };
  const now = new Date(), year = now.getFullYear(), third = Math.floor(now.getMonth() / 4);
  const pad = (n: number) => String(n).padStart(2, "0"), start = `${year}-${pad(third * 4 + 1)}-01`;
  const end = new Date(Date.UTC(year, third * 4 + 4, 0)).toISOString().slice(0, 10);
  return { key: `${year}-T${third + 1}`, label: `Term ${third + 1} · ${year}`, startsOn: start, endsOn: end };
}

async function activeStudents(runtime: Runtime, organizationId: string) {
  const r = await runtime.db.query<Row>(`SELECT COUNT(*)::int n FROM school_students WHERE organization_id=$1 AND deleted_at IS NULL AND status='active'`, [organizationId]).catch(() => ({ rows: [{ n: 0 }] }));
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Current-term invoice, created on first use. Billing uses the term's peak active-student
 * count, so the amount can grow as students join but withdrawals never shrink it.
 */
export async function syncCurrentInvoice(runtime: Runtime, organizationId: string) {
  const [sub, period, students] = await Promise.all([subscriptionOf(runtime, organizationId), currentPeriod(runtime, organizationId), activeStudents(runtime, organizationId)]);
  const rate = PLAN_RATES[sub.plan];
  if (!rate) return { sub, period, students, invoice: null as Row | null };
  const existing = (await runtime.db.query<Row>(`SELECT * FROM billing_invoices WHERE organization_id=$1 AND period_key=$2`, [organizationId, period.key])).rows[0];
  if (!existing) {
    const id = createId("binv"), amount = students * rate;
    const row = (await runtime.db.query<Row>(`INSERT INTO billing_invoices(id,organization_id,period_key,period_label,starts_on,ends_on,plan,rate_ugx,students,amount_ugx,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (organization_id,period_key) DO NOTHING RETURNING *`,
      [id, organizationId, period.key, period.label, period.startsOn, period.endsOn, sub.plan, rate, students, amount, amount > 0 ? "open" : "paid"])).rows[0];
    if (row) return { sub, period, students, invoice: row };
  }
  const row = (await runtime.db.query<Row>(`UPDATE billing_invoices SET
        plan=$3, rate_ugx=$4, students=GREATEST(students,$5), amount_ugx=GREATEST(students,$5)*$4,
        status=CASE WHEN status='void' THEN 'void' WHEN paid_ugx >= GREATEST(students,$5)*$4 THEN 'paid' ELSE 'open' END,
        updated_at=CURRENT_TIMESTAMP
      WHERE organization_id=$1 AND period_key=$2 AND status<>'void' RETURNING *`, [organizationId, period.key, sub.plan, rate, students])).rows[0];
  return { sub, period, students, invoice: row ?? existing ?? null };
}

const invoiceOut = (r: Row | null | undefined) => r ? ({
  id: r.id, periodKey: r.period_key, periodLabel: r.period_label, startsOn: r.starts_on, endsOn: r.ends_on, plan: r.plan,
  rateUgx: Number(r.rate_ugx), students: Number(r.students), amountUgx: Number(r.amount_ugx), paidUgx: Number(r.paid_ugx),
  balanceUgx: Math.max(0, Number(r.amount_ugx) - Number(r.paid_ugx)), status: r.status, createdAt: r.created_at,
}) : null;
const paymentOut = (r: Row) => ({
  id: r.id, invoiceId: r.invoice_id, provider: r.provider, reference: r.external_reference, msisdn: r.msisdn, amountUgx: Number(r.amount_ugx),
  status: r.status, failureReason: r.failure_reason, note: r.note, createdAt: r.created_at, completedAt: r.completed_at,
});

/* ------------------------------------------------------------------ settlement */

/** Re-read the provider status and apply it once. Callers never trust callback bodies. */
export async function settlePayment(runtime: Runtime, externalReference: string) {
  const payment = (await runtime.db.query<Row>(`SELECT * FROM billing_payments WHERE external_reference=$1`, [externalReference])).rows[0];
  if (!payment || payment.provider !== "ssentezo" || ["succeeded", "failed"].includes(payment.status)) return payment;
  let data: Record<string, unknown>;
  try { data = await transactionStatus(await loadSsentezoConfig(runtime), externalReference); }
  catch (error) { runtime.logger.warn({ externalReference, error: error instanceof Error ? error.message : String(error) }, "Ssentezo status check failed"); return payment; }
  const status = String(data.transactionStatus ?? "").toUpperCase();
  const next = status === "SUCCEEDED" ? "succeeded" : status === "FAILED" ? "failed" : status === "INDETERMINATE" ? "indeterminate" : "pending";
  if (next === payment.status) return payment;
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const updated = (await client.query<Row>(`UPDATE billing_payments SET status=$2, provider_reference=COALESCE($3,provider_reference), financial_transaction_id=COALESCE($4,financial_transaction_id),
        completed_at=CASE WHEN $2 IN ('succeeded','failed') THEN CURRENT_TIMESTAMP ELSE completed_at END, updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status NOT IN ('succeeded','failed') RETURNING *`,
      [payment.id, next, data.ssentezoWalletReference ?? null, data.financialTransactionId ?? null])).rows[0];
    if (updated && next === "succeeded" && updated.invoice_id) {
      await client.query(`UPDATE billing_invoices SET paid_ugx=paid_ugx+$2, status=CASE WHEN paid_ugx+$2>=amount_ugx THEN 'paid' ELSE status END, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [updated.invoice_id, updated.amount_ugx]);
    }
    await client.query("COMMIT");
    return updated ?? payment;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/* ------------------------------------------------------------------ guards */

async function isPlatformAdmin(runtime: Runtime, userId: string) {
  const allowed = runtime.config.PLATFORM_ADMIN_EMAILS.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return false;
  const email = (await runtime.db.query<Row>(`SELECT lower(email) email FROM users WHERE id=$1`, [userId])).rows[0]?.email;
  return Boolean(email && allowed.includes(email));
}

const requirePlatformAdmin = (runtime: Runtime): MiddlewareHandler<AppEnv> => async (c, next) => {
  if (!(await isPlatformAdmin(runtime, c.get("principal").userId))) throw new AppError(403, "FORBIDDEN", "Only Ledgerly platform administrators can use this portal");
  await next();
};

/** Premium-only modules are refused server-side for organizations on a lower plan. */
const premiumGate = (runtime: Runtime): MiddlewareHandler<AppEnv> => async (c, next) => {
  let principal; try { principal = c.get("principal"); } catch { principal = undefined; }
  if (principal?.organizationId && PREMIUM_API_PREFIXES.some(p => c.req.path === p || c.req.path.startsWith(`${p}/`))) {
    const sub = await subscriptionOf(runtime, principal.organizationId);
    if (sub.plan !== "premium") throw new AppError(402, "PLAN_UPGRADE_REQUIRED", "This module is part of the Ledgerly Premium plan.");
  }
  await next();
};

/* ------------------------------------------------------------------ routes */

const payInput = z.object({ msisdn: z.string().min(9).max(20), amountUgx: z.coerce.number().int().optional(), name: z.string().max(120).optional() });
const planInput = z.object({ plan: z.enum(["free", "standard", "premium"]).optional(), status: z.enum(["active", "suspended"]).optional(), notes: z.string().max(1000).nullable().optional() });
const settingsInput = z.object({ environment: z.enum(["sandbox", "live"]), apiUser: z.string().trim().min(1).max(200), apiKey: z.string().trim().max(500).optional(), publicUrl: z.string().trim().url().or(z.literal("")).optional() });
const manualInput = z.object({ amountUgx: z.coerce.number().int().min(1).max(1_000_000_000), note: z.string().max(500).optional() });

function billingRoutes(runtime: Runtime) {
  const r = new Hono<AppEnv>();

  r.get("/usage", async (c) => {
    const p = c.get("principal");
    const { sub, period, students, invoice } = await syncCurrentInvoice(runtime, p.organizationId);
    const [invoices, payments, admin, cfg] = await Promise.all([
      runtime.db.query<Row>(`SELECT * FROM billing_invoices WHERE organization_id=$1 ORDER BY starts_on DESC NULLS LAST, created_at DESC LIMIT 24`, [p.organizationId]),
      runtime.db.query<Row>(`SELECT * FROM billing_payments WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50`, [p.organizationId]),
      isPlatformAdmin(runtime, p.userId),
      loadSsentezoConfig(runtime),
    ]);
    const totals = invoices.rows.filter(i => i.status !== "void").reduce((t, i) => ({ billed: t.billed + Number(i.amount_ugx), paid: t.paid + Number(i.paid_ugx) }), { billed: 0, paid: 0 });
    return c.json({ data: {
      plan: sub.plan, planName: PLAN_NAMES[sub.plan], rateUgx: PLAN_RATES[sub.plan], status: sub.status,
      period, activeStudents: students, current: invoiceOut(invoice),
      totals: { billedUgx: totals.billed, paidUgx: totals.paid, balanceUgx: Math.max(0, totals.billed - totals.paid) },
      invoices: invoices.rows.map(invoiceOut), payments: payments.rows.map(paymentOut),
      paymentsConfigured: isConfigured(cfg), paymentsEnvironment: cfg.env,
      limits: { minUgx: MIN_PAYMENT, maxUgx: MAX_PAYMENT }, isPlatformAdmin: admin,
    } });
  });

  r.get("/subscription", async (c) => {
    const p = c.get("principal"), sub = await subscriptionOf(runtime, p.organizationId);
    return c.json({ data: { ...sub, planName: PLAN_NAMES[sub.plan], isPlatformAdmin: await isPlatformAdmin(runtime, p.userId) } });
  });

  // Self-service upgrades only; downgrades go through the platform admin so a school
  // can't drop to Free mid-term to avoid that term's bill.
  r.post("/plan", async (c) => {
    const p = c.get("principal");
    if (!["owner", "admin"].includes(p.role)) throw new AppError(403, "FORBIDDEN", "Only owners and administrators can change the plan");
    const parsed = z.object({ plan: z.enum(["free", "standard", "premium"]) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Choose a plan");
    const rank = { free: 0, standard: 1, premium: 2 } as const, current = await subscriptionOf(runtime, p.organizationId);
    if (rank[parsed.data.plan] <= rank[current.plan]) throw new AppError(409, "DOWNGRADE_NOT_SELF_SERVICE", "To move to a lower plan, contact Ledgerly support.");
    await runtime.db.query(`INSERT INTO billing_subscriptions(organization_id,plan,status,updated_by) VALUES($1,$2,'active',$3)
        ON CONFLICT (organization_id) DO UPDATE SET plan=EXCLUDED.plan, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP`, [p.organizationId, parsed.data.plan, p.userId]);
    await syncCurrentInvoice(runtime, p.organizationId);
    return c.json({ data: await subscriptionOf(runtime, p.organizationId) });
  });

  // Pay the current term's balance by mobile money: the payer gets a PIN prompt on their phone.
  r.post("/pay", requireScope("admin:read"), async (c) => {
    const parsed = payInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Enter a valid phone number and amount", parsed.error.flatten());
    const cfg = await loadSsentezoConfig(runtime);
    if (!isConfigured(cfg)) throw new AppError(503, "PAYMENTS_NOT_CONFIGURED", "Mobile money payments are not configured yet. Contact Ledgerly support.");
    const p = c.get("principal"), msisdn = normalizeMsisdn(parsed.data.msisdn);
    if (!msisdn) throw new AppError(422, "INVALID_PHONE", "Use an MTN or Airtel Uganda number, e.g. 0772 123456");
    const { invoice } = await syncCurrentInvoice(runtime, p.organizationId);
    const balance = invoice ? Math.max(0, Number(invoice.amount_ugx) - Number(invoice.paid_ugx)) : 0;
    if (!invoice || balance <= 0) throw new AppError(409, "NOTHING_DUE", "There is nothing to pay for this term.");
    const amount = parsed.data.amountUgx ?? Math.min(balance, MAX_PAYMENT);
    if (amount < MIN_PAYMENT || amount > MAX_PAYMENT) throw new AppError(422, "INVALID_AMOUNT", `Each mobile money payment must be between UGX ${MIN_PAYMENT.toLocaleString()} and UGX ${MAX_PAYMENT.toLocaleString()}.`);
    if (amount > balance) throw new AppError(422, "INVALID_AMOUNT", `The balance for this term is UGX ${balance.toLocaleString()}.`);
    const id = createId("bpay"), reference = `ledgerly-${id}`;
    await runtime.db.query(`INSERT INTO billing_payments(id,organization_id,invoice_id,provider,external_reference,msisdn,amount_ugx,recorded_by) VALUES($1,$2,$3,'ssentezo',$4,$5,$6,$7)`,
      [id, p.organizationId, invoice.id, reference, msisdn, amount, p.userId]);
    const publicUrl = cfg.publicUrl?.replace(/\/$/, "");
    try {
      const data = await requestDeposit(cfg, {
        externalReference: reference, msisdn, amount, name: parsed.data.name,
        reason: `Ledgerly ${PLAN_NAMES[invoice.plan as PlanKey] ?? ""} subscription · ${invoice.period_label}`.slice(0, 200),
        callbackUrl: publicUrl ? `${publicUrl}/api/billing/ssentezo/callback?ref=${encodeURIComponent(reference)}` : undefined,
      });
      await runtime.db.query(`UPDATE billing_payments SET provider_reference=$2, financial_transaction_id=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [id, data.ssentezoWalletReference ?? null, data.financialTransactionId ?? null]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The payment could not be started.";
      await runtime.db.query(`UPDATE billing_payments SET status='failed', failure_reason=$2, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [id, message]);
      throw new AppError(502, "PAYMENT_START_FAILED", message);
    }
    const row = (await runtime.db.query<Row>(`SELECT * FROM billing_payments WHERE id=$1`, [id])).rows[0]!;
    return c.json({ data: paymentOut(row) }, 201);
  });

  r.post("/payments/:id/refresh", async (c) => {
    const p = c.get("principal");
    const row = (await runtime.db.query<Row>(`SELECT external_reference FROM billing_payments WHERE id=$1 AND organization_id=$2`, [c.req.param("id"), p.organizationId])).rows[0];
    if (!row) throw new AppError(404, "NOT_FOUND", "Payment not found");
    const settled = await settlePayment(runtime, row.external_reference);
    return c.json({ data: paymentOut(settled ?? row) });
  });

  return r;
}

function platformRoutes(runtime: Runtime) {
  const r = new Hono<AppEnv>();
  r.use("*", requirePlatformAdmin(runtime));

  r.get("/organizations", async (c) => {
    const orgs = (await runtime.db.query<Row>(`SELECT o.id,o.name,o.status org_status,o.created_at,
        (SELECT u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=o.id AND m.role='owner' ORDER BY m.created_at LIMIT 1) owner_email,
        (SELECT COUNT(*)::int FROM memberships m WHERE m.organization_id=o.id) members
      FROM organizations o ORDER BY o.created_at DESC`)).rows;
    const out = [];
    for (const o of orgs) {
      const { sub, period, students, invoice } = await syncCurrentInvoice(runtime, o.id);
      const totals = (await runtime.db.query<Row>(`SELECT COALESCE(SUM(amount_ugx),0)::float8 billed, COALESCE(SUM(paid_ugx),0)::float8 paid FROM billing_invoices WHERE organization_id=$1 AND status<>'void'`, [o.id])).rows[0];
      out.push({ id: o.id, name: o.name, ownerEmail: o.owner_email, members: o.members, createdAt: o.created_at,
        plan: sub.plan, planName: PLAN_NAMES[sub.plan], status: sub.status, notes: sub.notes, activeStudents: students,
        period: period.label, current: invoiceOut(invoice),
        billedUgx: Number(totals?.billed ?? 0), paidUgx: Number(totals?.paid ?? 0), balanceUgx: Math.max(0, Number(totals?.billed ?? 0) - Number(totals?.paid ?? 0)) });
    }
    const summary = {
      organizations: out.length,
      byPlan: { free: out.filter(o => o.plan === "free").length, standard: out.filter(o => o.plan === "standard").length, premium: out.filter(o => o.plan === "premium").length },
      suspended: out.filter(o => o.status === "suspended").length,
      students: out.reduce((n, o) => n + o.activeStudents, 0),
      billedUgx: out.reduce((n, o) => n + o.billedUgx, 0), paidUgx: out.reduce((n, o) => n + o.paidUgx, 0),
    };
    const cfg = await loadSsentezoConfig(runtime);
    return c.json({ data: { summary, organizations: out, paymentsConfigured: isConfigured(cfg), paymentsEnvironment: cfg.env } });
  });

  r.put("/organizations/:id/subscription", async (c) => {
    const parsed = planInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid subscription change", parsed.error.flatten());
    const id = c.req.param("id"), p = c.get("principal");
    if (!(await runtime.db.query(`SELECT 1 FROM organizations WHERE id=$1`, [id])).rowCount) throw new AppError(404, "NOT_FOUND", "Organization not found");
    const current = await subscriptionOf(runtime, id);
    await runtime.db.query(`INSERT INTO billing_subscriptions(organization_id,plan,status,notes,updated_by) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT (organization_id) DO UPDATE SET plan=EXCLUDED.plan,status=EXCLUDED.status,notes=EXCLUDED.notes,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP`,
      [id, parsed.data.plan ?? current.plan, parsed.data.status ?? current.status, parsed.data.notes === undefined ? current.notes : parsed.data.notes, p.userId]);
    await syncCurrentInvoice(runtime, id);
    return c.json({ data: await subscriptionOf(runtime, id) });
  });

  // Cash, bank or other off-platform payments recorded by an operator against the current term.
  r.post("/organizations/:id/payments", async (c) => {
    const parsed = manualInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Enter the amount received", parsed.error.flatten());
    const id = c.req.param("id"), p = c.get("principal"), { invoice } = await syncCurrentInvoice(runtime, id);
    if (!invoice) throw new AppError(409, "NOTHING_DUE", "This organization has no billable invoice this term (Free plan).");
    const pid = createId("bpay"), client = await runtime.db.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO billing_payments(id,organization_id,invoice_id,provider,external_reference,amount_ugx,status,note,recorded_by,completed_at)
          VALUES($1,$2,$3,'manual',$4,$5,'succeeded',$6,$7,CURRENT_TIMESTAMP)`, [pid, id, invoice.id, `manual-${pid}`, parsed.data.amountUgx, parsed.data.note ?? null, p.userId]);
      await client.query(`UPDATE billing_invoices SET paid_ugx=paid_ugx+$2, status=CASE WHEN paid_ugx+$2>=amount_ugx THEN 'paid' ELSE status END, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [invoice.id, parsed.data.amountUgx]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    return c.json({ data: { id: pid } }, 201);
  });

  // Ssentezo credentials: the key is write-only (encrypted at rest, never sent back).
  r.get("/payment-settings", async (c) => {
    const cfg = await loadSsentezoConfig(runtime);
    return c.json({ data: { provider: "ssentezo", environment: cfg.env, apiUser: cfg.apiUser ?? "", hasApiKey: Boolean(cfg.apiKey), publicUrl: cfg.publicUrl ?? "", source: cfg.source, configured: isConfigured(cfg) } });
  });
  r.put("/payment-settings", async (c) => {
    const parsed = settingsInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Check the payment settings", parsed.error.flatten());
    const p = c.get("principal"), v = parsed.data;
    const existing = (await runtime.db.query<Row>(`SELECT ssentezo_api_key_encrypted FROM billing_settings WHERE id='default'`)).rows[0];
    if (!v.apiKey && !existing?.ssentezo_api_key_encrypted) throw new AppError(422, "API_KEY_REQUIRED", "Enter the Ssentezo API key");
    const encrypted = v.apiKey ? JSON.stringify(encryptApiKey(runtime, v.apiKey)) : null;
    await runtime.db.query(`INSERT INTO billing_settings(id,ssentezo_env,ssentezo_api_user,ssentezo_api_key_encrypted,public_url,updated_by) VALUES('default',$1,$2,$3::jsonb,$4,$5)
        ON CONFLICT (id) DO UPDATE SET ssentezo_env=EXCLUDED.ssentezo_env, ssentezo_api_user=EXCLUDED.ssentezo_api_user,
          ssentezo_api_key_encrypted=COALESCE(EXCLUDED.ssentezo_api_key_encrypted,billing_settings.ssentezo_api_key_encrypted),
          public_url=EXCLUDED.public_url, updated_by=EXCLUDED.updated_by, updated_at=CURRENT_TIMESTAMP`,
      [v.environment, v.apiUser, encrypted, v.publicUrl || null, p.userId]);
    return c.json({ data: { saved: true } });
  });
  r.post("/payment-settings/test", async (c) => {
    const cfg = await loadSsentezoConfig(runtime);
    if (!isConfigured(cfg)) throw new AppError(409, "PAYMENTS_NOT_CONFIGURED", "Save the Ssentezo credentials first");
    try { const b = await walletBalance(cfg); return c.json({ data: { ok: true, environment: cfg.env, balance: b.formatted ?? b.amount ?? null } }); }
    catch (error) { throw new AppError(502, "SSENTEZO_TEST_FAILED", error instanceof Error ? error.message : "Could not reach Ssentezo"); }
  });

  r.get("/payments", async (c) => {
    const rows = (await runtime.db.query<Row>(`SELECT p.*, o.name organization_name FROM billing_payments p JOIN organizations o ON o.id=p.organization_id ORDER BY p.created_at DESC LIMIT 200`)).rows;
    return c.json({ data: rows.map(r => ({ ...paymentOut(r), organizationId: r.organization_id, organizationName: r.organization_name })) });
  });

  r.post("/payments/:id/refresh", async (c) => {
    const row = (await runtime.db.query<Row>(`SELECT external_reference FROM billing_payments WHERE id=$1`, [c.req.param("id")])).rows[0];
    if (!row) throw new AppError(404, "NOT_FOUND", "Payment not found");
    return c.json({ data: paymentOut((await settlePayment(runtime, row.external_reference)) ?? row) });
  });
  return r;
}

export const billingFeature: BackendFeature = {
  key: "billing",
  version: "1.0.0",
  mount(app, runtime) {
    // Runs after the global /api/v1 auth middleware, so the principal is available.
    app.use("/api/v1/*", premiumGate(runtime));
    app.route("/api/v1/billing", billingRoutes(runtime));
    app.route("/api/v1/platform", platformRoutes(runtime));
    // Public Ssentezo callback (outside /api/v1 auth). The body is ignored: the payment is
    // re-verified with Ssentezo's status API, so a forged callback can't mark anything paid.
    const settleFromCallback = async (c: any) => {
      const ref = c.req.query("ref") || ((await c.req.json().catch(() => ({}))) as Row)?.data?.externalReference;
      if (typeof ref === "string" && ref.startsWith("ledgerly-")) void settlePayment(runtime, ref).catch(() => undefined);
      return c.json({ ok: true });
    };
    app.post("/api/billing/ssentezo/callback", settleFromCallback);
    app.get("/api/billing/ssentezo/callback", settleFromCallback);
  },
};

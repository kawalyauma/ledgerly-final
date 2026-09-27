import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { requireScope } from "../core-identity/security.js";
import type { BackendFeature } from "../types.js";

const sectionsInput = z.object({
  showAll: z.boolean().optional(),
  sections: z.array(z.object({ key: z.string().min(1).max(160), visible: z.boolean() })).max(200).optional(),
});

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0) || 0;

// Each block is independent: a module that is not set up (or whose tables are empty) just
// yields null for its block instead of failing the whole dashboard.
async function block<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

async function buildOverview(runtime: Runtime, org: string) {
  const q = async (sql: string, params: unknown[] = [org]) => (await runtime.db.query<Row>(sql, params)).rows;
  const [students, staff, fees, collections, exams, attendance, finance, monthly, tasks, admissions] = await Promise.all([
    block(async () => {
      const [totals] = await q(`SELECT COUNT(*) FILTER (WHERE status='active')::int active, COUNT(*)::int total,
          COUNT(*) FILTER (WHERE status='active' AND lower(gender)='male')::int male,
          COUNT(*) FILTER (WHERE status='active' AND lower(gender)='female')::int female
        FROM school_students WHERE organization_id=$1 AND deleted_at IS NULL`);
      const byClass = await q(`SELECT COALESCE(c.name,'Unassigned') label, COUNT(*)::int value FROM school_students s
          LEFT JOIN school_classes c ON c.id=s.current_class_id AND c.organization_id=s.organization_id
        WHERE s.organization_id=$1 AND s.deleted_at IS NULL AND s.status='active' GROUP BY 1 ORDER BY 1`);
      return { active: num(totals?.active), total: num(totals?.total), male: num(totals?.male), female: num(totals?.female), byClass };
    }),
    block(async () => {
      const [r] = await q(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE is_teacher)::int teachers
        FROM school_staff_profiles WHERE organization_id=$1 AND deleted_at IS NULL AND COALESCE(active,true)`);
      return { total: num(r?.total), teachers: num(r?.teachers) };
    }),
    block(async () => {
      const [r] = await q(`SELECT COALESCE(SUM(l.debit_minor),0)::float8 billed,
          COALESCE(SUM(CASE WHEN j.source_type IN ('receipt','schoolpay_payment') THEN l.credit_minor ELSE 0 END),0)::float8 collected,
          COALESCE(SUM(l.debit_minor-l.credit_minor),0)::float8 outstanding
        FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
        JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
        WHERE l.organization_id=$1 AND j.status='posted'
          AND (a.subtype='school_fee_receivable' OR (a.subtype='receivable' AND l.dimensions_json ? 'schoolStudentId'))`);
      const billed = num(r?.billed), collected = num(r?.collected);
      return { billedMinor: billed, collectedMinor: collected, outstandingMinor: num(r?.outstanding), collectionRate: billed ? collected / billed : 0 };
    }),
    block(() => q(`SELECT to_char(d::date,'YYYY-MM-DD') label, COALESCE(SUM(r.amount_minor),0)::float8 value
        FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, interval '1 day') d
        LEFT JOIN school_fee_receipts r ON r.organization_id=$1 AND r.payment_date=d::date AND r.archived_at IS NULL
        GROUP BY d ORDER BY d`)),
    block(() => q(`SELECT status label, COUNT(*)::int value FROM exm_exams WHERE organization_id=$1 GROUP BY status ORDER BY 2 DESC`)),
    block(async () => {
      const [r] = await q(`SELECT COUNT(*)::int marked,
          COUNT(*) FILTER (WHERE r.status IN ('present','late'))::int present,
          COUNT(*) FILTER (WHERE r.status='absent')::int absent
        FROM school_student_attendance_records r JOIN school_student_attendance_sessions s ON s.id=r.session_id AND s.organization_id=r.organization_id
        WHERE r.organization_id=$1 AND s.attendance_date=CURRENT_DATE`);
      return { marked: num(r?.marked), present: num(r?.present), absent: num(r?.absent) };
    }),
    block(async () => {
      const [r] = await q(`SELECT
          COALESCE(SUM(CASE WHEN a.type='revenue' THEN l.credit_minor-l.debit_minor END),0)::float8 revenue,
          COALESCE(SUM(CASE WHEN a.type='expense' THEN l.debit_minor-l.credit_minor END),0)::float8 expenses,
          COALESCE(SUM(CASE WHEN a.type='asset' AND a.subtype IN ('cash','bank') THEN l.debit_minor-l.credit_minor END),0)::float8 cash
        FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id
        JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
        WHERE l.organization_id=$1 AND j.status='posted'`);
      return { revenueMinor: num(r?.revenue), expensesMinor: num(r?.expenses), cashMinor: num(r?.cash) };
    }),
    block(() => q(`SELECT to_char(date_trunc('month', m),'Mon YYYY') label,
          COALESCE(SUM(CASE WHEN a.type='revenue' THEN l.credit_minor-l.debit_minor END),0)::float8 revenue,
          COALESCE(SUM(CASE WHEN a.type='expense' THEN l.debit_minor-l.credit_minor END),0)::float8 expenses
        FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '5 months', date_trunc('month', CURRENT_DATE), interval '1 month') m
        LEFT JOIN journal_entries j ON j.organization_id=$1 AND j.status='posted' AND date_trunc('month', j.transaction_date)=m
        LEFT JOIN journal_lines l ON l.journal_entry_id=j.id AND l.organization_id=j.organization_id
        LEFT JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id
        GROUP BY m ORDER BY m`)),
    block(async () => {
      const [r] = await q(`SELECT COUNT(*) FILTER (WHERE status NOT IN ('done','cancelled'))::int open,
          COUNT(*) FILTER (WHERE status NOT IN ('done','cancelled') AND due_at < CURRENT_TIMESTAMP)::int overdue
        FROM work_tasks WHERE organization_id=$1 AND archived_at IS NULL`);
      return { open: num(r?.open), overdue: num(r?.overdue) };
    }),
    block(() => q(`SELECT status label, COUNT(*)::int value FROM school_admission_applications WHERE organization_id=$1 GROUP BY status ORDER BY 2 DESC`)),
  ]);
  return { generatedAt: new Date().toISOString(), students, staff, fees, collections, exams, attendance, finance, monthly, tasks, admissions };
}

function createWorkspaceSettingsRoutes(runtime: Runtime) {
  const r = new Hono<AppEnv>();
  r.get("/overview", async (c) => c.json({ data: await buildOverview(runtime, c.get("principal").organizationId) }));
  // Every member needs the layout to render the sidebar; only administrators change it.
  r.get("/navigation", async (c) => {
    const p = c.get("principal");
    const q = await runtime.db.query<{ navigation_settings: unknown }>(`SELECT navigation_settings FROM organizations WHERE id=$1`, [p.organizationId]);
    return c.json({ data: q.rows[0]?.navigation_settings ?? null });
  });
  r.put("/navigation", requireScope("admin:write"), async (c) => {
    const parsed = sectionsInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid navigation settings", parsed.error.flatten());
    const p = c.get("principal");
    if (!["owner", "admin"].includes(p.role)) throw new AppError(403, "FORBIDDEN", "Only owners and administrators can change the sidebar layout");
    const value = parsed.data.showAll ? { showAll: true } : { sections: parsed.data.sections ?? [] };
    await runtime.db.query(`UPDATE organizations SET navigation_settings=$1::jsonb, updated_at=CURRENT_TIMESTAMP WHERE id=$2`, [JSON.stringify(value), p.organizationId]);
    return c.json({ data: value });
  });
  r.delete("/navigation", requireScope("admin:write"), async (c) => {
    const p = c.get("principal");
    if (!["owner", "admin"].includes(p.role)) throw new AppError(403, "FORBIDDEN", "Only owners and administrators can change the sidebar layout");
    await runtime.db.query(`UPDATE organizations SET navigation_settings=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [p.organizationId]);
    return c.json({ data: null });
  });
  return r;
}

export const workspaceSettingsFeature: BackendFeature = {
  key: "workspace-settings",
  version: "1.0.0",
  mount(app, runtime) {
    app.route("/api/v1/workspace", createWorkspaceSettingsRoutes(runtime));
  },
};

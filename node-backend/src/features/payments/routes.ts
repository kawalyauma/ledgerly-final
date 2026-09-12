import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { requireScope } from "../core-identity/security.js";
import { allocatePostedPayment, createPayment, listOutstandingBalances, paymentBalance, postPayment, reversePayment } from "./service.js";

const input = z.object({
  type: z.enum(["receipt", "payment"]),
  number: z.string().trim().min(1).max(60),
  contactId: z.string().min(1),
  bankAccountId: z.string().min(1),
  controlAccountId: z.string().min(1),
  paymentDate: z.iso.date(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  amountMinor: z.number().int().positive(),
  reference: z.string().trim().max(100).optional(),
});
const allocation = z.object({ documentId: z.string().min(1), amountMinor: z.number().int().positive() });
const posting = z.object({ allocations: z.array(allocation).max(500).default([]) });
const reversal = z.object({ postingDate: z.iso.date(), reason: z.string().trim().min(3).max(500) });

function pagination(c: { req: { query: (name: string) => string | undefined } }) {
  const rawLimit = Number(c.req.query("limit") ?? 50), rawOffset = Number(c.req.query("offset") ?? 0);
  return {
    limit: Number.isSafeInteger(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50,
    offset: Number.isSafeInteger(rawOffset) ? Math.max(0, rawOffset) : 0,
  };
}

export function createPaymentRoutes(runtime: Runtime) {
  const router = new Hono<AppEnv>();

  router.get("/manifest", requireScope("payments:read"), async (c) => c.json({ data: {
    key: "payroll-payments",
    area: "payments",
    enabledModules: [
      { key: "ledgerly-core", name: "Ledgerly Finance Core" },
      { key: "contacts", name: "Contacts" },
      { key: "documents", name: "Documents" },
      { key: "payments", name: "Payments" },
    ],
    counterpartySources: ["contacts"],
  } }));

  router.get("/counterparties", requireScope("payments:read"), async (c) => {
    const p = c.get("principal");
    const rows = await runtime.db.query(
      `SELECT id,name,code,email,type FROM contacts
       WHERE organization_id=$1 AND active=true AND archived_at IS NULL ORDER BY name`,
      [p.organizationId],
    );
    return c.json({ data: rows.rows.map((row) => ({ ...row, sourceModules: ["contacts"] })) });
  });

  router.get("/balances", requireScope("payments:read"), async (c) => {
    const p = c.get("principal"), type = c.req.query("type"), contactId = c.req.query("contactId");
    if (type && type !== "receipt" && type !== "payment") throw new AppError(422, "VALIDATION_ERROR", "type must be receipt or payment");
    return c.json({ data: await listOutstandingBalances(runtime, p.organizationId, contactId, type as "receipt" | "payment" | undefined) });
  });

  router.get("/", requireScope("payments:read"), async (c) => {
    const p = c.get("principal"), { limit, offset } = pagination(c), type = c.req.query("type"), contactId = c.req.query("contactId");
    const params: unknown[] = [p.organizationId];
    const conditions = ["p.organization_id=$1"];
    if (type) { params.push(type); conditions.push(`p.type=$${params.length}`); }
    if (contactId) { params.push(contactId); conditions.push(`p.contact_id=$${params.length}`); }
    params.push(limit, offset);
    const result = await runtime.db.query(
      `SELECT p.id,p.type,p.number,p.payment_date::text AS "paymentDate",p.currency,p.amount_minor::float8 AS "amountMinor",
        p.reference,p.status,c.name AS contact,p.contact_id AS "contactId",p.journal_entry_id AS "journalEntryId",
        p.reversal_journal_id AS "reversalJournalId",
        COALESCE(SUM(a.amount_minor) FILTER (WHERE a.reversed_at IS NULL),0)::float8 AS "allocatedMinor"
       FROM payments p JOIN contacts c ON c.id=p.contact_id AND c.organization_id=p.organization_id
       LEFT JOIN payment_allocations a ON a.organization_id=p.organization_id AND a.payment_id=p.id
       WHERE ${conditions.join(" AND ")}
       GROUP BY p.id,c.name ORDER BY p.payment_date DESC,p.number DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return c.json({ data: result.rows.map((row) => {
      const typed = row as { amountMinor: number; allocatedMinor: number };
      return { ...row, unallocatedMinor: typed.amountMinor - typed.allocatedMinor };
    }), pagination: { limit, offset } });
  });

  router.get("/:id", requireScope("payments:read"), async (c) => {
    const p = c.get("principal"), id = c.req.param("id");
    const payment = (await runtime.db.query(
      `SELECT p.id,p.type,p.number,p.contact_id AS "contactId",c.name AS contact,p.bank_account_id AS "bankAccountId",
        bank.code AS "bankAccountCode",bank.name AS "bankAccountName",p.control_account_id AS "controlAccountId",
        control.code AS "controlAccountCode",control.name AS "controlAccountName",p.payment_date::text AS "paymentDate",p.currency,
        p.amount_minor::float8 AS "amountMinor",p.reference,p.status,p.journal_entry_id AS "journalEntryId",
        p.reversal_journal_id AS "reversalJournalId",p.reversed_at AS "reversedAt",p.reversal_reason AS "reversalReason",
        p.created_at AS "createdAt",p.updated_at AS "updatedAt"
       FROM payments p JOIN contacts c ON c.id=p.contact_id AND c.organization_id=p.organization_id
       JOIN accounts bank ON bank.id=p.bank_account_id AND bank.organization_id=p.organization_id
       JOIN accounts control ON control.id=p.control_account_id AND control.organization_id=p.organization_id
       WHERE p.id=$1 AND p.organization_id=$2`,
      [id, p.organizationId],
    )).rows[0];
    if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
    const allocations = await runtime.db.query(
      `SELECT a.id,a.document_id AS "documentId",d.type AS "documentType",d.number AS "documentNumber",
        a.amount_minor::float8 AS "amountMinor",a.reversed_at AS "reversedAt",a.reversal_reason AS "reversalReason",a.created_at AS "createdAt"
       FROM payment_allocations a JOIN documents d ON d.id=a.document_id AND d.organization_id=a.organization_id
       WHERE a.organization_id=$1 AND a.payment_id=$2 ORDER BY a.created_at,a.id`,
      [p.organizationId, id],
    );
    const balance = await paymentBalance(runtime, p.organizationId, id);
    return c.json({ data: { ...payment, allocatedMinor: balance.allocatedMinor, unallocatedMinor: balance.unallocatedMinor, allocations: allocations.rows } });
  });

  router.post("/", requireScope("payments:write"), async (c) => {
    const key = c.req.header("Idempotency-Key");
    if (!key || key.length > 200) throw new AppError(422, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
    const parsed = input.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid payment", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await createPayment(runtime, p.organizationId, p.userId, parsed.data, key) }, 201);
  });

  router.post("/:id/post", requireScope("payments:write"), async (c) => {
    const parsed = posting.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid allocations", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await postPayment(runtime, p.organizationId, p.userId, c.req.param("id"), parsed.data.allocations) });
  });

  router.post("/:id/allocations", requireScope("payments:write"), async (c) => {
    const parsed = posting.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid allocations", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await allocatePostedPayment(runtime, p.organizationId, p.userId, c.req.param("id"), parsed.data.allocations) });
  });

  router.post("/:id/reverse", requireScope("payments:write"), async (c) => {
    const parsed = reversal.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "A posting date and reason are required", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await reversePayment(runtime, p.organizationId, p.userId, c.req.param("id"), parsed.data.postingDate, parsed.data.reason) });
  });

  router.delete("/:id", requireScope("payments:write"), async (c) => {
    const p = c.get("principal"), id = c.req.param("id"), client = await runtime.db.connect();
    try {
      await client.query("BEGIN");
      const payment = (await client.query<{ status: string }>(
        `SELECT status FROM payments WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [id, p.organizationId],
      )).rows[0];
      if (!payment) throw new AppError(404, "NOT_FOUND", "Payment not found");
      if (payment.status !== "draft") throw new AppError(409, "IMMUTABLE_POSTED_TRANSACTION", "Posted payments must be reversed, not deleted");
      await client.query(`DELETE FROM payments WHERE id=$1 AND organization_id=$2 AND status='draft'`, [id, p.organizationId]);
      await client.query(
        `INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id)
         VALUES($1,$2,$3,'payment.draft_deleted','payment',$4)`,
        [`aud_${crypto.randomUUID().replaceAll("-", "")}`, p.organizationId, p.userId, id],
      );
      await client.query("COMMIT");
      return c.body(null, 204);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  });

  return router;
}

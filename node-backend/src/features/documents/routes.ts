import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";
import { createDocument, postDocument, reverseDocument } from "./service.js";

const lineInput = z.object({
  productId: z.string().optional(),
  accountId: z.string().min(1),
  taxAccountId: z.string().optional(),
  description: z.string().trim().min(1).max(500),
  quantityMicros: z.number().int().positive().default(1_000_000),
  unitPriceMinor: z.number().int().nonnegative(),
  taxMinor: z.number().int().nonnegative().default(0),
  projectId: z.string().optional(),
  classId: z.string().optional(),
  departmentId: z.string().optional(),
  locationId: z.string().optional(),
  dimensions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
const documentInput = z.object({
  type: z.enum(["invoice", "bill", "credit_note", "supplier_credit"]),
  number: z.string().trim().min(1).max(60),
  contactId: z.string().min(1),
  issueDate: z.iso.date(),
  dueDate: z.iso.date().optional(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  customFields: z.record(z.string(), z.unknown()).optional(),
  lines: z.array(lineInput).min(1).max(500),
});
const postingInput = z.object({ controlAccountId: z.string().min(1).optional() });
const reversalInput = z.object({ postingDate: z.iso.date(), reason: z.string().trim().min(3).max(500) });

function pagination(c: { req: { query: (name: string) => string | undefined } }) {
  const rawLimit = Number(c.req.query("limit") ?? 50);
  const rawOffset = Number(c.req.query("offset") ?? 0);
  return {
    limit: Number.isSafeInteger(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50,
    offset: Number.isSafeInteger(rawOffset) ? Math.max(0, rawOffset) : 0,
  };
}

export function createDocumentRoutes(runtime: Runtime) {
  const router = new Hono<AppEnv>();

  router.get("/", requireScope("documents:read"), async (c) => {
    const p = c.get("principal"), { limit, offset } = pagination(c), type = c.req.query("type");
    const params: unknown[] = [p.organizationId];
    const conditions = ["d.organization_id=$1"];
    if (type) { params.push(type); conditions.push(`d.type=$${params.length}`); }
    params.push(limit, offset);
    const result = await runtime.db.query(
      `SELECT d.id,d.type,d.number,d.issue_date::text AS "issueDate",d.due_date::text AS "dueDate",d.status,d.currency,
       d.subtotal_minor::float8 AS "subtotalMinor",d.tax_minor::float8 AS "taxMinor",d.total_minor::float8 AS "totalMinor",
       d.paid_minor::float8 AS "paidMinor",d.journal_entry_id AS "journalEntryId",d.approval_status AS "approvalStatus",c.name AS contact
       FROM documents d LEFT JOIN contacts c ON c.id=d.contact_id AND c.organization_id=d.organization_id
       WHERE ${conditions.join(" AND ")} ORDER BY d.issue_date DESC,d.number DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return c.json({ data: result.rows, pagination: { limit, offset } });
  });

  router.get("/:id", requireScope("documents:read"), async (c) => {
    const p = c.get("principal"), id = c.req.param("id");
    const doc = (await runtime.db.query(
      `SELECT id,organization_id,type,number,contact_id,issue_date::text AS issue_date,due_date::text AS due_date,status,currency,
       subtotal_minor::float8 AS subtotal_minor,tax_minor::float8 AS tax_minor,total_minor::float8 AS total_minor,
       paid_minor::float8 AS paid_minor,journal_entry_id,approval_status,custom_fields,created_at,updated_at
       FROM documents WHERE id=$1 AND organization_id=$2`,
      [id, p.organizationId],
    )).rows[0];
    if (!doc) throw new AppError(404, "NOT_FOUND", "Document not found");
    const lines = await runtime.db.query(
      `SELECT id,organization_id,document_id,product_id,account_id,tax_account_id,description,quantity_micros::float8 AS quantity_micros,
       unit_price_minor::float8 AS unit_price_minor,subtotal_minor::float8 AS subtotal_minor,tax_minor::float8 AS tax_minor,
       total_minor::float8 AS total_minor,project_id,class_id,department_id,location_id,dimensions_json,created_at,updated_at
       FROM document_lines WHERE document_id=$1 AND organization_id=$2 ORDER BY id`,
      [id, p.organizationId],
    );
    return c.json({ data: { ...doc, lines: lines.rows } });
  });

  router.post("/", requireScope("documents:write"), async (c) => {
    const parsed = documentInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid document", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await createDocument(runtime, p.organizationId, p.userId, parsed.data) }, 201);
  });

  router.post("/:id/post", requireScope("documents:write"), async (c) => {
    const parsed = postingInput.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid posting request", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await postDocument(runtime, p.organizationId, p.userId, c.req.param("id"), parsed.data.controlAccountId) });
  });

  router.post("/:id/reverse", requireScope("documents:write"), async (c) => {
    const parsed = reversalInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "A posting date and reason are required", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await reverseDocument(runtime, p.organizationId, p.userId, c.req.param("id"), parsed.data.postingDate, parsed.data.reason) });
  });

  router.delete("/:id", requireScope("documents:write"), async (c) => {
    const p = c.get("principal"), id = c.req.param("id"), client = await runtime.db.connect();
    try {
      await client.query("BEGIN");
      const doc = (await client.query<{ status: string }>("SELECT status FROM documents WHERE id=$1 AND organization_id=$2 FOR UPDATE", [id, p.organizationId])).rows[0];
      if (!doc) throw new AppError(404, "NOT_FOUND", "Document not found");
      if (doc.status !== "draft") throw new AppError(409, "IMMUTABLE_POSTED_TRANSACTION", "Posted documents must be reversed, not deleted");
      await client.query("DELETE FROM documents WHERE id=$1 AND organization_id=$2 AND status='draft'", [id, p.organizationId]);
      await client.query(
        `INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id)
         VALUES($1,$2,$3,'document.draft_deleted','document',$4)`,
        [createId("aud"), p.organizationId, p.userId, id],
      );
      await client.query("COMMIT");
      return c.body(null, 204);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  return router;
}

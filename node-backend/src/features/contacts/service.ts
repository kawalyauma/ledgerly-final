import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";

type Db = Pool | PoolClient;

export type ContactRecord = {
  id: string;
  type: "customer" | "supplier" | "employee" | "other";
  code: string | null;
  name: string;
  email: string | null;
  taxNumber: string | null;
  paymentTermsDays: number;
  active: boolean;
  creditLimitMinor: number;
  pricingTier: string | null;
  customFields: Record<string, unknown>;
  archivedAt: string | null;
  mergedIntoContactId: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function auditContact(
  db: Db,
  organizationId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  after?: unknown,
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [createId("aud"), organizationId, actorId, action, entityType, entityId, after === undefined ? null : JSON.stringify(after)],
  );
}

export async function requireContact(
  db: Db,
  organizationId: string,
  id: string,
  includeArchived = false,
): Promise<ContactRecord> {
  const row = (await db.query<ContactRecord>(
    `SELECT id,type,code,name,email,tax_number AS "taxNumber",payment_terms_days AS "paymentTermsDays",active,
      credit_limit_minor::float8 AS "creditLimitMinor",pricing_tier AS "pricingTier",custom_fields AS "customFields",
      archived_at AS "archivedAt",merged_into_contact_id AS "mergedIntoContactId",created_at AS "createdAt",updated_at AS "updatedAt"
     FROM contacts WHERE id=$1 AND organization_id=$2 ${includeArchived ? "" : "AND archived_at IS NULL"}`,
    [id, organizationId],
  )).rows[0];
  if (!row) throw new AppError(404, "NOT_FOUND", "Contact not found");
  return row;
}

async function tableExists(db: Db, table: string): Promise<boolean> {
  const row = (await db.query<{ name: string | null }>("SELECT to_regclass($1) AS name", [`public.${table}`])).rows[0];
  return Boolean(row?.name);
}

async function tableHasContactReference(db: Db, table: "documents" | "payments", organizationId: string, contactId: string): Promise<boolean> {
  if (!await tableExists(db, table)) return false;
  const result = await db.query(`SELECT 1 FROM ${table} WHERE organization_id=$1 AND contact_id=$2 LIMIT 1`, [organizationId, contactId]);
  return Boolean(result.rowCount);
}

export async function contactHasFinancialHistory(db: Db, organizationId: string, contactId: string): Promise<boolean> {
  const journal = await db.query("SELECT 1 FROM journal_lines WHERE organization_id=$1 AND contact_id=$2 LIMIT 1", [organizationId, contactId]);
  if (journal.rowCount) return true;
  if (await tableHasContactReference(db, "documents", organizationId, contactId)) return true;
  return tableHasContactReference(db, "payments", organizationId, contactId);
}

async function moveOptionalReference(client: PoolClient, table: "documents" | "payments", organizationId: string, sourceId: string, targetId: string) {
  if (!await tableExists(client, table)) return;
  await client.query(`UPDATE ${table} SET contact_id=$1,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$2 AND contact_id=$3`, [targetId, organizationId, sourceId]);
}

export async function mergeContacts(runtime: Runtime, organizationId: string, actorId: string, sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new AppError(422, "VALIDATION_ERROR", "Invalid merge target");
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const contacts = await client.query<{ id: string }>(
      `SELECT id FROM contacts WHERE organization_id=$1 AND id=ANY($2::text[]) AND archived_at IS NULL FOR UPDATE`,
      [organizationId, [sourceId, targetId]],
    );
    if (contacts.rows.length !== 2) throw new AppError(404, "NOT_FOUND", "Contact not found");

    await client.query(
      `UPDATE contact_addresses s SET is_default=false,updated_at=CURRENT_TIMESTAMP
       WHERE s.organization_id=$1 AND s.contact_id=$2 AND s.is_default=true
       AND EXISTS (SELECT 1 FROM contact_addresses t WHERE t.organization_id=$1 AND t.contact_id=$3 AND t.type=s.type AND t.is_default=true)`,
      [organizationId, sourceId, targetId],
    );
    await client.query("UPDATE contact_addresses SET contact_id=$1,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$2 AND contact_id=$3", [targetId, organizationId, sourceId]);

    const targetPrimary = await client.query("SELECT 1 FROM contact_people WHERE organization_id=$1 AND contact_id=$2 AND is_primary=true LIMIT 1", [organizationId, targetId]);
    if (targetPrimary.rowCount) await client.query("UPDATE contact_people SET is_primary=false,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND contact_id=$2 AND is_primary=true", [organizationId, sourceId]);
    await client.query("UPDATE contact_people SET contact_id=$1,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$2 AND contact_id=$3", [targetId, organizationId, sourceId]);

    await client.query("UPDATE journal_lines SET contact_id=$1,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$2 AND contact_id=$3", [targetId, organizationId, sourceId]);
    await moveOptionalReference(client, "documents", organizationId, sourceId, targetId);
    await moveOptionalReference(client, "payments", organizationId, sourceId, targetId);

    await client.query(
      "UPDATE contacts SET active=false,archived_at=CURRENT_TIMESTAMP,merged_into_contact_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3",
      [targetId, sourceId, organizationId],
    );
    await auditContact(client, organizationId, actorId, "contact.merged", "contact", sourceId, { targetContactId: targetId });
    await client.query("COMMIT");
    return { sourceContactId: sourceId, targetContactId: targetId, status: "merged" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createAddress(runtime: Runtime, organizationId: string, actorId: string, contactId: string, value: {
  type: "billing" | "shipping" | "registered" | "other";
  line1: string; line2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country: string; isDefault: boolean;
}) {
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await requireContact(client, organizationId, contactId);
    if (value.isDefault) await client.query("UPDATE contact_addresses SET is_default=false,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND contact_id=$2 AND type=$3", [organizationId, contactId, value.type]);
    const id = createId("adr");
    await client.query(
      `INSERT INTO contact_addresses(id,organization_id,contact_id,type,line1,line2,city,state,postal_code,country,is_default)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, organizationId, contactId, value.type, value.line1, value.line2 ?? null, value.city ?? null, value.state ?? null, value.postalCode ?? null, value.country.toUpperCase(), value.isDefault],
    );
    await auditContact(client, organizationId, actorId, "contact.address.created", "contact_address", id, { contactId, ...value });
    await client.query("COMMIT");
    return { id, ...value, country: value.country.toUpperCase() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function createPerson(runtime: Runtime, organizationId: string, actorId: string, contactId: string, value: {
  name: string; email?: string | null; phone?: string | null; role?: string | null; isPrimary: boolean;
}) {
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await requireContact(client, organizationId, contactId);
    if (value.isPrimary) await client.query("UPDATE contact_people SET is_primary=false,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND contact_id=$2", [organizationId, contactId]);
    const id = createId("cpr");
    await client.query(
      `INSERT INTO contact_people(id,organization_id,contact_id,name,email,phone,role,is_primary) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, organizationId, contactId, value.name, value.email?.toLowerCase() ?? null, value.phone ?? null, value.role ?? null, value.isPrimary],
    );
    await auditContact(client, organizationId, actorId, "contact.person.created", "contact_person", id, { contactId, ...value });
    await client.query("COMMIT");
    return { id, ...value, email: value.email?.toLowerCase() ?? null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

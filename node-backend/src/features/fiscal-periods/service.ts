import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";

type Db = Pool | PoolClient;
export type FiscalStatus = "open" | "closed" | "locked";

async function audit(db: Db, organizationId: string, actorId: string, action: string, entityType: string, entityId: string, after?: unknown) {
  await db.query(
    `INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [createId("aud"), organizationId, actorId, action, entityType, entityId, after === undefined ? null : JSON.stringify(after)],
  );
}

export function normalizeFiscalStatus(status: "open" | "closed" | "locked" | "soft_closed"): FiscalStatus {
  return status === "soft_closed" ? "closed" : status;
}

export async function assertPostingDateOpen(db: Db, organizationId: string, postingDate: string): Promise<void> {
  const year = (
    await db.query<{ id: string; name: string; status: FiscalStatus }>(
      `SELECT id,name,status FROM fiscal_years
       WHERE organization_id=$1 AND $2::date BETWEEN starts_on AND ends_on
       ORDER BY starts_on DESC LIMIT 1`,
      [organizationId, postingDate],
    )
  ).rows[0];
  if (year && year.status !== "open") {
    throw new AppError(409, "FISCAL_YEAR_CLOSED", `Financial year ${year.name} is ${year.status}`);
  }

  const period = (
    await db.query<{ id: string; name: string; status: FiscalStatus }>(
      `SELECT id,name,status FROM fiscal_periods
       WHERE organization_id=$1 AND $2::date BETWEEN starts_on AND ends_on
       ORDER BY starts_on DESC LIMIT 1`,
      [organizationId, postingDate],
    )
  ).rows[0];
  if (period && period.status !== "open") {
    throw new AppError(409, "FISCAL_PERIOD_CLOSED", `Fiscal period ${period.name} is ${period.status}`);
  }
}

export async function createFiscalYear(runtime: Runtime, organizationId: string, actorId: string, input: { name: string; startsOn: string; endsOn: string }) {
  if (input.startsOn > input.endsOn) throw new AppError(422, "VALIDATION_ERROR", "A valid non-empty financial year range is required");
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`fiscal-years:${organizationId}`]);
    const overlap = await client.query(
      `SELECT id FROM fiscal_years WHERE organization_id=$1 AND starts_on<=$2::date AND ends_on>=$3::date LIMIT 1`,
      [organizationId, input.endsOn, input.startsOn],
    );
    if (overlap.rowCount) throw new AppError(409, "FISCAL_YEAR_OVERLAP", "Financial years cannot overlap");
    const id = createId("fyr");
    await client.query(
      `INSERT INTO fiscal_years(id,organization_id,name,starts_on,ends_on,status)
       VALUES($1,$2,$3,$4::date,$5::date,'open')`,
      [id, organizationId, input.name, input.startsOn, input.endsOn],
    );
    await audit(client, organizationId, actorId, "fiscal_year.created", "fiscal_year", id, input);
    await client.query("COMMIT");
    return { id, ...input, status: "open" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createFiscalPeriod(runtime: Runtime, organizationId: string, actorId: string, input: { fiscalYearId?: string | null; name: string; startsOn: string; endsOn: string }) {
  if (input.startsOn > input.endsOn) throw new AppError(422, "VALIDATION_ERROR", "A valid non-empty period range is required");
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`fiscal-periods:${organizationId}`]);
    if (input.fiscalYearId) {
      const year = (
        await client.query<{ startsOn: string; endsOn: string; status: FiscalStatus }>(
          `SELECT starts_on::text AS "startsOn",ends_on::text AS "endsOn",status FROM fiscal_years WHERE id=$1 AND organization_id=$2`,
          [input.fiscalYearId, organizationId],
        )
      ).rows[0];
      if (!year) throw new AppError(422, "INVALID_FISCAL_YEAR", "Financial year not found");
      if (year.status !== "open") throw new AppError(409, "FISCAL_YEAR_CLOSED", "New periods cannot be added to a closed or locked financial year");
      if (input.startsOn < year.startsOn || input.endsOn > year.endsOn) throw new AppError(422, "PERIOD_OUTSIDE_FISCAL_YEAR", "Fiscal period must be fully contained in its financial year");
    }
    const overlap = await client.query(
      `SELECT id FROM fiscal_periods WHERE organization_id=$1 AND starts_on<=$2::date AND ends_on>=$3::date LIMIT 1`,
      [organizationId, input.endsOn, input.startsOn],
    );
    if (overlap.rowCount) throw new AppError(409, "PERIOD_OVERLAP", "Fiscal periods cannot overlap");
    const id = createId("fpd");
    await client.query(
      `INSERT INTO fiscal_periods(id,organization_id,fiscal_year_id,name,starts_on,ends_on,status)
       VALUES($1,$2,$3,$4,$5::date,$6::date,'open')`,
      [id, organizationId, input.fiscalYearId ?? null, input.name, input.startsOn, input.endsOn],
    );
    await audit(client, organizationId, actorId, "fiscal_period.created", "fiscal_period", id, input);
    await client.query("COMMIT");
    return { id, ...input, status: "open" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertCanReopen(current: FiscalStatus, target: FiscalStatus, role: string, reason?: string) {
  if (current !== "locked" || target === "locked") return;
  if (!["owner", "admin"].includes(role)) throw new AppError(403, "FORBIDDEN", "Only an owner or administrator can reopen a locked accounting period");
  if (!reason?.trim()) throw new AppError(422, "REOPEN_REASON_REQUIRED", "A reason is required to reopen a locked accounting period");
}

export async function changeFiscalYearStatus(runtime: Runtime, organizationId: string, actorId: string, role: string, id: string, status: FiscalStatus, reason?: string) {
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const current = (await client.query<{ status: FiscalStatus }>("SELECT status FROM fiscal_years WHERE id=$1 AND organization_id=$2 FOR UPDATE", [id, organizationId])).rows[0];
    if (!current) throw new AppError(404, "NOT_FOUND", "Financial year not found");
    await assertCanReopen(current.status, status, role, reason);
    await client.query(
      `UPDATE fiscal_years SET status=$1,status_reason=$2,
       closed_at=CASE WHEN $1 IN ('closed','locked') THEN COALESCE(closed_at,CURRENT_TIMESTAMP) ELSE NULL END,
       closed_by=CASE WHEN $1 IN ('closed','locked') THEN COALESCE(closed_by,$3) ELSE NULL END,
       locked_at=CASE WHEN $1='locked' THEN CURRENT_TIMESTAMP ELSE NULL END,
       locked_by=CASE WHEN $1='locked' THEN $3 ELSE NULL END,
       updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND organization_id=$5`,
      [status, reason ?? null, actorId, id, organizationId],
    );
    if (status === "closed") {
      await client.query(`UPDATE fiscal_periods SET status='closed',closed_at=COALESCE(closed_at,CURRENT_TIMESTAMP),closed_by=COALESCE(closed_by,$1),updated_at=CURRENT_TIMESTAMP WHERE fiscal_year_id=$2 AND organization_id=$3 AND status='open'`, [actorId, id, organizationId]);
    } else if (status === "locked") {
      await client.query(`UPDATE fiscal_periods SET status='locked',closed_at=COALESCE(closed_at,CURRENT_TIMESTAMP),closed_by=COALESCE(closed_by,$1),locked_at=CURRENT_TIMESTAMP,locked_by=$1,updated_at=CURRENT_TIMESTAMP WHERE fiscal_year_id=$2 AND organization_id=$3 AND status<>'locked'`, [actorId, id, organizationId]);
    }
    await audit(client, organizationId, actorId, "fiscal_year.status_changed", "fiscal_year", id, { from: current.status, to: status, reason });
    await client.query("COMMIT");
    return { id, status };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function changeFiscalPeriodStatus(runtime: Runtime, organizationId: string, actorId: string, role: string, id: string, status: FiscalStatus, reason?: string) {
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    const current = (
      await client.query<{ status: FiscalStatus; fiscalYearId: string | null }>(
        `SELECT status,fiscal_year_id AS "fiscalYearId" FROM fiscal_periods WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [id, organizationId],
      )
    ).rows[0];
    if (!current) throw new AppError(404, "NOT_FOUND", "Fiscal period not found");
    await assertCanReopen(current.status, status, role, reason);
    if (status === "open" && current.fiscalYearId) {
      const year = (await client.query<{ status: FiscalStatus }>("SELECT status FROM fiscal_years WHERE id=$1 AND organization_id=$2", [current.fiscalYearId, organizationId])).rows[0];
      if (!year || year.status !== "open") throw new AppError(409, "FISCAL_YEAR_CLOSED", "The parent financial year must be open before this period can be reopened");
    }
    await client.query(
      `UPDATE fiscal_periods SET status=$1,status_reason=$2,
       closed_at=CASE WHEN $1 IN ('closed','locked') THEN COALESCE(closed_at,CURRENT_TIMESTAMP) ELSE NULL END,
       closed_by=CASE WHEN $1 IN ('closed','locked') THEN COALESCE(closed_by,$3) ELSE NULL END,
       locked_at=CASE WHEN $1='locked' THEN CURRENT_TIMESTAMP ELSE NULL END,
       locked_by=CASE WHEN $1='locked' THEN $3 ELSE NULL END,
       updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND organization_id=$5`,
      [status, reason ?? null, actorId, id, organizationId],
    );
    await audit(client, organizationId, actorId, "fiscal_period.status_changed", "fiscal_period", id, { from: current.status, to: status, reason });
    await client.query("COMMIT");
    return { id, status };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

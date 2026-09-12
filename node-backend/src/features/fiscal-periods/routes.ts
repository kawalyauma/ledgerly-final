import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { requireScope } from "../core-identity/security.js";
import { changeFiscalPeriodStatus, changeFiscalYearStatus, createFiscalPeriod, createFiscalYear, normalizeFiscalStatus } from "./service.js";

const rangeInput = z.object({ name: z.string().trim().min(1).max(80), startsOn: z.iso.date(), endsOn: z.iso.date() });
const periodInput = rangeInput.extend({ fiscalYearId: z.string().nullable().optional() });
const statusInput = z.object({ status: z.enum(["open", "closed", "locked", "soft_closed"]), reason: z.string().trim().min(3).max(500).optional() });

export function createFiscalYearRoutes(runtime: Runtime) {
  const router = new Hono<AppEnv>();
  router.get("/", requireScope("periods:read"), async (c) => {
    const p = c.get("principal");
    const result = await runtime.db.query(`SELECT id,name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",status,status_reason AS "statusReason",closed_at AS "closedAt",closed_by AS "closedBy",locked_at AS "lockedAt",locked_by AS "lockedBy",created_at AS "createdAt",updated_at AS "updatedAt" FROM fiscal_years WHERE organization_id=$1 ORDER BY starts_on DESC`, [p.organizationId]);
    return c.json({ data: result.rows });
  });
  router.post("/", requireScope("periods:write"), async (c) => {
    const parsed = rangeInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid financial year", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await createFiscalYear(runtime, p.organizationId, p.userId, parsed.data) }, 201);
  });
  router.get("/:id", requireScope("periods:read"), async (c) => {
    const p = c.get("principal"), id = c.req.param("id");
    const year = (await runtime.db.query(`SELECT id,name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",status,status_reason AS "statusReason",closed_at AS "closedAt",closed_by AS "closedBy",locked_at AS "lockedAt",locked_by AS "lockedBy" FROM fiscal_years WHERE id=$1 AND organization_id=$2`, [id, p.organizationId])).rows[0];
    if (!year) throw new AppError(404, "NOT_FOUND", "Financial year not found");
    const periods = await runtime.db.query(`SELECT id,name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",status,status_reason AS "statusReason",closed_at AS "closedAt",locked_at AS "lockedAt" FROM fiscal_periods WHERE fiscal_year_id=$1 AND organization_id=$2 ORDER BY starts_on`, [id, p.organizationId]);
    return c.json({ data: { ...year, periods: periods.rows } });
  });
  router.patch("/:id/status", requireScope("periods:write"), async (c) => {
    const parsed = statusInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid financial year status", parsed.error.flatten());
    const p = c.get("principal"), status = normalizeFiscalStatus(parsed.data.status);
    return c.json({ data: await changeFiscalYearStatus(runtime, p.organizationId, p.userId, p.role, c.req.param("id"), status, parsed.data.reason) });
  });
  return router;
}

export function createFiscalPeriodRoutes(runtime: Runtime) {
  const router = new Hono<AppEnv>();
  router.get("/", requireScope("periods:read"), async (c) => {
    const p = c.get("principal"), fiscalYearId = c.req.query("fiscalYearId");
    const result = fiscalYearId
      ? await runtime.db.query(`SELECT id,fiscal_year_id AS "fiscalYearId",name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",status,status_reason AS "statusReason",closed_at AS "closedAt",closed_by AS "closedBy",locked_at AS "lockedAt",locked_by AS "lockedBy" FROM fiscal_periods WHERE organization_id=$1 AND fiscal_year_id=$2 ORDER BY starts_on DESC`, [p.organizationId, fiscalYearId])
      : await runtime.db.query(`SELECT id,fiscal_year_id AS "fiscalYearId",name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",status,status_reason AS "statusReason",closed_at AS "closedAt",closed_by AS "closedBy",locked_at AS "lockedAt",locked_by AS "lockedBy" FROM fiscal_periods WHERE organization_id=$1 ORDER BY starts_on DESC`, [p.organizationId]);
    return c.json({ data: result.rows });
  });
  router.post("/", requireScope("periods:write"), async (c) => {
    const parsed = periodInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid fiscal period", parsed.error.flatten());
    const p = c.get("principal");
    return c.json({ data: await createFiscalPeriod(runtime, p.organizationId, p.userId, parsed.data) }, 201);
  });
  router.get("/:id", requireScope("periods:read"), async (c) => {
    const p = c.get("principal");
    const row = (await runtime.db.query(`SELECT id,fiscal_year_id AS "fiscalYearId",name,starts_on::text AS "startsOn",ends_on::text AS "endsOn",status,status_reason AS "statusReason",closed_at AS "closedAt",closed_by AS "closedBy",locked_at AS "lockedAt",locked_by AS "lockedBy",created_at AS "createdAt",updated_at AS "updatedAt" FROM fiscal_periods WHERE id=$1 AND organization_id=$2`, [c.req.param("id"), p.organizationId])).rows[0];
    if (!row) throw new AppError(404, "NOT_FOUND", "Fiscal period not found");
    return c.json({ data: row });
  });
  router.patch("/:id/status", requireScope("periods:write"), async (c) => {
    const parsed = statusInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid period status", parsed.error.flatten());
    const p = c.get("principal"), status = normalizeFiscalStatus(parsed.data.status);
    return c.json({ data: await changeFiscalPeriodStatus(runtime, p.organizationId, p.userId, p.role, c.req.param("id"), status, parsed.data.reason) });
  });
  return router;
}

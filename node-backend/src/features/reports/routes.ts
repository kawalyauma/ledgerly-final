import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";
import { reportContentTypes, type ReportFormat } from "./render.js";
import { generateReport, reportCatalog, reportTypes, type ReportFilters } from "./service.js";

const filterSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  asOf: z.iso.date().optional(),
  accountId: z.string().min(1).optional(),
  contactId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});
const exportInput = z.object({
  format: z.enum(["json","csv","xlsx","pdf"]).default("csv"),
  filters: filterSchema.default({}),
});

function queryFilters(c: { req: { query: (name: string) => string | undefined } }): ReportFilters {
  const raw = {
    from: c.req.query("from"), to: c.req.query("to"), asOf: c.req.query("asOf"), accountId: c.req.query("accountId"),
    contactId: c.req.query("contactId"), projectId: c.req.query("projectId"),
  };
  const parsed = filterSchema.safeParse(Object.fromEntries(Object.entries(raw).filter(([,value]) => value !== undefined && value !== "")));
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid report filters", parsed.error.flatten());
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) throw new AppError(422, "INVALID_DATE_RANGE", "Report start date cannot be after end date");
  return parsed.data;
}

function assertReport(type: string) {
  if (!reportTypes.includes(type as never)) throw new AppError(404, "UNKNOWN_REPORT", "Unknown report type");
}

export function createReportRoutes(runtime: Runtime) {
  const router = new Hono<AppEnv>();

  router.get("/", requireScope("reports:read"), (c) => c.json({ data: reportCatalog }));

  router.get("/exports/:id/status", requireScope("reports:read"), async (c) => {
    const principal = c.get("principal");
    const job = (await runtime.db.query(
      `SELECT id,report_type AS "reportType",format,status,object_key AS "objectKey",content_type AS "contentType",size_bytes::float8 AS "sizeBytes",
        error,created_at AS "createdAt",started_at AS "startedAt",completed_at AS "completedAt"
       FROM report_jobs WHERE id=$1 AND organization_id=$2`, [c.req.param("id"), principal.organizationId],
    )).rows[0];
    if (!job) throw new AppError(404, "NOT_FOUND", "Report job not found");
    return c.json({ data: job });
  });

  router.get("/exports/:id/download", requireScope("reports:read"), async (c) => {
    const principal = c.get("principal");
    const job = (await runtime.db.query<{ objectKey: string | null; format: ReportFormat; contentType: string | null }>(
      `SELECT object_key AS "objectKey",format,content_type AS "contentType" FROM report_jobs
       WHERE id=$1 AND organization_id=$2 AND status='completed'`, [c.req.param("id"), principal.organizationId],
    )).rows[0];
    if (!job?.objectKey) throw new AppError(404, "REPORT_NOT_READY", "Completed report not found");
    const body = await runtime.storage.get(job.objectKey);
    if (!body) throw new AppError(404, "FILE_NOT_FOUND", "Report export file not found");
    c.header("Content-Type", job.contentType ?? reportContentTypes[job.format]);
    c.header("Content-Disposition", `attachment; filename="${c.req.param("id")}.${job.format}"`);
    c.header("Content-Length", String(body.byteLength));
    return c.body(body);
  });

  router.post("/:type/exports", requireScope("reports:write"), async (c) => {
    const type = c.req.param("type"); assertReport(type);
    const parsed = exportInput.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid report export request", parsed.error.flatten());
    if (parsed.data.filters.from && parsed.data.filters.to && parsed.data.filters.from > parsed.data.filters.to) {
      throw new AppError(422, "INVALID_DATE_RANGE", "Report start date cannot be after end date");
    }
    const definition = reportCatalog.find((item) => item.id === type)!;
    if (!definition.available) throw new AppError(409, "REPORT_DEPENDENCY_NOT_MIGRATED", `${definition.name} requires the ${definition.dependency} feature to be migrated first`);
    const principal = c.get("principal"), id = createId("rpt");
    await runtime.db.query(
      `INSERT INTO report_jobs(id,organization_id,requested_by,report_type,format,filters,status)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,'queued')`,
      [id, principal.organizationId, principal.userId, type, parsed.data.format, JSON.stringify(parsed.data.filters)],
    );
    try {
      const queueJobId = await runtime.queue.publish("report.export", { reportJobId: id }, { queue: "reports", maxAttempts: 5 });
      await runtime.db.query("UPDATE report_jobs SET queue_job_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [queueJobId, id]);
    } catch (error) {
      await runtime.db.query("UPDATE report_jobs SET status='failed',error=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2", [error instanceof Error ? error.message : String(error), id]);
      throw error;
    }
    return c.json({ data: { id, reportType: type, format: parsed.data.format, status: "queued" } }, 202);
  });

  router.get("/:type", requireScope("reports:read"), async (c) => {
    const type = c.req.param("type"); assertReport(type);
    const principal = c.get("principal");
    return c.json({ data: await generateReport(runtime, principal.organizationId, type, queryFilters(c)) });
  });

  return router;
}

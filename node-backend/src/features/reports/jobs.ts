import type { ClaimedJob } from "../../queue/postgres-queue.js";
import type { Runtime } from "../../runtime.js";
import type { BudgetReportFilters } from "../budgets/service.js";
import { renderReport, reportContentTypes, type ReportFormat } from "./render.js";
import { runExtendedReport } from "./routes.js";
import type { ReportFilters } from "./service.js";

type ReportExportPayload = { reportJobId: string };
type ExportFilters = ReportFilters & BudgetReportFilters & { productId?: string; locationId?: string };

export async function handleReportExport(job: ClaimedJob, runtime: Runtime): Promise<void> {
  const payload = job.payload as Partial<ReportExportPayload>;
  if (!payload.reportJobId) throw new Error("report.export job is missing reportJobId");
  const record = (await runtime.db.query<{ id:string;organizationId:string;reportType:string;format:ReportFormat;filters:ExportFilters;status:string }>(
    `SELECT id,organization_id AS "organizationId",report_type AS "reportType",format,filters,status FROM report_jobs WHERE id=$1`,[payload.reportJobId],
  )).rows[0];
  if (!record) throw new Error(`Report job ${payload.reportJobId} not found`);
  if (record.status === "completed") return;
  await runtime.db.query(`UPDATE report_jobs SET status='running',started_at=COALESCE(started_at,CURRENT_TIMESTAMP),error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[record.id]);
  try {
    const report = await runExtendedReport(runtime,record.organizationId,record.reportType,record.filters??{});
    const organization=(await runtime.db.query<{name:string}>("SELECT name FROM organizations WHERE id=$1",[record.organizationId])).rows[0];
    const body=await renderReport(report,record.format,organization?.name??"Ledgerly");
    const key=`reports/${record.organizationId}/${record.id}.${record.format}`;
    await runtime.storage.put(key,body,reportContentTypes[record.format]);
    await runtime.db.query(`UPDATE report_jobs SET status='completed',object_key=$1,content_type=$2,size_bytes=$3,error=NULL,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$4`,[key,reportContentTypes[record.format],body.byteLength,record.id]);
  } catch(error) {
    await runtime.db.query(`UPDATE report_jobs SET status='failed',error=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[error instanceof Error?error.message:String(error),record.id]);
    throw error;
  }
}

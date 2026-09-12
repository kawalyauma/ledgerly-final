import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";
import { effectiveReportCatalog, runExtendedReport } from "../reports/routes.js";
import { reportTypes } from "../reports/service.js";

const filterValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const reportFilters = z.record(z.string(), filterValue).default({});

function assertReportType(type: string) {
  if (!reportTypes.includes(type as never)) throw new AppError(422, "UNKNOWN_REPORT", "Unknown report type");
}

const savedInput = z.object({
  name: z.string().min(1).max(120), reportType: z.string(), filters: reportFilters,
  columns: z.array(z.string()).max(100).default([]), visibility: z.enum(["private", "organization"]).default("private"),
});
const packageDefinition = z.object({ title: z.string().min(1).max(120), reportType: z.string(), filters: reportFilters });
const packageInput = z.object({ name: z.string().min(1).max(120), description: z.string().max(500).optional(), reports: z.array(packageDefinition).min(1).max(30) });
const layoutInput = z.object({
  name: z.string().min(1).max(120), reportType: z.string(), groups: z.array(z.unknown()).default([]),
  columns: z.array(z.unknown()).default([]), branding: z.record(z.string(), z.unknown()).default({}),
});
const annotationInput = z.object({ reportType: z.string(), periodKey: z.string().min(1).max(30), text: z.string().min(1).max(5000) });
const scheduleInput = z.object({
  name: z.string().min(1).max(120), reportType: z.string(), format: z.enum(["json","csv","xlsx","pdf"]), filters: reportFilters,
  cadence: z.enum(["hourly","daily","weekly","monthly"]), recipients: z.array(z.email()).max(50).default([]), nextRunAt: z.iso.datetime(),
});
const widget = z.object({
  id: z.string().min(1), type: z.enum(["kpi","chart","table"]), reportType: z.string(), title: z.string().max(100),
  x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().min(1).max(12), height: z.number().int().min(1).max(12),
  filters: reportFilters,
});
const dashboardInput = z.object({ name: z.string().min(1).max(120), visibility: z.enum(["private","organization"]).default("private"), isDefault: z.boolean().default(false), layout: z.array(widget).max(50) });

export function createReportLibraryRoutes(runtime: Runtime) {
  const router = new Hono<AppEnv>();
  router.get("/saved", requireScope("reports:read"), async (c) => {
    const p = c.get("principal");
    const rows = (await runtime.db.query(`SELECT id,name,report_type AS "reportType",filters,columns,visibility,owner_id AS "ownerId" FROM saved_reports WHERE organization_id=$1 AND (visibility='organization' OR owner_id=$2) ORDER BY name`, [p.organizationId,p.userId])).rows;
    return c.json({ data: rows });
  });
  router.post("/saved", requireScope("reports:write"), async (c) => {
    const parsed=savedInput.safeParse(await c.req.json()); if(!parsed.success) throw new AppError(422,"VALIDATION_ERROR","Invalid saved report",parsed.error.flatten());
    assertReportType(parsed.data.reportType); const p=c.get("principal"), id=createId("svr");
    await runtime.db.query(`INSERT INTO saved_reports(id,organization_id,owner_id,name,report_type,filters,columns,visibility) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,[id,p.organizationId,p.userId,parsed.data.name,parsed.data.reportType,JSON.stringify(parsed.data.filters),JSON.stringify(parsed.data.columns),parsed.data.visibility]);
    return c.json({data:{id,...parsed.data}},201);
  });
  router.put("/saved/:id", requireScope("reports:write"), async (c) => {
    const parsed=savedInput.safeParse(await c.req.json()); if(!parsed.success) throw new AppError(422,"VALIDATION_ERROR","Invalid saved report",parsed.error.flatten()); assertReportType(parsed.data.reportType);
    const p=c.get("principal"), result=await runtime.db.query(`UPDATE saved_reports SET name=$1,report_type=$2,filters=$3::jsonb,columns=$4::jsonb,visibility=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$6 AND organization_id=$7 AND owner_id=$8 RETURNING id`,[parsed.data.name,parsed.data.reportType,JSON.stringify(parsed.data.filters),JSON.stringify(parsed.data.columns),parsed.data.visibility,c.req.param("id"),p.organizationId,p.userId]);
    if(!result.rowCount) throw new AppError(404,"NOT_FOUND","Saved report not found"); return c.json({data:{id:c.req.param("id"),...parsed.data}});
  });
  router.delete("/saved/:id", requireScope("reports:write"), async (c) => { const p=c.get("principal"); await runtime.db.query("DELETE FROM saved_reports WHERE id=$1 AND organization_id=$2 AND owner_id=$3",[c.req.param("id"),p.organizationId,p.userId]); return c.body(null,204); });

  router.get("/packages", requireScope("reports:read"), async (c)=>{const p=c.get("principal"); const rows=(await runtime.db.query(`SELECT id,name,description,report_definitions AS reports,owner_id AS "ownerId" FROM report_packages WHERE organization_id=$1 ORDER BY name`,[p.organizationId])).rows; return c.json({data:rows});});
  router.post("/packages", requireScope("reports:write"), async (c)=>{const parsed=packageInput.safeParse(await c.req.json());if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid report package",parsed.error.flatten());for(const r of parsed.data.reports)assertReportType(r.reportType);const p=c.get("principal"),id=createId("rpk");await runtime.db.query(`INSERT INTO report_packages(id,organization_id,owner_id,name,description,report_definitions) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,[id,p.organizationId,p.userId,parsed.data.name,parsed.data.description??null,JSON.stringify(parsed.data.reports)]);return c.json({data:{id,...parsed.data}},201);});
  router.post("/packages/:id/generate", requireScope("reports:read"), async (c)=>{const p=c.get("principal");const pack=(await runtime.db.query<{name:string;description:string|null;reports:z.infer<typeof packageDefinition>[]}>(`SELECT name,description,report_definitions AS reports FROM report_packages WHERE id=$1 AND organization_id=$2`,[c.req.param("id"),p.organizationId])).rows[0];if(!pack)throw new AppError(404,"NOT_FOUND","Report package not found");const reports=[];for(const item of pack.reports)reports.push({title:item.title,data:await runExtendedReport(runtime,p.organizationId,item.reportType,item.filters)});return c.json({data:{id:c.req.param("id"),name:pack.name,description:pack.description,generatedAt:new Date().toISOString(),reports}});});

  router.get("/layouts",requireScope("reports:read"),async(c)=>{const p=c.get("principal");return c.json({data:(await runtime.db.query(`SELECT id,name,report_type AS "reportType",groups_json AS groups,columns_json AS columns,branding_json AS branding,active FROM report_layouts WHERE organization_id=$1 ORDER BY name`,[p.organizationId])).rows});});
  router.post("/layouts",requireScope("reports:write"),async(c)=>{const parsed=layoutInput.safeParse(await c.req.json());if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid report layout",parsed.error.flatten());assertReportType(parsed.data.reportType);const p=c.get("principal"),id=createId("rly");await runtime.db.query(`INSERT INTO report_layouts(id,organization_id,name,report_type,groups_json,columns_json,branding_json) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)`,[id,p.organizationId,parsed.data.name,parsed.data.reportType,JSON.stringify(parsed.data.groups),JSON.stringify(parsed.data.columns),JSON.stringify(parsed.data.branding)]);return c.json({data:{id,...parsed.data}},201);});

  router.post("/annotations",requireScope("reports:write"),async(c)=>{const parsed=annotationInput.safeParse(await c.req.json());if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid report annotation",parsed.error.flatten());assertReportType(parsed.data.reportType);const p=c.get("principal"),id=createId("ran");await runtime.db.query(`INSERT INTO report_annotations(id,organization_id,report_type,period_key,text,created_by) VALUES($1,$2,$3,$4,$5,$6)`,[id,p.organizationId,parsed.data.reportType,parsed.data.periodKey,parsed.data.text,p.userId]);return c.json({data:{id,status:"draft",...parsed.data}},201);});
  router.post("/annotations/:id/sign-off",requireScope("reports:write"),async(c)=>{const p=c.get("principal");const result=await runtime.db.query(`UPDATE report_annotations SET status='signed_off',signed_off_by=$1,signed_off_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3 AND status='draft' AND created_by<>$1 RETURNING id`,[p.userId,c.req.param("id"),p.organizationId]);if(!result.rowCount)throw new AppError(409,"MAKER_CHECKER_VIOLATION","Annotation must be signed off by another user");return c.json({data:{id:c.req.param("id"),status:"signed_off"}});});
  return router;
}

export function createReportScheduleRoutes(runtime: Runtime) {
  const router=new Hono<AppEnv>();
  router.get("/",requireScope("reports:read"),async(c)=>{const p=c.get("principal");return c.json({data:(await runtime.db.query(`SELECT id,name,report_type AS "reportType",format,filters,cron AS cadence,recipients,active,next_run_at AS "nextRunAt",last_run_at AS "lastRunAt",last_job_id AS "lastJobId" FROM report_schedules WHERE organization_id=$1 ORDER BY name`,[p.organizationId])).rows});});
  router.post("/",requireScope("reports:write"),async(c)=>{const parsed=scheduleInput.safeParse(await c.req.json());if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid report schedule",parsed.error.flatten());assertReportType(parsed.data.reportType);const definition=effectiveReportCatalog().find((r)=>r.id===parsed.data.reportType);if(!definition?.available)throw new AppError(409,"REPORT_DEPENDENCY_NOT_MIGRATED",`${definition?.name??parsed.data.reportType} is not available yet`);const p=c.get("principal"),id=createId("rsc");await runtime.db.query(`INSERT INTO report_schedules(id,organization_id,owner_id,name,report_type,format,filters,cron,recipients,next_run_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10::timestamptz)`,[id,p.organizationId,p.userId,parsed.data.name,parsed.data.reportType,parsed.data.format,JSON.stringify(parsed.data.filters),parsed.data.cadence,JSON.stringify(parsed.data.recipients),parsed.data.nextRunAt]);return c.json({data:{id,active:true,...parsed.data}},201);});
  router.delete("/:id",requireScope("reports:write"),async(c)=>{const p=c.get("principal");await runtime.db.query(`UPDATE report_schedules SET active=false,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`,[c.req.param("id"),p.organizationId]);return c.body(null,204);});
  return router;
}

export function createDashboardRoutes(runtime: Runtime) {
  const router=new Hono<AppEnv>();
  router.get("/summary",requireScope("reports:read"),async(c)=>{const p=c.get("principal"),now=new Date(),to=now.toISOString().slice(0,10),from=`${to.slice(0,7)}-01`;const [identity,cash,periodCash,outstanding,recent,monthly]=await Promise.all([
    runtime.db.query<{name:string;baseCurrency:string;userName:string}>(`SELECT o.name,o.base_currency AS "baseCurrency",u.display_name AS "userName" FROM organizations o JOIN users u ON u.id=$1 WHERE o.id=$2`,[p.userId,p.organizationId]),
    runtime.db.query(`SELECT COALESCE(SUM(l.base_debit_minor-l.base_credit_minor),0)::float8 AS "balanceMinor" FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.organization_id=$1 AND j.status IN ('posted','reversed') AND a.subtype='cash' AND j.posting_date<=$2::date`,[p.organizationId,to]),
    runtime.db.query(`SELECT COALESCE(SUM(l.base_debit_minor),0)::float8 AS "moneyInMinor",COALESCE(SUM(l.base_credit_minor),0)::float8 AS "moneyOutMinor" FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.organization_id=$1 AND j.status IN ('posted','reversed') AND a.subtype='cash' AND j.posting_date BETWEEN $2::date AND $3::date`,[p.organizationId,from,to]),
    runtime.db.query(`SELECT COALESCE(SUM(total_minor-paid_minor),0)::float8 AS "outstandingMinor",COUNT(*)::int AS "outstandingCount" FROM documents WHERE organization_id=$1 AND type='invoice' AND status IN ('open','partially_paid')`,[p.organizationId]),
    runtime.db.query(`SELECT j.id,j.entry_number AS "entryNumber",j.posting_date::text AS "postingDate",j.description,j.reference,j.status,j.currency,COALESCE(SUM(CASE WHEN a.subtype='cash' THEN l.debit_minor-l.credit_minor ELSE 0 END),0)::float8 AS "cashDeltaMinor" FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id=j.id AND l.organization_id=j.organization_id JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE j.organization_id=$1 AND j.status IN ('posted','reversed') GROUP BY j.id ORDER BY j.posting_date DESC,j.entry_number DESC LIMIT 5`,[p.organizationId]),
    runtime.db.query(`SELECT to_char(date_trunc('month',j.posting_date),'YYYY-MM') AS month,COALESCE(SUM(l.base_debit_minor),0)::float8 AS "moneyInMinor",COALESCE(SUM(l.base_credit_minor),0)::float8 AS "moneyOutMinor" FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.organization_id=$1 AND j.status IN ('posted','reversed') AND a.subtype='cash' AND j.posting_date>=date_trunc('month',$2::date)-interval '11 months' GROUP BY 1 ORDER BY 1`,[p.organizationId,to]),
  ]);const ident=identity.rows[0];if(!ident)throw new AppError(404,"NOT_FOUND","Organization not found");const map=new Map(monthly.rows.map((r:any)=>[String(r.month),r]));const cashFlow=Array.from({length:12},(_,i)=>{const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-11+i,1)),month=d.toISOString().slice(0,7),row:any=map.get(month);return{month,moneyInMinor:Number(row?.moneyInMinor??0),moneyOutMinor:Number(row?.moneyOutMinor??0)}});const cashRow:any=cash.rows[0]??{},periodRow:any=periodCash.rows[0]??{},out:any=outstanding.rows[0]??{};return c.json({data:{organization:{name:ident.name,baseCurrency:ident.baseCurrency},user:{name:ident.userName},period:{from,to,label:now.toLocaleDateString("en",{month:"long",year:"numeric",timeZone:"UTC"})},metrics:{balanceMinor:Number(cashRow.balanceMinor??0),moneyInMinor:Number(periodRow.moneyInMinor??0),moneyOutMinor:Number(periodRow.moneyOutMinor??0),outstandingMinor:Number(out.outstandingMinor??0),outstandingCount:Number(out.outstandingCount??0)},cashFlow,transactions:recent.rows.map((r:any)=>{const delta=Number(r.cashDeltaMinor??0);return{...r,amountMinor:Math.abs(delta),direction:delta>=0?"income":"expense"}}),generatedAt:new Date().toISOString()}});});
  router.get("/",requireScope("reports:read"),async(c)=>{const p=c.get("principal");return c.json({data:(await runtime.db.query(`SELECT id,name,visibility,layout,is_default AS "isDefault",owner_id AS "ownerId" FROM dashboards WHERE organization_id=$1 AND (visibility='organization' OR owner_id=$2) ORDER BY is_default DESC,name`,[p.organizationId,p.userId])).rows});});
  router.post("/",requireScope("reports:write"),async(c)=>{const parsed=dashboardInput.safeParse(await c.req.json());if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid dashboard",parsed.error.flatten());for(const w of parsed.data.layout)assertReportType(w.reportType);const p=c.get("principal"),id=createId("dsh"),client=await runtime.db.connect();try{await client.query("BEGIN");if(parsed.data.isDefault)await client.query("UPDATE dashboards SET is_default=false WHERE organization_id=$1 AND owner_id=$2",[p.organizationId,p.userId]);await client.query(`INSERT INTO dashboards(id,organization_id,owner_id,name,visibility,layout,is_default) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,[id,p.organizationId,p.userId,parsed.data.name,parsed.data.visibility,JSON.stringify(parsed.data.layout),parsed.data.isDefault]);await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}return c.json({data:{id,...parsed.data}},201);});
  router.put("/:id",requireScope("reports:write"),async(c)=>{const parsed=dashboardInput.safeParse(await c.req.json());if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid dashboard",parsed.error.flatten());for(const w of parsed.data.layout)assertReportType(w.reportType);const p=c.get("principal"),client=await runtime.db.connect();try{await client.query("BEGIN");const own=(await client.query("SELECT id FROM dashboards WHERE id=$1 AND organization_id=$2 AND owner_id=$3 FOR UPDATE",[c.req.param("id"),p.organizationId,p.userId])).rows[0];if(!own)throw new AppError(404,"NOT_FOUND","Dashboard not found");if(parsed.data.isDefault)await client.query("UPDATE dashboards SET is_default=false WHERE organization_id=$1 AND owner_id=$2",[p.organizationId,p.userId]);await client.query(`UPDATE dashboards SET name=$1,visibility=$2,layout=$3::jsonb,is_default=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$5`,[parsed.data.name,parsed.data.visibility,JSON.stringify(parsed.data.layout),parsed.data.isDefault,c.req.param("id")]);await client.query("COMMIT");}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}return c.json({data:{id:c.req.param("id"),...parsed.data}});});
  router.get("/:id/data",requireScope("reports:read"),async(c)=>{const p=c.get("principal");const dashboard=(await runtime.db.query<{layout:z.infer<typeof widget>[]}>(`SELECT layout FROM dashboards WHERE id=$1 AND organization_id=$2 AND (visibility='organization' OR owner_id=$3)`,[c.req.param("id"),p.organizationId,p.userId])).rows[0];if(!dashboard)throw new AppError(404,"NOT_FOUND","Dashboard not found");const data=[];for(const item of dashboard.layout){try{data.push({widgetId:item.id,status:"ok",report:await runExtendedReport(runtime,p.organizationId,item.reportType,item.filters)});}catch(error){data.push({widgetId:item.id,status:"error",message:error instanceof Error?error.message:String(error)});}}return c.json({data});});
  return router;
}

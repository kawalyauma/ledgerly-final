import type { ClaimedJob } from "../../queue/postgres-queue.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";

export function nextScheduleAt(from: Date, cadence: "hourly"|"daily"|"weekly"|"monthly") {
  const next=new Date(from);
  if(cadence==="hourly") next.setUTCHours(next.getUTCHours()+1);
  else if(cadence==="daily") next.setUTCDate(next.getUTCDate()+1);
  else if(cadence==="weekly") next.setUTCDate(next.getUTCDate()+7);
  else next.setUTCMonth(next.getUTCMonth()+1);
  return next;
}

export async function handleReportScheduleScan(_job: ClaimedJob, runtime: Runtime): Promise<void> {
  const due=(await runtime.db.query<{id:string;organizationId:string;ownerId:string;reportType:string;format:string;filters:Record<string,unknown>;cadence:"hourly"|"daily"|"weekly"|"monthly";nextRunAt:string}>(
    `SELECT id,organization_id AS "organizationId",owner_id AS "ownerId",report_type AS "reportType",format,filters,cron AS cadence,next_run_at AS "nextRunAt"
     FROM report_schedules WHERE active=true AND next_run_at<=CURRENT_TIMESTAMP ORDER BY next_run_at LIMIT 100`,
  )).rows;
  for(const schedule of due){
    const scheduledFor=new Date(schedule.nextRunAt);
    const next=nextScheduleAt(scheduledFor,schedule.cadence);
    const client=await runtime.db.connect();
    let reportJobId:string|undefined;
    try{
      await client.query("BEGIN");
      const claimed=await client.query(`UPDATE report_schedules SET last_run_at=next_run_at,next_run_at=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND active=true AND next_run_at<=CURRENT_TIMESTAMP RETURNING id`,[next.toISOString(),schedule.id]);
      if(!claimed.rowCount){await client.query("ROLLBACK");continue;}
      reportJobId=createId("rpt");
      await client.query(`INSERT INTO report_jobs(id,organization_id,requested_by,report_type,format,filters,status) VALUES($1,$2,$3,$4,$5,$6::jsonb,'queued')`,[reportJobId,schedule.organizationId,schedule.ownerId,schedule.reportType,schedule.format,JSON.stringify(schedule.filters??{})]);
      await client.query(`UPDATE report_schedules SET last_job_id=$1 WHERE id=$2`,[reportJobId,schedule.id]);
      await client.query("COMMIT");
    }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
    if(!reportJobId)continue;
    try{
      const queueJobId=await runtime.queue.publish("report.export",{reportJobId},{queue:"reports",maxAttempts:5});
      await runtime.db.query(`UPDATE report_jobs SET queue_job_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[queueJobId,reportJobId]);
    }catch(error){
      await runtime.db.query(`UPDATE report_jobs SET status='failed',error=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[error instanceof Error?error.message:String(error),reportJobId]);
      throw error;
    }
  }
}

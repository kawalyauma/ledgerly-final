import type { ClaimedJob } from '../../queue/postgres-queue.js';
import type { Runtime } from '../../runtime.js';
import { createId } from '../core-identity/security.js';

export async function sweepPrinterlyHealth(_job:ClaimedJob,runtime:Runtime){
 const stale=await runtime.db.query(`SELECT id,organization_id,name FROM prn_nodes WHERE revoked_at IS NULL AND status='online' AND (last_seen_at IS NULL OR last_seen_at<CURRENT_TIMESTAMP-INTERVAL '90 seconds') LIMIT 200`);
 for(const n of stale.rows as any[]){
  await runtime.db.query(`UPDATE prn_nodes SET status='offline',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`,[n.id,n.organization_id]);
  await runtime.db.query(`UPDATE prn_printers SET status='offline',health_status='critical',health_message='Printerly Node is offline',last_health_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE node_id=$1 AND organization_id=$2`,[n.id,n.organization_id]);
  await runtime.db.query(`INSERT INTO prn_alerts(id,organization_id,fingerprint,event_type,severity,title,body,entity_type,entity_id) VALUES($1,$2,$3,'printerly.node_offline','critical',$4,$5,'node',$6) ON CONFLICT (organization_id,fingerprint) WHERE resolved_at IS NULL DO UPDATE SET updated_at=CURRENT_TIMESTAMP`,[createId('prnalert'),n.organization_id,`node-offline:${n.id}`,`Printerly Node offline · ${n.name}`,`${n.name} has stopped reporting to Ledgerly.`,n.id]);
 }
 const jobs=await runtime.db.query(`SELECT j.id,j.organization_id,j.printer_id,j.route_pool_id FROM prn_jobs j JOIN prn_printers p ON p.id=j.printer_id AND p.organization_id=j.organization_id WHERE j.status='queued' AND j.route_pool_id IS NOT NULL AND (p.status<>'ready' OR p.health_status='critical') LIMIT 200`);
 for(const j of jobs.rows as any[]){
  const alt=await runtime.db.query(`SELECT p.id FROM prn_printer_pool_members m JOIN prn_printers p ON p.id=m.printer_id AND p.organization_id=m.organization_id WHERE m.organization_id=$1 AND m.pool_id=$2 AND m.enabled=true AND p.id<>$3 AND p.status='ready' AND p.health_status<>'critical' ORDER BY m.priority,p.name LIMIT 1`,[j.organization_id,j.route_pool_id,j.printer_id]);
  if(!alt.rowCount)continue;
  const to=(alt.rows[0] as any).id,moved=await runtime.db.query(`UPDATE prn_jobs SET printer_id=$1,route_reason='Automatic health failover',routed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3 AND status='queued' AND printer_id=$4 RETURNING id`,[to,j.id,j.organization_id,j.printer_id]);
  if(moved.rowCount)await runtime.db.query(`INSERT INTO prn_job_events(id,organization_id,job_id,event_type,details) VALUES($1,$2,$3,'automatic_failover',$4::jsonb)`,[createId('prnev'),j.organization_id,j.id,JSON.stringify({fromPrinterId:j.printer_id,toPrinterId:to})]);
 }
}

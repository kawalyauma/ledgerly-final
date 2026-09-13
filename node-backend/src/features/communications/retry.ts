import type { ClaimedJob } from "../../queue/postgres-queue.js";
import type { Runtime } from "../../runtime.js";

export async function retryFailedCommunicationDeliveries(_job:ClaimedJob,runtime:Runtime):Promise<void>{
 const client=await runtime.db.connect(),campaigns=new Set<string>();
 try{
  await client.query("BEGIN");
  const q=await client.query<{id:string;campaign_id:string;organization_id:string}>(`SELECT id,campaign_id,organization_id FROM communication_deliveries WHERE status='failed' AND attempts<4 AND failed_at IS NOT NULL AND failed_at<=CURRENT_TIMESTAMP-CASE WHEN attempts<=1 THEN INTERVAL '1 minute' WHEN attempts=2 THEN INTERVAL '5 minutes' ELSE INTERVAL '15 minutes' END ORDER BY failed_at,id FOR UPDATE SKIP LOCKED LIMIT 250`);
  if(!q.rowCount){await client.query("COMMIT");return;}
  await client.query(`UPDATE communication_deliveries SET status='queued',failed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=ANY($1::text[])`,[q.rows.map(x=>x.id)]);
  for(const x of q.rows){campaigns.add(`${x.organization_id}|${x.campaign_id}`);await client.query(`UPDATE communication_campaigns SET status='queued',completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND status<>'cancelled'`,[x.campaign_id,x.organization_id]);}
  await client.query("COMMIT");
 }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
 for(const key of campaigns){const [organizationId,campaignId]=key.split("|");if(organizationId&&campaignId)await runtime.queue.publish("communications.dispatch",{organizationId,campaignId},{queue:"communications"});}
}

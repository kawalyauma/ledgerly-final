import type { ClaimedJob } from '../../queue/postgres-queue.js';
import type { Runtime } from '../../runtime.js';

export async function sweepNvrRetention(_job:ClaimedJob,runtime:Runtime){
  const orgs=await runtime.db.query(`SELECT id FROM organizations WHERE status='active' ORDER BY id LIMIT 1000`);
  for(const org of orgs.rows as any[]){
    const p=await runtime.db.query(`SELECT enabled,recording_days FROM nvr_retention_policies WHERE organization_id=$1`,[org.id]);
    const policy:any=p.rows[0]??{enabled:true,recording_days:14};
    if(!policy.enabled)continue;
    await runtime.db.query(`UPDATE nvr_recordings SET retention_until=COALESCE(retention_until,started_at+($2::text||' days')::interval) WHERE organization_id=$1 AND status='ready' AND retention_until IS NULL`,[org.id,String(Number(policy.recording_days||14))]);
    const due=await runtime.db.query(`SELECT id,upload_state,object_key FROM nvr_recordings WHERE organization_id=$1 AND status='ready' AND retention_until<=CURRENT_TIMESTAMP AND purged_at IS NULL ORDER BY retention_until LIMIT 200`,[org.id]);
    for(const rec of due.rows as any[]){
      if(rec.upload_state==='chunked'){
        const chunks=await runtime.db.query(`SELECT object_key FROM nvr_recording_chunks WHERE organization_id=$1 AND recording_id=$2 ORDER BY chunk_index`,[org.id,rec.id]);
        for(const ch of chunks.rows as any[])await runtime.storage.delete(ch.object_key).catch(()=>{});
      }else if(rec.object_key){await runtime.storage.delete(rec.object_key).catch(()=>{});}
      await runtime.db.query(`UPDATE nvr_recordings SET status='deleted',purged_at=CURRENT_TIMESTAMP,purge_reason='retention-expired' WHERE id=$1 AND organization_id=$2 AND purged_at IS NULL`,[rec.id,org.id]);
    }
  }
}

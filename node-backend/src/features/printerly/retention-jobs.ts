import type { ClaimedJob } from '../../queue/postgres-queue.js';
import type { Runtime } from '../../runtime.js';
import { createId } from '../core-identity/security.js';

export async function sweepPrinterlyRetention(_job:ClaimedJob,runtime:Runtime){
  const orgs=await runtime.db.query(`SELECT id FROM organizations WHERE status='active' ORDER BY id LIMIT 1000`);
  for(const org of orgs.rows as any[]){
    const pq=await runtime.db.query(`SELECT enabled,staged_hours,completed_print_days,failed_print_days,secure_print_minutes FROM prn_retention_policies WHERE organization_id=$1`,[org.id]);
    const p:any=pq.rows[0]??{enabled:true,staged_hours:24,completed_print_days:7,failed_print_days:7,secure_print_minutes:10};
    if(!p.enabled)continue;
    const docs=await runtime.db.query(`SELECT d.*,j.id AS job_id,j.status AS job_status,j.secure_release,j.completed_at,j.updated_at AS job_updated_at FROM prn_documents d LEFT JOIN prn_jobs j ON j.document_id=d.id AND j.organization_id=d.organization_id WHERE d.organization_id=$1 AND d.retention_purged_at IS NULL AND d.status<>'deleted' ORDER BY d.created_at LIMIT 500`,[org.id]);
    for(const d of docs.rows as any[]){
      const h=await runtime.db.query(`SELECT 1 FROM prn_retention_holds WHERE organization_id=$1 AND released_at IS NULL AND ((entity_type='print_document' AND entity_id=$2) OR (entity_type='print_job' AND entity_id=$3)) LIMIT 1`,[org.id,d.id,d.job_id??'']);
      if(h.rowCount)continue;
      let due=false,reason='';
      if(d.status==='staged'){due=Date.now()-new Date(d.created_at).getTime()>=Number(p.staged_hours)*3600000;reason='staged-expired';}
      else if(d.job_id&&['completed','failed','cancelled'].includes(d.job_status)){
        const at=new Date(d.completed_at||d.job_updated_at||d.attached_at||d.created_at).getTime();
        if(d.secure_release){due=Date.now()-at>=Number(p.secure_print_minutes)*60000;reason='secure-print-retention';}
        else{const days=d.job_status==='completed'?Number(p.completed_print_days):Number(p.failed_print_days);due=Date.now()-at>=days*86400000;reason=d.job_status==='completed'?'completed-print-retention':'failed-print-retention';}
      }
      if(!due)continue;
      await runtime.storage.delete(d.object_key);
      await runtime.db.query(`UPDATE prn_documents SET status='deleted',deleted_at=COALESCE(deleted_at,CURRENT_TIMESTAMP),retention_purged_at=CURRENT_TIMESTAMP,retention_purge_reason=$1 WHERE id=$2 AND organization_id=$3 AND retention_purged_at IS NULL`,[reason,d.id,org.id]);
      await runtime.db.query(`INSERT INTO prn_retention_events(id,organization_id,event_type,entity_type,entity_id,object_key,details) VALUES($1,$2,'object_purged','print_document',$3,$4,$5::jsonb)`,[createId('prnret'),org.id,d.id,d.object_key,JSON.stringify({reason,jobId:d.job_id??null,sizeBytes:Number(d.size_bytes||0)})]);
    }
  }
}

import type { JobHandler } from '../../jobs/types.js';
import { createId } from '../core-identity/security.js';

export const sweepNvrOffline:JobHandler=async({runtime})=>{
  const stale=await runtime.db.query(`UPDATE nvr_cameras SET status='offline',last_error='Heartbeat timeout',updated_at=CURRENT_TIMESTAMP WHERE enabled=true AND status IN ('online','recording') AND last_seen_at<CURRENT_TIMESTAMP-INTERVAL '90 seconds' RETURNING id,organization_id,name`);
  for(const row of stale.rows as any[]){
    await runtime.db.query(`INSERT INTO nvr_events(id,organization_id,camera_id,event_type,severity,title,details) VALUES($1,$2,$3,'camera_offline','warning',$4,$5::jsonb)`,[createId('nvrEvt'),row.organization_id,row.id,`${row.name} is offline`,JSON.stringify({reason:'heartbeat_timeout'})]);
    await runtime.db.query(`UPDATE nvr_stream_sessions SET status='failed',closed_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND camera_id=$2 AND status IN ('requested','active')`,[row.organization_id,row.id]);
  }
  await runtime.db.query(`UPDATE nvr_stream_sessions SET status='closed',closed_at=CURRENT_TIMESTAMP WHERE status IN ('requested','active') AND expires_at<=CURRENT_TIMESTAMP`);
  return {offlineCount:stale.rowCount??0};
};

import type { ClaimedJob } from '../../queue/postgres-queue.js';
import type { Runtime } from '../../runtime.js';
import { createId } from '../core-identity/security.js';

const rank:Record<string,number>={info:1,warning:2,critical:3};

export async function sweepNvrEventRules(_job:ClaimedJob,runtime:Runtime){
  const orgs=await runtime.db.query(`SELECT DISTINCT organization_id FROM nvr_event_rules WHERE active=true LIMIT 1000`);
  for(const org of orgs.rows as any[]){
    const events=await runtime.db.query(`SELECT e.id,e.camera_id,e.event_type,e.severity,e.title,e.details,e.occurred_at FROM nvr_events e WHERE e.organization_id=$1 AND e.occurred_at>=CURRENT_TIMESTAMP-interval '1 day' AND EXISTS(SELECT 1 FROM nvr_event_rules r WHERE r.organization_id=e.organization_id AND r.active=true AND NOT EXISTS(SELECT 1 FROM nvr_rule_evaluations x WHERE x.organization_id=e.organization_id AND x.event_id=e.id AND x.rule_id=r.id)) ORDER BY e.occurred_at LIMIT 200`,[org.organization_id]);
    if(!events.rowCount)continue;
    const rules=await runtime.db.query(`SELECT id,camera_id,event_type,min_severity,recipient_user_ids,cooldown_seconds FROM nvr_event_rules WHERE organization_id=$1 AND active=true ORDER BY created_at`,[org.organization_id]);
    for(const e of events.rows as any[]){
      for(const r of rules.rows as any[]){
        const matched=(!r.camera_id||r.camera_id===e.camera_id)&&(!r.event_type||r.event_type===e.event_type)&&(rank[e.severity]??0)>=(rank[r.min_severity]??2);
        await runtime.db.query(`INSERT INTO nvr_rule_evaluations(organization_id,event_id,rule_id,matched) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,[org.organization_id,e.id,r.id,matched]);
        if(!matched)continue;
        const cooldown=Number(r.cooldown_seconds||0);
        if(cooldown>0){const recent=await runtime.db.query(`SELECT 1 FROM nvr_alert_notifications n JOIN nvr_events pe ON pe.id=n.event_id AND pe.organization_id=n.organization_id WHERE n.organization_id=$1 AND n.rule_id=$2 AND pe.camera_id IS NOT DISTINCT FROM $3 AND n.created_at>CURRENT_TIMESTAMP-($4::text||' seconds')::interval LIMIT 1`,[org.organization_id,r.id,e.camera_id,String(cooldown)]);if(recent.rowCount)continue;}
        let recipients=Array.isArray(r.recipient_user_ids)?r.recipient_user_ids.map(String):[];
        if(!recipients.length){const m=await runtime.db.query(`SELECT user_id FROM memberships WHERE organization_id=$1 AND role IN ('owner','admin') ORDER BY role,user_id`,[org.organization_id]);recipients=(m.rows as any[]).map(x=>String(x.user_id));}
        for(const userId of [...new Set(recipients)])await runtime.db.query(`INSERT INTO nvr_alert_notifications(id,organization_id,event_id,rule_id,user_id,title,body,severity) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(organization_id,event_id,rule_id,user_id) DO NOTHING`,[createId('nvrNote'),org.organization_id,e.id,r.id,userId,e.title,`Camera event ${e.event_type} requires attention.`,e.severity]);
      }
    }
  }
}

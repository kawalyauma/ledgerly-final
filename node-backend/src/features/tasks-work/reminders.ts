import type { ClaimedJob } from '../../queue/postgres-queue.js';
import type { Runtime } from '../../runtime.js';
import { createId } from '../core-identity/security.js';

async function notify(runtime:Runtime,org:string,userId:string,eventType:string,title:string,body:string,taskId:string,data:unknown){
  const pref=await runtime.db.query(`SELECT in_app FROM work_notification_preferences WHERE organization_id=$1 AND user_id=$2 AND event_type=$3`,[org,userId,eventType]);
  if(pref.rowCount && !(pref.rows[0] as any).in_app)return;
  await runtime.db.query(`INSERT INTO work_notifications(id,organization_id,user_id,event_type,title,body,entity_type,entity_id,data) VALUES($1,$2,$3,$4,$5,$6,'task',$7,$8::jsonb)`,[createId('wnt'),org,userId,eventType,title,body,taskId,JSON.stringify(data??{})]);
}

export async function runWorkReminders(_job:ClaimedJob,runtime:Runtime):Promise<void>{
  const q=await runtime.db.query(`SELECT t.id,t.organization_id,t.task_number,t.title,t.due_at,t.created_by,a.user_id,p.owner_user_id FROM work_tasks t LEFT JOIN work_task_assignees a ON a.organization_id=t.organization_id AND a.task_id=t.id LEFT JOIN work_projects p ON p.organization_id=t.organization_id AND p.id=t.project_id WHERE t.archived_at IS NULL AND t.status NOT IN ('done','cancelled') AND t.due_at IS NOT NULL AND t.due_at<=CURRENT_TIMESTAMP+INTERVAL '24 hours' AND t.due_at>CURRENT_TIMESTAMP-INTERVAL '30 days'`);
  const today=new Date().toISOString().slice(0,10);
  for(const row of q.rows as any[]){
    if(!row.user_id)continue;
    const overdue=new Date(row.due_at).getTime()<Date.now();
    const type=overdue?'overdue':'due_soon';
    const key=`${row.id}:${row.user_id}:${type}:${today}`;
    const inserted=await runtime.db.query(`INSERT INTO work_task_reminders(id,organization_id,task_id,user_id,reminder_type,reminder_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,reminder_key) DO NOTHING RETURNING id`,[createId('wrm'),row.organization_id,row.id,row.user_id,type,key]);
    if(inserted.rowCount)await notify(runtime,row.organization_id,row.user_id,`task.${type}`,overdue?'Task overdue':'Task due soon',`Task ${row.task_number}: ${row.title}`,row.id,{dueAt:row.due_at});
    if(overdue && Date.now()-new Date(row.due_at).getTime()>=86400000){
      const manager=row.owner_user_id||row.created_by;
      if(manager && manager!==row.user_id){
        const escalationKey=`${row.id}:${manager}:escalation:${today}`;
        const escalated=await runtime.db.query(`INSERT INTO work_task_reminders(id,organization_id,task_id,user_id,reminder_type,reminder_key) VALUES($1,$2,$3,$4,'escalation',$5) ON CONFLICT(organization_id,reminder_key) DO NOTHING RETURNING id`,[createId('wrm'),row.organization_id,row.id,manager,escalationKey]);
        if(escalated.rowCount)await notify(runtime,row.organization_id,manager,'task.escalation','Overdue task escalation',`Task ${row.task_number}: ${row.title} is more than 24 hours overdue`,row.id,{assigneeUserId:row.user_id,dueAt:row.due_at});
      }
    }
  }
}

import type { Runtime } from "../../runtime.js";
import { createDocument, postDocument } from "../documents/service.js";
import { createJournal, postJournal } from "../finance-core/service.js";

function advance(date:Date,cadence:string){const d=new Date(date);if(cadence==="weekly")d.setUTCDate(d.getUTCDate()+7);else if(cadence==="quarterly")d.setUTCMonth(d.getUTCMonth()+3);else if(cadence==="yearly")d.setUTCFullYear(d.getUTCFullYear()+1);else d.setUTCMonth(d.getUTCMonth()+1);return d;}

export async function processRecurringTemplates(runtime:Runtime,limit=50){
 const due=await runtime.db.query<{id:string;organizationId:string;type:"invoice"|"bill"|"journal";template:Record<string,unknown>;cadence:string;autoPost:boolean;nextRunAt:string}>(`SELECT id,organization_id AS "organizationId",type,template_json AS template,cadence,auto_post AS "autoPost",next_run_at AS "nextRunAt" FROM recurring_templates WHERE active=true AND next_run_at<=CURRENT_TIMESTAMP ORDER BY next_run_at FOR UPDATE SKIP LOCKED LIMIT $1`,[limit]);
 let completed=0;
 for(const item of due.rows){try{const occurrence=item.nextRunAt.slice(0,10);if(item.type==="journal"){const t=item.template as any;const journal=await createJournal(runtime,item.organizationId,"scheduler",t,`recurring:${item.id}:${occurrence}`);if(item.autoPost&&journal.status==="draft")await postJournal(runtime,item.organizationId,"scheduler",journal.id);}else{const t=item.template as any;const doc=await createDocument(runtime,item.organizationId,"scheduler",{...t,type:item.type});if(item.autoPost)await postDocument(runtime,item.organizationId,"scheduler",doc.id,t.controlAccountId);}const next=advance(new Date(item.nextRunAt),item.cadence);await runtime.db.query(`UPDATE recurring_templates SET last_run_at=$1::timestamptz,next_run_at=$2::timestamptz,updated_at=CURRENT_TIMESTAMP WHERE id=$3`,[item.nextRunAt,next.toISOString(),item.id]);completed++;}catch(error){runtime.logger.error({recurringTemplateId:item.id,error:error instanceof Error?error.message:String(error)},"Recurring transaction failed");}}
 return completed;
}

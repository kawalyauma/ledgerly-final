import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import type { AuthPrincipal, Env } from "../../../src/types";
import { dispatchCampaign, ensureBuiltinMessageTypes } from "../../communications/backend/service";
import { hasScope } from "./policy";
import { executeWorkTaskAction, type WorkTaskPayload } from "./action-task-executor";
import { executeDocumentGenerateAction,executeDocumentPrintAction,type GenerateDocumentPayload,type PrintDocumentPayload } from "./document-actions";

type ApprovalPayload={audience?:{kind?:string;studentIds?:string[];staffIds?:string[];recipientMode?:"primary_guardian"|"all_guardians"|"student_direct"|"guardians_and_student";minimumBalanceMinor?:number};channels?:Array<"sms"|"whatsapp">;subject?:string;message?:string};
type WorkflowStep={id:string;title?:string;method:"POST"|"PUT"|"PATCH"|"DELETE";path:string;body?:unknown;requiredScope?:string};
type WorkflowPayload={agentKey?:string;steps?:WorkflowStep[];requiredScopes?:string[];executionPolicy?:Record<string,unknown>};
function typeKeyForAudience(kind:string){if(kind==="fee_balances")return"fee_balance_reminder";if(kind==="staff")return"staff_announcement";return"student_announcement";}
async function markApproval(env:Env,organizationId:string,approvalId:string,status:"executed"|"failed",error?:string|null){await env.FINANCE_DB.prepare(`UPDATE ae_approvals SET status=?,executed_at=CURRENT_TIMESTAMP,execution_error=? WHERE id=? AND organization_id=? AND status='approved'`).bind(status,error||null,approvalId,organizationId).run();}
async function claimLinkedAction(env:Env,organizationId:string,approvalId:string){const linked=await env.FINANCE_DB.prepare("SELECT id,status FROM ae_actions WHERE organization_id=? AND approval_id=?").bind(organizationId,approvalId).first<{id:string;status:string}>();if(!linked)return null;const claim=await env.FINANCE_DB.prepare("UPDATE ae_actions SET status='executing',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='approved'").bind(linked.id,organizationId).run();if(!Number(claim.meta.changes||0))throw new AppError(409,"ACTION_ALREADY_CLAIMED",`AI action is ${linked.status} and cannot execute again`);return linked.id;}
async function executeCommunication(env:Env,principal:AuthPrincipal,approvalId:string,payload:ApprovalPayload){if(!hasScope(principal,"communications:write"))throw new AppError(403,"FORBIDDEN","Executing an AI communication requires communications:write");const audience=payload.audience||{},audienceKind=String(audience.kind||"students");if(!["students","staff","fee_balances"].includes(audienceKind))throw new AppError(422,"INVALID_AUDIENCE","Unsupported AI communication audience");const channels=[...new Set((payload.channels||[]).filter(channel=>channel==="sms"||channel==="whatsapp"))];if(!channels.length)throw new AppError(422,"INVALID_CHANNELS","No supported communication channel is present");const message=String(payload.message||"").trim();if(!message)throw new AppError(422,"INVALID_MESSAGE","The approved communication has no message");await ensureBuiltinMessageTypes(env.FINANCE_DB,principal.organizationId,principal.userId);const typeKey=typeKeyForAudience(audienceKind),type=await env.FINANCE_DB.prepare("SELECT * FROM communication_message_types WHERE organization_id=? AND type_key=? AND active=TRUE").bind(principal.organizationId,typeKey).first<any>();if(!type)throw new AppError(409,"MESSAGE_TYPE_NOT_FOUND","Required communications message type is unavailable");const organization=await env.FINANCE_DB.prepare("SELECT name FROM organizations WHERE id=?").bind(principal.organizationId).first<{name:string}>(),campaignId=createId("cmp"),resolvedAudience={...JSON.parse(type.audience_defaults_json||"{}"),kind:audienceKind,studentIds:Array.isArray(audience.studentIds)?audience.studentIds.slice(0,200):[],staffIds:Array.isArray(audience.staffIds)?audience.staffIds.slice(0,200):[],recipientMode:audience.recipientMode,minimumBalanceMinor:audience.minimumBalanceMinor};await env.FINANCE_DB.prepare(`INSERT INTO communication_campaigns (id,organization_id,message_type_id,type_key,module_key,name,sender_name,subject_template,message_template,channels_json,audience_kind,audience_json,status,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'draft',?,?)`).bind(campaignId,principal.organizationId,type.id,type.type_key,"agentic-employees",`AI ${type.name}`,organization?.name||"Ledgerly",String(payload.subject||type.subject_template||"School update").slice(0,200),message.slice(0,2000),JSON.stringify(channels),audienceKind,JSON.stringify(resolvedAudience),principal.userId,principal.userId).run();const result=await dispatchCampaign(env,campaignId);await markApproval(env,principal.organizationId,approvalId,"executed");return{approvalId,entityType:"communication_campaign",entityId:campaignId,campaignId,...result};}

function rejectionReason(data:any){
 const error=data&&typeof data==="object"&&data.error&&typeof data.error==="object"?data.error:data;
 if(!error||typeof error!=="object")return String(data||"").trim().slice(0,1200);
 const parts:string[]=[];
 if(typeof error.code==="string"&&error.code.trim())parts.push(`[${error.code.trim()}]`);
 if(typeof error.message==="string"&&error.message.trim())parts.push(error.message.trim());
 const details=error.details;
 if(details&&typeof details==="object"){
  const fieldErrors=(details as any).fieldErrors;
  if(fieldErrors&&typeof fieldErrors==="object")for(const [field,messages] of Object.entries(fieldErrors))for(const message of Array.isArray(messages)?messages:[])if(message)parts.push(`${field}: ${String(message)}`);
  const formErrors=(details as any).formErrors;
  if(Array.isArray(formErrors))for(const message of formErrors)if(message)parts.push(String(message));
  if(typeof (details as any).reason==="string"&&(details as any).reason.trim())parts.push((details as any).reason.trim());
 }
 if(typeof error.requestId==="string"&&error.requestId.trim())parts.push(`request ${error.requestId.trim()}`);
 return [...new Set(parts)].join(" · ").slice(0,1200);
}
function delegatedFailure(method:string,path:string,status:number|undefined,data:any){const reason=rejectionReason(data),prefix=`Ledgerly rejected ${method} ${path}${status?` (HTTP ${status})`:""}`;return reason?`${prefix}: ${reason}`:prefix;}

function lookupPath(source:any,path:string){let value=source;for(const part of path.split(".")){if(value==null||typeof value!=="object"||!(part in value))throw new Error(`Workflow output does not contain ${path}`);value=value[part];}return value;}
function resolveValue(value:any,outputs:Record<string,any>):any{
 if(typeof value==="string"){
  const exact=value.match(/^\{\{([A-Za-z][A-Za-z0-9_-]*)\.([^}]+)\}\}$/);if(exact)return lookupPath(outputs[exact[1]!],exact[2]!);
  return value.replace(/\{\{([A-Za-z][A-Za-z0-9_-]*)\.([^}]+)\}\}/g,(_m,step,path)=>String(lookupPath(outputs[step],path)));
 }
 if(Array.isArray(value))return value.map(item=>resolveValue(item,outputs));
 if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveValue(v,outputs)]));
 return value;
}
async function executeWorkflow(env:Env,principal:AuthPrincipal,approvalId:string,agentKey:string,payload:WorkflowPayload,linkedActionId:string|null){
 if(!env.AGENT_SYSTEM_GATEWAY)throw new AppError(503,"SYSTEM_GATEWAY_REQUIRED","Role-scoped system execution requires the self-hosted Agent gateway");
 const steps=Array.isArray(payload.steps)?payload.steps:[];if(steps.length<2||steps.length>12)throw new AppError(422,"INVALID_WORKFLOW","The approved compound workflow has an invalid number of steps");
 const requiredScopes=Array.isArray(payload.requiredScopes)?payload.requiredScopes.filter(Boolean):[];
 if(principal.role!=="owner"&&principal.role!=="admin")for(const scope of requiredScopes)if(!principal.scopes.includes(scope))throw new AppError(403,"FORBIDDEN",`Compound workflow requires ${scope}`);
 const outputs:Record<string,any>={},completed:Array<Record<string,unknown>>=[];
 for(let index=0;index<steps.length;index++){
  const step=steps[index]!;const method=String(step.method||"").toUpperCase(),path=resolveValue(step.path,outputs),body=resolveValue(step.body??{},outputs);
  if(!["POST","PUT","PATCH","DELETE"].includes(method)||typeof path!=="string"||!path.startsWith("/api/v1/"))throw new AppError(422,"INVALID_WORKFLOW_STEP",`Workflow step ${step.id||index+1} resolved to an invalid request`);
  const result=await env.AGENT_SYSTEM_GATEWAY.request({agentKey,principal,method,path,body});
  if(!result.ok){const detail={completedSteps:completed,failedStep:{index:index+1,id:step.id,title:step.title,method,path,status:result.status,response:result.data},automaticRetry:false,automaticRollback:false};throw new AppError((result.status||409) as any,"COMPOUND_WORKFLOW_STEP_FAILED",`Workflow step ${index+1} failed: ${delegatedFailure(method,path,result.status,result.data)}`,detail);}
  outputs[step.id]=result.data;completed.push({index:index+1,id:step.id,title:step.title||`${method} ${path}`,method,path,status:result.status,response:result.data});
 }
 await markApproval(env,principal.organizationId,approvalId,"executed");
 return{approvalId,entityType:"ledgerly_api_workflow",entityId:linkedActionId||approvalId,stepCount:steps.length,completedSteps:completed,outputs};
}

export async function executeApprovedAction(env:Env,principal:AuthPrincipal,approvalId:string){const approval=await env.FINANCE_DB.prepare(`SELECT id,agent_key AS agentKey,action_type AS actionType,payload_json AS payloadJson,status FROM ae_approvals WHERE id=? AND organization_id=?`).bind(approvalId,principal.organizationId).first<any>();if(!approval)throw new AppError(404,"NOT_FOUND","AI approval not found");if(approval.status!=="approved")throw new AppError(409,"INVALID_STATE","Only an approved action can be executed");let payload:any;try{payload=JSON.parse(approval.payloadJson||"{}");}catch{throw new AppError(422,"INVALID_APPROVAL_PAYLOAD","Approval payload is invalid");}const linkedActionId=await claimLinkedAction(env,principal.organizationId,approvalId);try{if(approval.actionType==="communication.campaign.send")return await executeCommunication(env,principal,approvalId,payload as ApprovalPayload);if(approval.actionType==="work.task.create"){const result=await executeWorkTaskAction(env,principal,payload as WorkTaskPayload);await markApproval(env,principal.organizationId,approvalId,"executed");return{approvalId,entityType:"work_task",entityId:result.taskId,...result};}if(approval.actionType==="document.generate"){const result=await executeDocumentGenerateAction(env,principal,payload as GenerateDocumentPayload,linkedActionId);await markApproval(env,principal.organizationId,approvalId,"executed");return{approvalId,...result};}if(approval.actionType==="printerly.document.print"){const result=await executeDocumentPrintAction(env,principal,payload as PrintDocumentPayload);await markApproval(env,principal.organizationId,approvalId,"executed");return{approvalId,...result};}if(approval.actionType==="system.api.workflow")return executeWorkflow(env,principal,approvalId,String(approval.agentKey),payload as WorkflowPayload,linkedActionId);if(approval.actionType==="system.api.request"){if(!env.AGENT_SYSTEM_GATEWAY)throw new AppError(503,"SYSTEM_GATEWAY_REQUIRED","Role-scoped system execution requires the self-hosted Agent gateway");const method=String(payload.method||"").toUpperCase(),path=String(payload.path||"");const result=await env.AGENT_SYSTEM_GATEWAY.request({agentKey:String(approval.agentKey),principal,method,path,body:payload.body});if(!result.ok)throw new AppError((result.status||409) as any,"DELEGATED_API_FAILED",delegatedFailure(method,path,result.status,result.data),result.data);await markApproval(env,principal.organizationId,approvalId,"executed");return{approvalId,entityType:"ledgerly_api_action",entityId:linkedActionId||approvalId,request:{method,path},response:result.data};}throw new AppError(409,"UNSUPPORTED_ACTION","This approval action does not have an executor");}catch(error){const text=error instanceof Error?error.message.slice(0,1600):String(error).slice(0,1600);await markApproval(env,principal.organizationId,approvalId,"failed",text);if(linkedActionId)await env.FINANCE_DB.prepare("UPDATE ae_actions SET status='failed',failure_text=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND status='executing'").bind(text,linkedActionId,principal.organizationId).run();throw error;}}

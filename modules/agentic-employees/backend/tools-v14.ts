import { createId } from "../../../src/lib/ids";
import type { AgentDefinition } from "./policy";
import { executeTool as executeBaseTool, openAiTools as baseOpenAiTools, type ToolContext } from "./tools-v125b";
export type { ToolContext } from "./tools-v125b";

const SPEC={
  type:"function",name:"prepare_work_task",strict:false,
  description:"Prepare a Tasks & Work follow-up in the AI Action Center. This does not create the task; a human must prepare, approve and execute the action.",
  parameters:{type:"object",properties:{
    title:{type:"string"},description:{type:"string"},priority:{type:"string",enum:["low","medium","high","urgent"]},
    assigneeUserId:{type:"string"},dueAt:{type:"string"}
  },required:["title","description"],additionalProperties:false},
};

const PREVIOUS:Partial<Record<AgentDefinition["key"],readonly string[]>>={
  secretary:["school_snapshot","search_students","search_staff","resolve_guardian_family","communications_summary","prepare_communication"],
  dos:["school_snapshot","search_students","search_staff","resolve_guardian_family","family_comprehensive_report","delegate_to_employee","academics_overview","lesson_plan_queue","scheme_coverage","prepare_communication"],
  bursar:["search_students","fee_balance_lookup","fee_arrears_summary","fee_collection_summary","prepare_communication"],
  headteacher:["school_snapshot","search_students","search_staff","resolve_guardian_family","family_comprehensive_report","delegate_to_employee","academics_overview","lesson_plan_queue","scheme_coverage","hr_overview","hr_leave_queue","fee_collection_summary","fee_arrears_summary","books_overview","communications_summary","prepare_communication"],
  hr:["school_snapshot","search_staff","hr_overview","hr_leave_queue","prepare_communication"],
  librarian:["school_snapshot","search_students","books_overview","learner_book_history","prepare_communication"],
};

function sameSet(a:readonly string[],b:readonly string[]){return a.length===b.length&&a.every(v=>b.includes(v));}
function legacyAllows(agent:AgentDefinition,requested?:string[]|null){
  if(!requested)return true;
  if(requested.includes("prepare_work_task"))return true;
  const previous=PREVIOUS[agent.key];
  return Boolean(previous&&sameSet(previous,requested));
}

export function openAiTools(agent:AgentDefinition,requested?:string[]|null){
  const base=baseOpenAiTools(agent,requested);
  return legacyAllows(agent,requested)?[...base,SPEC]:base;
}

function slug(value:string){return value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80)||"task";}

export async function executeTool(ctx:ToolContext & {env?:Record<string,unknown>},name:string,raw:unknown){
  if(name!=="prepare_work_task")return executeBaseTool(ctx,name,raw);
  if(!legacyAllows(ctx.agent,ctx.requestedTools))throw new Error("prepare_work_task is not enabled for this employee");
  const args=(raw&&typeof raw==="object"?raw:{}) as Record<string,unknown>;
  const title=String(args.title||"").trim().slice(0,240),description=String(args.description||"").trim().slice(0,10000);
  if(!title||!description)throw new Error("Task title and description are required");
  const priority=["low","medium","high","urgent"].includes(String(args.priority))?String(args.priority):"medium";
  const idempotencyKey=`conversation:${ctx.conversationId}:work-task:${slug(title)}`;
  const id=createId("aea");
  await ctx.db.prepare(`INSERT INTO ae_actions
    (id,organization_id,agent_key,action_type,title,summary,required_scope,payload_json,idempotency_key,status)
    VALUES (?,?,?,?,?,?,?,?,?,'suggested') ON CONFLICT(organization_id,idempotency_key) DO NOTHING`)
    .bind(id,ctx.principal.organizationId,ctx.agent.key,"work.task.create",title,
      `AI employee prepared a Tasks & Work follow-up: ${title}`,"work:write",
      JSON.stringify({title,description,priority,assigneeUserId:args.assigneeUserId?String(args.assigneeUserId):null,dueAt:args.dueAt?String(args.dueAt):null}),idempotencyKey).run();
  const action=await ctx.db.prepare("SELECT id,status,title,action_type AS actionType FROM ae_actions WHERE organization_id=? AND idempotency_key=?")
    .bind(ctx.principal.organizationId,idempotencyKey).first();
  return{prepared:true,executed:false,requiresHumanApproval:true,action};
}

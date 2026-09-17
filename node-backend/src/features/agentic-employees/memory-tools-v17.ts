import type { ToolContext } from "./tools-v14.js";
import { executeTool as baseExecute,openAiTools as baseTools } from "./system-tools-v16.js";
import { listRelevantMemories,saveMemory } from "./memory-service.js";
import {generateDraft,lessonPeriodContext,listRules,matrix,validateTimetable,weekView} from "./stubs.js";
import {syncCurriculumLoadRules} from "./stubs.js";
import {reviewGeneratedDraft} from "./stubs.js";
import {recoveryOptions,substituteCandidates} from "./stubs.js";

const MEMORY_TOOLS:any[]=[
 {type:"function",name:"search_memory",strict:false,description:"Search this employee's saved working and institutional memory.",parameters:{type:"object",properties:{query:{type:"string"},limit:{type:"integer",minimum:1,maximum:50}},additionalProperties:false}},
 {type:"function",name:"remember_working_item",strict:false,description:"Save an ongoing assignment, follow-up or unresolved matter for later.",parameters:{type:"object",properties:{title:{type:"string"},content:{type:"string"},priority:{type:"string",enum:["low","normal","high","urgent"]},dueAt:{type:"string"},tags:{type:"array",items:{type:"string"}},visibility:{type:"string",enum:["agent","organization"]}},required:["title","content"],additionalProperties:false}},
 {type:"function",name:"remember_institutional_fact",strict:false,description:"Save a durable school preference, procedure, standing instruction, decision or outcome.",parameters:{type:"object",properties:{title:{type:"string"},content:{type:"string"},tags:{type:"array",items:{type:"string"}},visibility:{type:"string",enum:["agent","organization"]}},required:["title","content"],additionalProperties:false}},
 {type:"function",name:"update_working_memory",strict:false,description:"Update the state of an existing working-memory item.",parameters:{type:"object",properties:{memoryId:{type:"string"},status:{type:"string",enum:["open","in_progress","waiting","done","cancelled"]},note:{type:"string"}},required:["memoryId","status"],additionalProperties:false}}
];
const TIMETABLE_TOOLS:any[]=[
 {type:"function",name:"timetable_intelligence",strict:false,description:"Inspect one Ledgerly timetable as a professional scheduling system: period matrix, teacher/class/subject rules, hard conflicts and warnings. Use this before recommending timetable changes.",parameters:{type:"object",properties:{timetableId:{type:"string"}},required:["timetableId"],additionalProperties:false}},
 {type:"function",name:"draft_timetable",strict:false,description:"Ask Ledgerly's deterministic rule engine to prepare a professional timetable draft. It refreshes canonical periods-per-week from School Management, then considers explicit school rules, teaching periods, teacher allocations and availability, subject spreading, teacher daily/consecutive load, double-lesson rules and scheme lesson demand. A second rule-review pass independently checks the generated result. This creates an advisory draft only and DOES NOT alter the active timetable. To apply it, explain the proposed change and then use prepare_system_action for POST /api/v1/academics/timetables/{timetableId}/drafts/{draftId}/apply so a human can approve and execute it.",parameters:{type:"object",properties:{timetableId:{type:"string"},mode:{type:"string",enum:["replace","fill_gaps"]}},required:["timetableId"],additionalProperties:false}},
 {type:"function",name:"timetable_week_context",strict:false,description:"Read the dated, lesson-aware teaching week for a published timetable. Returns class, subject, effective teacher, room, scheme topic/lesson, lesson plan status, competencies and disruption status for each period.",parameters:{type:"object",properties:{timetableId:{type:"string"},startDate:{type:"string",description:"YYYY-MM-DD week start or first date to inspect"}},required:["timetableId","startDate"],additionalProperties:false}},
 {type:"function",name:"timetable_lesson_context",strict:false,description:"Answer what is scheduled to be taught on a specific date and period using actual Ledgerly timetable occurrences, including subject, teacher, scheme lesson/topic, lesson plan and competencies. Never guess lesson content when no scheme lesson is linked.",parameters:{type:"object",properties:{timetableId:{type:"string"},date:{type:"string",description:"YYYY-MM-DD"}},required:["timetableId","date"],additionalProperties:false}},
 {type:"function",name:"timetable_contingency_options",strict:false,description:"Find professional options for a disrupted dated timetable period. For kind=substitute, rank free teachers with same-subject qualification first, then class familiarity, availability and daily load. For kind=recovery, find future conflict-free slots preserving the same teacher, class, subject and scheme lesson. This is read-only advice; changing the timetable still requires a governed Ledgerly action.",parameters:{type:"object",properties:{occurrenceId:{type:"string"},kind:{type:"string",enum:["substitute","recovery"]},horizonDays:{type:"integer",minimum:1,maximum:60}},required:["occurrenceId","kind"],additionalProperties:false}}
];
const timetableAgent=(key:string)=>key==="dos"||key==="headteacher";
const timetableAllowed=(agent:any,name:string,requested?:string[]|null)=>timetableAgent(agent.key)&&(!requested||requested.includes(name));

export function openAiTools(agent:any,requested?:string[]|null){return[...baseTools(agent,requested),...MEMORY_TOOLS,...TIMETABLE_TOOLS.filter(tool=>timetableAllowed(agent,tool.name,requested))];}

export async function executeTool(ctx:ToolContext,name:string,raw:unknown){
 const tt=TIMETABLE_TOOLS.some(x=>x.name===name);
 if(tt){
  if(!timetableAllowed(ctx.agent,name,ctx.requestedTools))throw new Error(`${name} is not enabled for this employee run`);
  const args=(raw&&typeof raw==="object"?raw:{}) as Record<string,any>,org=ctx.principal.organizationId;
  if(name==="timetable_contingency_options"){
   const occurrenceId=String(args.occurrenceId||"").trim();if(!occurrenceId)throw new Error("occurrenceId is required");
   return args.kind==="recovery"?recoveryOptions(ctx.db,org,occurrenceId,Number(args.horizonDays||21)):substituteCandidates(ctx.db,org,occurrenceId);
  }
  const id=String(args.timetableId||"").trim();if(!id)throw new Error("timetableId is required");
  if(name==="timetable_intelligence"){
   const[rules,grid,validation]=await Promise.all([listRules(ctx.db,org,id),matrix(ctx.db,org,id),validateTimetable(ctx.db,org,id)]);
   return{rules,matrix:grid,validation,principles:["Respect every hard conflict and teacher unavailability.","Use School Management periods-per-week as the canonical curriculum load; explicit timetable rules may override it.","Spread subjects across the week before repeating a day unless a double lesson is required.","Balance teacher workload and avoid excessive consecutive periods.","Use scheme lesson demand only when curriculum load is not configured.","Do not apply or publish an AI draft without human review."]};
  }
  if(name==="draft_timetable"){
   const curriculumLoad=await syncCurriculumLoadRules(ctx.db,org,ctx.principal.userId,id);
   const baseDraft=await generateDraft(ctx.db,org,ctx.principal.userId,id,{mode:args.mode});
   const draft=await reviewGeneratedDraft(ctx.db,org,id,baseDraft);
   return{...draft,curriculumLoad,applied:false,nothingChangedInTimetable:true,nextGovernedAction:`POST /api/v1/academics/timetables/${id}/drafts/${draft.id}/apply`,instruction:"Explain the score, canonical curriculum loads, assumptions and all hard/soft rule-review findings to the user before preparing the apply action. A draft with hard violations cannot be applied. Never claim this draft has been applied."};
  }
  if(name==="timetable_week_context")return weekView(ctx.db,org,id,String(args.startDate||""));
  return lessonPeriodContext(ctx.db,org,id,String(args.date||""));
 }
 if(!MEMORY_TOOLS.some(x=>x.name===name))return baseExecute(ctx,name,raw);
 const args=(raw&&typeof raw==="object"?raw:{}) as Record<string,any>;
 if(name==="search_memory")return{memories:await listRelevantMemories(ctx.db,ctx.principal.organizationId,ctx.agent.key,String(args.query||""),Math.max(1,Math.min(50,Number(args.limit)||20)))};
 if(name==="remember_working_item"){const id=await saveMemory(ctx.db,ctx.principal,ctx.agent.key,{memoryType:"working",title:String(args.title||"Working item"),content:String(args.content||""),priority:args.priority||"normal",dueAt:args.dueAt||null,tags:Array.isArray(args.tags)?args.tags.map(String):[],visibility:args.visibility==="organization"?"organization":"agent",conversationId:ctx.conversationId});return{saved:true,memoryId:id};}
 if(name==="remember_institutional_fact"){const id=await saveMemory(ctx.db,ctx.principal,ctx.agent.key,{memoryType:"institutional",title:String(args.title||"Institutional memory"),content:String(args.content||""),tags:Array.isArray(args.tags)?args.tags.map(String):[],visibility:args.visibility==="organization"?"organization":"agent",conversationId:ctx.conversationId});return{saved:true,memoryId:id};}
 const id=String(args.memoryId||""),status=String(args.status||"");const row=await ctx.db.prepare("SELECT id,content FROM ae_memories WHERE id=? AND organization_id=? AND agent_key=? AND memory_type='working'").bind(id,ctx.principal.organizationId,ctx.agent.key).first<any>();if(!row)throw new Error("Working memory item not found");const note=String(args.note||"").trim();await ctx.db.prepare("UPDATE ae_memories SET status=?,content=?,updated_by=?,updated_at=CURRENT_TIMESTAMP,completed_at=CASE WHEN ?='done' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=? AND organization_id=?").bind(status,note?`${row.content}\nUpdate: ${note}`:row.content,ctx.principal.userId,status,id,ctx.principal.organizationId).run();return{updated:true,memoryId:id,status};
}

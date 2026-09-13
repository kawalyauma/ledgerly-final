import type { ToolContext } from "./tools-v14";
import { executeTool as baseExecute,openAiTools as baseTools } from "./system-tools-v16";
import { listRelevantMemories,saveMemory } from "./memory-service";

const TOOLS:any[]=[
 {type:"function",name:"search_memory",strict:false,description:"Search this employee's saved working and institutional memory.",parameters:{type:"object",properties:{query:{type:"string"},limit:{type:"integer",minimum:1,maximum:50}},additionalProperties:false}},
 {type:"function",name:"remember_working_item",strict:false,description:"Save an ongoing assignment, follow-up or unresolved matter for later.",parameters:{type:"object",properties:{title:{type:"string"},content:{type:"string"},priority:{type:"string",enum:["low","normal","high","urgent"]},dueAt:{type:"string"},tags:{type:"array",items:{type:"string"}},visibility:{type:"string",enum:["agent","organization"]}},required:["title","content"],additionalProperties:false}},
 {type:"function",name:"remember_institutional_fact",strict:false,description:"Save a durable school preference, procedure, standing instruction, decision or outcome.",parameters:{type:"object",properties:{title:{type:"string"},content:{type:"string"},tags:{type:"array",items:{type:"string"}},visibility:{type:"string",enum:["agent","organization"]}},required:["title","content"],additionalProperties:false}},
 {type:"function",name:"update_working_memory",strict:false,description:"Update the state of an existing working-memory item.",parameters:{type:"object",properties:{memoryId:{type:"string"},status:{type:"string",enum:["open","in_progress","waiting","done","cancelled"]},note:{type:"string"}},required:["memoryId","status"],additionalProperties:false}}
];

export function openAiTools(agent:any,requested?:string[]|null){return[...baseTools(agent,requested),...TOOLS];}

export async function executeTool(ctx:ToolContext,name:string,raw:unknown){
 if(!TOOLS.some(x=>x.name===name))return baseExecute(ctx,name,raw);
 const args=(raw&&typeof raw==="object"?raw:{}) as Record<string,any>;
 if(name==="search_memory")return{memories:await listRelevantMemories(ctx.db,ctx.principal.organizationId,ctx.agent.key,String(args.query||""),Math.max(1,Math.min(50,Number(args.limit)||20)))};
 if(name==="remember_working_item"){const id=await saveMemory(ctx.db,ctx.principal,ctx.agent.key,{memoryType:"working",title:String(args.title||"Working item"),content:String(args.content||""),priority:args.priority||"normal",dueAt:args.dueAt||null,tags:Array.isArray(args.tags)?args.tags.map(String):[],visibility:args.visibility==="organization"?"organization":"agent",conversationId:ctx.conversationId});return{saved:true,memoryId:id};}
 if(name==="remember_institutional_fact"){const id=await saveMemory(ctx.db,ctx.principal,ctx.agent.key,{memoryType:"institutional",title:String(args.title||"Institutional memory"),content:String(args.content||""),tags:Array.isArray(args.tags)?args.tags.map(String):[],visibility:args.visibility==="organization"?"organization":"agent",conversationId:ctx.conversationId});return{saved:true,memoryId:id};}
 const id=String(args.memoryId||"");const status=String(args.status||"");const row=await ctx.db.prepare("SELECT id,content FROM ae_memories WHERE id=? AND organization_id=? AND agent_key=? AND memory_type='working'").bind(id,ctx.principal.organizationId,ctx.agent.key).first<any>();if(!row)throw new Error("Working memory item not found");const note=String(args.note||"").trim();await ctx.db.prepare("UPDATE ae_memories SET status=?,content=?,updated_by=?,updated_at=CURRENT_TIMESTAMP,completed_at=CASE WHEN ?='done' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=? AND organization_id=?").bind(status,note?`${row.content}\nUpdate: ${note}`:row.content,ctx.principal.userId,status,id,ctx.principal.organizationId).run();return{updated:true,memoryId:id,status};
}

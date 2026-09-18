import { Hono } from "hono";
import { z } from "zod";
import { AppError,createId,requireScope } from "./shared.js";
import type { AppVariables,Env } from "./shared.js";
import { AGENTS,allowedTools,isAgentKey,type AgentDefinition,type AgentKey,type ModelTier } from "./policy.js";
import { runLightAgent } from "./light-mode.js";
import { buildLightToolRegistry } from "./light-tool-registry.js";
import { buildQuickCommandCatalog,executeQuickCommand,searchQuickReferenceOptions } from "./quick-commands.js";

export const agenticLightRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
type OverrideRow={enabled:number|boolean;modelTier:ModelTier|null;systemPrompt:string|null;toolAllowlistJson:string|null};
async function effective(db:D1Database,org:string,key:AgentKey):Promise<AgentDefinition&{enabled:boolean}>{const base=AGENTS[key],row=await db.prepare("SELECT enabled,model_tier AS modelTier,system_prompt AS systemPrompt,tool_allowlist_json AS toolAllowlistJson FROM ae_agent_settings WHERE organization_id=? AND agent_key=?").bind(org,key).first<OverrideRow>();let requested:string[]|null=null;try{requested=row?.toolAllowlistJson?JSON.parse(row.toolAllowlistJson):null;}catch{requested=null;}return{...base,modelTier:(row?.modelTier||base.modelTier) as ModelTier,systemPrompt:row?.systemPrompt?.trim()||base.systemPrompt,tools:allowedTools(base,requested),enabled:row?Boolean(row.enabled):true};}
async function conversation(db:D1Database,org:string,id:string){const row=await db.prepare("SELECT id,agent_key AS agentKey,title,status FROM ae_conversations WHERE id=? AND organization_id=?").bind(id,org).first<{id:string;agentKey:string;title:string;status:string}>();if(!row)throw new AppError(404,"NOT_FOUND","AI conversation not found");return row;}

agenticLightRoutes.get("/chat-studio/light-registry",requireScope("school:read"),async c=>{const p=c.get("principal"),key=c.req.query("agentKey")||"headteacher";if(!isAgentKey(key))throw new AppError(422,"VALIDATION_ERROR","Unknown AI employee");const agent=await effective(c.env.FINANCE_DB,p.organizationId,key);if(!agent.enabled)throw new AppError(409,"AGENT_DISABLED","This AI employee is disabled");const registry=await buildLightToolRegistry(c.env,p,agent);return c.json({data:{agentKey:key,stats:registry.stats,kinds:registry.kinds,modules:registry.modules,groupsByModule:registry.groupsByModule}});});

agenticLightRoutes.get("/chat-studio/commands",requireScope("school:read"),async c=>{
 const p=c.get("principal"),key=c.req.query("agentKey")||"headteacher";if(!isAgentKey(key))throw new AppError(422,"VALIDATION_ERROR","Unknown AI employee");
 const agent=await effective(c.env.FINANCE_DB,p.organizationId,key);if(!agent.enabled)throw new AppError(409,"AGENT_DISABLED","This AI employee is disabled");
 const registry=await buildLightToolRegistry(c.env,p,agent);return c.json({data:buildQuickCommandCatalog(registry)});
});

agenticLightRoutes.get("/chat-studio/reference-options",requireScope("school:read"),async c=>{
 const p=c.get("principal"),field=String(c.req.query("field")||""),q=String(c.req.query("q")||""),limit=Number(c.req.query("limit")||20);
 if(!field)throw new AppError(422,"VALIDATION_ERROR","Reference field is required");
 return c.json({data:await searchQuickReferenceOptions(c.env.FINANCE_DB,p.organizationId,field,q,limit)});
});

agenticLightRoutes.post("/chat-studio/conversations/:id/quick-command",requireScope("school:read"),async c=>{
 const p=c.get("principal"),thread=await conversation(c.env.FINANCE_DB,p.organizationId,c.req.param("id"));if(thread.status==="closed")throw new AppError(409,"CONVERSATION_CLOSED","This chat is closed. Start a new chat to continue.");if(!isAgentKey(thread.agentKey))throw new AppError(409,"AGENT_INVALID","Conversation agent is invalid");
 const agent=await effective(c.env.FINANCE_DB,p.organizationId,thread.agentKey);if(!agent.enabled)throw new AppError(409,"AGENT_DISABLED","This AI employee is disabled");
 const raw=await c.req.json().catch(()=>({})) as Record<string,unknown>,toolName=String(raw.toolName||"").trim(),values=raw.values&&typeof raw.values==="object"&&!Array.isArray(raw.values)?raw.values as Record<string,unknown>:{};
 if(!toolName)throw new AppError(422,"VALIDATION_ERROR","Quick command tool is required");
 const registry=await buildLightToolRegistry(c.env,p,agent);
 return c.json({data:await executeQuickCommand({db:c.env.FINANCE_DB,env:c.env,principal:p,agent,conversationId:thread.id,registry,toolName,values,commandText:String(raw.commandText||"")})});
});

agenticLightRoutes.post("/conversations/:id/light-messages",requireScope("school:read"),async c=>{const parsed=z.object({content:z.string().trim().min(1).max(12000)}).safeParse(await c.req.json());if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Message is required",parsed.error.flatten());const p=c.get("principal"),thread=await conversation(c.env.FINANCE_DB,p.organizationId,c.req.param("id"));if(thread.status==="closed")throw new AppError(409,"CONVERSATION_CLOSED","This chat is closed. Start a new chat to continue.");if(!isAgentKey(thread.agentKey))throw new AppError(409,"AGENT_INVALID","Conversation agent is invalid");const agent=await effective(c.env.FINANCE_DB,p.organizationId,thread.agentKey);if(!agent.enabled)throw new AppError(409,"AGENT_DISABLED","This AI employee is disabled");const userId=createId("aam");await c.env.FINANCE_DB.prepare(`INSERT INTO ae_messages(id,organization_id,conversation_id,role,content,user_id,metadata_json) VALUES(?,?,?,'user',?,?,?)`).bind(userId,p.organizationId,thread.id,parsed.data.content,p.userId,JSON.stringify({mode:"light"})).run();const history=await c.env.FINANCE_DB.prepare("SELECT role,content FROM ae_messages WHERE organization_id=? AND conversation_id=? AND role IN ('user','assistant') ORDER BY created_at DESC,id DESC LIMIT 16").bind(p.organizationId,thread.id).all<{role:"user"|"assistant";content:string}>();let result;try{result=await runLightAgent({db:c.env.FINANCE_DB,env:c.env,principal:p,agent,conversationId:thread.id,messages:[...history.results].reverse()});}catch(e){await c.env.FINANCE_DB.prepare("DELETE FROM ae_messages WHERE id=? AND organization_id=? AND conversation_id=?").bind(userId,p.organizationId,thread.id).run();throw e;}const assistantId=createId("aam");await c.env.FINANCE_DB.batch([c.env.FINANCE_DB.prepare(`INSERT INTO ae_messages(id,organization_id,conversation_id,role,content,user_id,model,provider_response_id,metadata_json) VALUES(?,?,?,'assistant',?,?,?,?,?)`).bind(assistantId,p.organizationId,thread.id,result.text,p.userId,result.model,result.providerResponseId,JSON.stringify({mode:"light",usage:result.usage,toolEvents:result.toolEvents,routing:result.routing})),c.env.FINANCE_DB.prepare("UPDATE ae_conversations SET last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(thread.id,p.organizationId)]);return c.json({data:{id:assistantId,role:"assistant",content:result.text,model:result.model,mode:"light",toolEvents:result.toolEvents,routing:result.routing}});});

import { createId } from "../../../src/lib/ids";
import type { AuthPrincipal } from "../../../src/types";
import type { AgentKey } from "./policy";

export type MemoryType="working"|"institutional";
export type MemoryVisibility="agent"|"organization";
export type MemoryPriority="low"|"normal"|"high"|"urgent";
export type MemoryRow={id:string;agentKey:string;memoryType:MemoryType;visibility:MemoryVisibility;title:string;content:string;status:string;priority:MemoryPriority;dueAt?:string|null;tags?:string[];sourceConversationId?:string|null;createdAt?:string;updatedAt?:string;useCount?:number};

function parseTags(value:unknown):string[]{if(Array.isArray(value))return value.map(String);if(typeof value!=="string")return[];try{const x=JSON.parse(value);return Array.isArray(x)?x.map(String):[];}catch{return[];}}
function mapRow(row:any):MemoryRow{return{id:String(row.id),agentKey:String(row.agentKey),memoryType:row.memoryType,visibility:row.visibility,title:String(row.title),content:String(row.content),status:String(row.status),priority:row.priority,dueAt:row.dueAt||null,tags:parseTags(row.tagsJson),sourceConversationId:row.sourceConversationId||null,createdAt:row.createdAt,updatedAt:row.updatedAt,useCount:Number(row.useCount||0)};}

export async function listRelevantMemories(db:D1Database,organizationId:string,agentKey:AgentKey,query?:string,limit=30){
 const q=String(query||"").trim();const like=`%${q}%`;const base=`SELECT id,agent_key AS agentKey,memory_type AS memoryType,visibility,title,content,status,priority,due_at AS dueAt,tags_json AS tagsJson,source_conversation_id AS sourceConversationId,created_at AS createdAt,updated_at AS updatedAt,use_count AS useCount FROM ae_memories WHERE organization_id=? AND (agent_key=? OR visibility='organization') AND ((memory_type='working' AND status IN ('open','in_progress','waiting')) OR (memory_type='institutional' AND status='active'))`;
 const result=q?await db.prepare(`${base} AND (title LIKE ? OR content LIKE ? OR tags_json LIKE ?) ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,due_at,updated_at DESC LIMIT ?`).bind(organizationId,agentKey,like,like,like,limit).all<any>():await db.prepare(`${base} ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,due_at,updated_at DESC LIMIT ?`).bind(organizationId,agentKey,limit).all<any>();
 return result.results.map(mapRow);
}

export async function memoryContext(db:D1Database,organizationId:string,agentKey:AgentKey){
 const items=await listRelevantMemories(db,organizationId,agentKey,"",24);if(!items.length)return"No saved working or institutional memories are currently relevant.";
 const working=items.filter(x=>x.memoryType==="working").slice(0,12),institutional=items.filter(x=>x.memoryType==="institutional").slice(0,12);
 const fmt=(m:MemoryRow)=>`- [${m.id}] ${m.priority.toUpperCase()} ${m.title}${m.dueAt?` (due ${m.dueAt})`:""}: ${m.content}`;
 return[`WORKING MEMORY — active commitments and unresolved work:`,...(working.length?working.map(fmt):["- None"]),`INSTITUTIONAL MEMORY — durable preferences, procedures and decisions:`,...(institutional.length?institutional.map(fmt):["- None"])].join("\n");
}

export async function saveMemory(db:D1Database,principal:AuthPrincipal,agentKey:AgentKey,input:{memoryType:MemoryType;title:string;content:string;visibility?:MemoryVisibility;priority?:MemoryPriority;dueAt?:string|null;tags?:string[];conversationId?:string|null}){
 const id=createId("aem");const status=input.memoryType==="working"?"open":"active";await db.prepare(`INSERT INTO ae_memories(id,organization_id,agent_key,memory_type,visibility,title,content,status,priority,due_at,tags_json,source_conversation_id,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,principal.organizationId,agentKey,input.memoryType,input.visibility||"agent",input.title.slice(0,240),input.content.slice(0,6000),status,input.priority||"normal",input.dueAt||null,JSON.stringify((input.tags||[]).slice(0,20)),input.conversationId||null,principal.userId,principal.userId).run();return id;
}

export async function touchMemories(db:D1Database,organizationId:string,ids:string[]){for(const id of ids.slice(0,30))await db.prepare("UPDATE ae_memories SET last_used_at=CURRENT_TIMESTAMP,use_count=use_count+1 WHERE id=? AND organization_id=?").bind(id,organizationId).run();}

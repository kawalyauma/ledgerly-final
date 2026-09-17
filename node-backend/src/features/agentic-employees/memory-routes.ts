import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables,Env } from "./shared.js";
import { AppError } from "./shared.js";
import { requireScope } from "./shared.js";
import { AGENTS,isAgentKey } from "./policy.js";
import { listRelevantMemories,saveMemory } from "./memory-service.js";

export const agenticMemoryRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();

agenticMemoryRoutes.get("/memories",requireScope("school:read"),async c=>{
 const p=c.get("principal"),agentKey=c.req.query("agentKey")||"headteacher",query=c.req.query("query")||"";
 if(!isAgentKey(agentKey))throw new AppError(422,"VALIDATION_ERROR","Unknown AI employee");
 const memories=await listRelevantMemories(c.env.FINANCE_DB,p.organizationId,agentKey,query,100);
 return c.json({data:memories});
});

agenticMemoryRoutes.post("/memories",requireScope("school:write"),async c=>{
 const parsed=z.object({agentKey:z.string(),memoryType:z.enum(["working","institutional"]),title:z.string().trim().min(1).max(240),content:z.string().trim().min(1).max(6000),visibility:z.enum(["agent","organization"]).default("agent"),priority:z.enum(["low","normal","high","urgent"]).default("normal"),dueAt:z.string().nullable().optional(),tags:z.array(z.string().max(80)).max(20).default([])}).safeParse(await c.req.json());
 if(!parsed.success||!isAgentKey(parsed.data.agentKey))throw new AppError(422,"VALIDATION_ERROR","Invalid memory",parsed.success?undefined:parsed.error.flatten());
 const p=c.get("principal");const id=await saveMemory(c.env.FINANCE_DB,p,parsed.data.agentKey,{...parsed.data,memoryType:parsed.data.memoryType});return c.json({data:{id}},201);
});

agenticMemoryRoutes.patch("/memories/:id",requireScope("school:write"),async c=>{
 const p=c.get("principal"),id=c.req.param("id"),row=await c.env.FINANCE_DB.prepare("SELECT id,memory_type AS memoryType,status FROM ae_memories WHERE id=? AND organization_id=?").bind(id,p.organizationId).first<any>();if(!row)throw new AppError(404,"NOT_FOUND","Memory not found");
 const parsed=z.object({title:z.string().trim().min(1).max(240).optional(),content:z.string().trim().min(1).max(6000).optional(),visibility:z.enum(["agent","organization"]).optional(),priority:z.enum(["low","normal","high","urgent"]).optional(),dueAt:z.string().nullable().optional(),tags:z.array(z.string().max(80)).max(20).optional(),status:z.string().optional()}).safeParse(await c.req.json());if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid memory update",parsed.error.flatten());
 const d=parsed.data as any;if(d.status){const ok=row.memoryType==="working"?["open","in_progress","waiting","done","cancelled"].includes(d.status):["active","archived"].includes(d.status);if(!ok)throw new AppError(422,"VALIDATION_ERROR","Invalid memory status");}
 await c.env.FINANCE_DB.prepare(`UPDATE ae_memories SET title=COALESCE(?,title),content=COALESCE(?,content),visibility=COALESCE(?,visibility),priority=COALESCE(?,priority),due_at=CASE WHEN ?=1 THEN ? ELSE due_at END,tags_json=COALESCE(?,tags_json),status=COALESCE(?,status),updated_by=?,updated_at=CURRENT_TIMESTAMP,completed_at=CASE WHEN ?='done' THEN CURRENT_TIMESTAMP ELSE completed_at END,archived_at=CASE WHEN ?='archived' THEN CURRENT_TIMESTAMP ELSE archived_at END WHERE id=? AND organization_id=?`).bind(d.title??null,d.content??null,d.visibility??null,d.priority??null,Object.prototype.hasOwnProperty.call(d,"dueAt")?1:0,d.dueAt??null,d.tags?JSON.stringify(d.tags):null,d.status??null,p.userId,d.status??null,d.status??null,id,p.organizationId).run();return c.json({data:{id,status:d.status||row.status}});
});

agenticMemoryRoutes.get("/memory-agents",requireScope("school:read"),c=>c.json({data:Object.values(AGENTS).map(a=>({key:a.key,name:a.name,title:a.title}))}));

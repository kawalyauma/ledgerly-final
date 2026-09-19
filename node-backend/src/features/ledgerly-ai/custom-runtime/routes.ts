import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import { requireScope } from "../../core-identity/security.js";
import type { AppEnv } from "../../../http/types.js";
import type { LedgerlyAiCustomRuntimeService } from "./service.js";

const shareSchema=z.object({
  subjectType:z.enum(["user","role","department","organization"]),
  subjectId:z.string().trim().max(160).nullable().optional(),
  canManage:z.boolean().optional(),
});
const statusSchema=z.object({
  status:z.enum(["draft","testing","active","paused","disabled"]),
});
const runSchema=z.object({
  instruction:z.string().trim().max(12000).optional(),
});

export function createLedgerlyAiCustomRuntimeRoutes(service:LedgerlyAiCustomRuntimeService){
  const routes=new Hono<AppEnv>();

  routes.post("/events",requireScope("admin:write"),async c=>{
    const parsed=z.object({
      eventKey:z.string().trim().min(2).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/i),
      sourceModule:z.string().trim().min(1).max(120),
      sourceRecordId:z.string().trim().min(1).max(200),
      subjectType:z.string().trim().max(80).nullable().optional(),
      subjectId:z.string().trim().max(200).nullable().optional(),
      metadata:z.record(z.string(),z.unknown()).optional(),
      occurredAt:z.string().datetime().nullable().optional(),
    }).safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid custom-agent event.",parsed.error.flatten());
    const principal=c.get("principal");
    return c.json({data:await service.emitEvent(principal,parsed.data)},202);
  });

  routes.get("/:id/shares",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.listShares(principal,c.req.param("id"))});
  });

  routes.put("/:id/shares",async c=>{
    const parsed=z.object({shares:z.array(shareSchema).max(100)}).safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid custom employee sharing rules.",parsed.error.flatten());
    const principal=c.get("principal");
    return c.json({data:await service.replaceShares(principal,c.req.param("id"),parsed.data.shares)});
  });

  routes.get("/:id/triggers",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.listTriggers(principal,c.req.param("id"))});
  });

  routes.post("/:id/sync",async c=>{
    const principal=c.get("principal");
    await service.syncAgent(principal,c.req.param("id"));
    return c.json({data:{synced:true}});
  });

  routes.patch("/:id/status",async c=>{
    const parsed=statusSchema.safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid custom employee status.",parsed.error.flatten());
    const principal=c.get("principal");
    return c.json({data:await service.setStatus(principal,c.req.param("id"),parsed.data.status)});
  });

  routes.post("/:id/run",async c=>{
    const parsed=runSchema.safeParse(await c.req.json().catch(()=>({})));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid custom employee run request.",parsed.error.flatten());
    const principal=c.get("principal");
    return c.json({data:await service.runNow(principal,c.req.param("id"),parsed.data.instruction)},202);
  });

  routes.get("/:id/metrics",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.metrics(principal,c.req.param("id"))});
  });

  routes.get("/:id/history",async c=>{
    const parsed=z.coerce.number().int().min(1).max(300).default(100).safeParse(c.req.query("limit")??100);
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid history limit.");
    const principal=c.get("principal");
    return c.json({data:await service.history(principal,c.req.param("id"),parsed.data)});
  });

  return routes;
}

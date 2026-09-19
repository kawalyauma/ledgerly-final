import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import type { AppEnv } from "../../../http/types.js";
import { requireScope } from "../../core-identity/security.js";
import type { LedgerlyAiIncidentService } from "./service.js";

const statuses=[
  "open","investigating","fixing","testing","staging","awaiting_approval",
  "deployed","verified","closed","failed",
] as const;

export function createLedgerlyAiIncidentRoutes(service:LedgerlyAiIncidentService){
  const routes=new Hono<AppEnv>();

  routes.get("/",requireScope("admin:read"),async c=>{
    const parsed=z.object({
      status:z.enum(statuses).optional(),
      limit:z.coerce.number().int().min(1).max(300).default(100),
    }).safeParse({status:c.req.query("status")||undefined,limit:c.req.query("limit")||100});
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid incident filters.",parsed.error.flatten());
    return c.json({data:await service.list(c.get("principal"),parsed.data)});
  });

  routes.post("/signals",requireScope("admin:write"),async c=>{
    const parsed=z.object({
      source:z.string().trim().min(1).max(120).default("manual"),
      signalType:z.enum(["http","exception","queue","health","manual"]).default("manual"),
      message:z.string().trim().min(1).max(12000),
      title:z.string().trim().max(220).optional(),
      code:z.string().trim().max(120).nullable().optional(),
      httpStatus:z.number().int().min(100).max(599).nullable().optional(),
      path:z.string().max(1000).nullable().optional(),
      method:z.string().max(20).nullable().optional(),
      moduleKey:z.string().max(120).nullable().optional(),
      correlationId:z.string().max(200).nullable().optional(),
      context:z.record(z.string(),z.unknown()).optional(),
      severityHint:z.enum(["low","medium","high","critical"]).optional(),
    }).safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid engineering signal.",parsed.error.flatten());
    const principal=c.get("principal");
    return c.json({data:await service.signal({...parsed.data,organizationId:principal.organizationId})},202);
  });

  routes.post("/feature-requests",requireScope("admin:write"),async c=>{
    const parsed=z.object({
      title:z.string().trim().min(1).max(220),
      description:z.string().trim().min(1).max(8000),
      employeeKey:z.enum(["kato","maya","tendo","nia","jabali","safi"]),
      chatId:z.string().trim().max(120).nullable().optional(),
    }).safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid engineering task request.",parsed.error.flatten());
    return c.json({data:await service.requestFeatureTask(c.get("principal"),parsed.data)},202);
  });

  routes.get("/:id",requireScope("admin:read"),async c=>
    c.json({data:await service.detail(c.get("principal"),c.req.param("id"))})
  );

  routes.post("/:id/retry",requireScope("admin:write"),async c=>
    c.json({data:await service.retry(c.get("principal"),c.req.param("id"))},202)
  );

  routes.post("/:id/staging/rollback",requireScope("admin:write"),async c=>
    c.json({data:await service.rollbackStaging(c.get("principal"),c.req.param("id"))})
  );

  routes.post("/:id/production/approve",requireScope("admin:write"),async c=>{
    const body=z.object({note:z.string().trim().max(1000).optional()}).safeParse(await c.req.json().catch(()=>({})));
    if(!body.success)throw new AppError(422,"VALIDATION_ERROR","Invalid approval note.",body.error.flatten());
    return c.json({data:await service.reviewProductionApproval(c.get("principal"),c.req.param("id"),"approve",body.data.note)});
  });

  routes.post("/:id/production/reject",requireScope("admin:write"),async c=>{
    const body=z.object({note:z.string().trim().max(1000).optional()}).safeParse(await c.req.json().catch(()=>({})));
    if(!body.success)throw new AppError(422,"VALIDATION_ERROR","Invalid rejection note.",body.error.flatten());
    return c.json({data:await service.reviewProductionApproval(c.get("principal"),c.req.param("id"),"reject",body.data.note)});
  });

  routes.post("/:id/production/record",requireScope("admin:write"),async c=>{
    const body=z.object({
      deployedRef:z.string().trim().min(4).max(200),
      previousRef:z.string().trim().max(200).nullable().optional(),
      note:z.string().trim().max(1000).optional(),
    }).safeParse(await c.req.json().catch(()=>null));
    if(!body.success)throw new AppError(422,"VALIDATION_ERROR","Invalid production deployment record.",body.error.flatten());
    return c.json({data:await service.recordProductionDeployment(c.get("principal"),c.req.param("id"),body.data)});
  });

  routes.post("/:id/production/rollback",requireScope("admin:write"),async c=>{
    const body=z.object({
      restoredRef:z.string().trim().min(4).max(200),
      note:z.string().trim().max(1000).optional(),
    }).safeParse(await c.req.json().catch(()=>null));
    if(!body.success)throw new AppError(422,"VALIDATION_ERROR","Invalid rollback record.",body.error.flatten());
    return c.json({data:await service.recordProductionRollback(c.get("principal"),c.req.param("id"),body.data)});
  });

  routes.post("/:id/verify",requireScope("admin:write"),async c=>
    c.json({data:await service.verifyAndClose(c.get("principal"),c.req.param("id"))})
  );

  return routes;
}

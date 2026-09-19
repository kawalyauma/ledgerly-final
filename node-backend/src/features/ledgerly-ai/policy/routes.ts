import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import type { AppEnv } from "../../../http/types.js";
import { requireScope } from "../../core-identity/security.js";
import type { LedgerlyAiPolicyService } from "./service.js";

const risks=["low","medium","high","critical"] as const;
const effects=["auto","single","two_step","deny"] as const;

export function createLedgerlyAiPolicyRoutes(service:LedgerlyAiPolicyService){
  const routes=new Hono<AppEnv>();

  routes.get("/controls",requireScope("admin:read"),async c=>
    c.json({data:await service.listControls(c.get("principal"))})
  );

  routes.put("/controls/organization",requireScope("admin:write"),async c=>{
    const parsed=z.object({
      state:z.enum(["active","paused","stopped"]),
      reason:z.string().trim().max(1000).nullable().optional(),
    }).safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid organization AI control.",parsed.error.flatten());
    return c.json({data:await service.setControl(c.get("principal"),{
      scopeType:"organization",state:parsed.data.state,reason:parsed.data.reason,
    })});
  });

  routes.put("/controls/agents/:id",requireScope("admin:write"),async c=>{
    const parsed=z.object({
      state:z.enum(["active","paused","stopped"]),
      reason:z.string().trim().max(1000).nullable().optional(),
    }).safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid employee AI control.",parsed.error.flatten());
    return c.json({data:await service.setControl(c.get("principal"),{
      scopeType:"agent",scopeId:c.req.param("id"),state:parsed.data.state,reason:parsed.data.reason,
    })});
  });

  routes.get("/rules",requireScope("admin:read"),async c=>
    c.json({data:await service.listRules(c.get("principal"))})
  );

  routes.put("/rules/:id",requireScope("admin:write"),async c=>{
    const parsed=z.object({
      name:z.string().trim().min(2).max(160),
      actionPattern:z.string().trim().min(1).max(240),
      agentKey:z.string().trim().max(120).nullable().optional(),
      minRisk:z.enum(risks).nullable().optional(),
      mutatingOnly:z.boolean().default(false),
      productionOnly:z.boolean().default(false),
      effect:z.enum(effects),
      reviewerRole:z.enum(["admin","owner"]).nullable().optional(),
      priority:z.number().int().min(0).max(10000).default(100),
      enabled:z.boolean().default(true),
    }).safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid Ledgerly AI policy rule.",parsed.error.flatten());
    return c.json({data:await service.upsertRule(c.get("principal"),{id:c.req.param("id"),...parsed.data})});
  });

  routes.post("/rules",requireScope("admin:write"),async c=>{
    const parsed=z.object({
      name:z.string().trim().min(2).max(160),
      actionPattern:z.string().trim().min(1).max(240),
      agentKey:z.string().trim().max(120).nullable().optional(),
      minRisk:z.enum(risks).nullable().optional(),
      mutatingOnly:z.boolean().default(false),
      productionOnly:z.boolean().default(false),
      effect:z.enum(effects),
      reviewerRole:z.enum(["admin","owner"]).nullable().optional(),
      priority:z.number().int().min(0).max(10000).default(100),
      enabled:z.boolean().default(true),
    }).safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid Ledgerly AI policy rule.",parsed.error.flatten());
    return c.json({data:await service.upsertRule(c.get("principal"),parsed.data)},201);
  });

  routes.delete("/rules/:id",requireScope("admin:write"),async c=>
    c.json({data:await service.deleteRule(c.get("principal"),c.req.param("id"))})
  );

  routes.get("/audit",requireScope("admin:read"),async c=>{
    const parsed=z.coerce.number().int().min(1).max(500).default(200).safeParse(c.req.query("limit")||200);
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid privileged audit limit.");
    return c.json({data:await service.auditLog(c.get("principal"),parsed.data)});
  });

  return routes;
}

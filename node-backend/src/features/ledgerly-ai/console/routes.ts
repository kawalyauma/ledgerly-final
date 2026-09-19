import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import type { AppEnv } from "../../../http/types.js";
import { requireScope } from "../../core-identity/security.js";
import type { LedgerlyAiConsoleService } from "./service.js";

function limit(value:string|undefined,def:number,max=500){
  const parsed=z.coerce.number().int().min(1).max(max).default(def).safeParse(value??def);
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid console limit.");
  return parsed.data;
}
export function createLedgerlyAiConsoleRoutes(service:LedgerlyAiConsoleService){
  const routes=new Hono<AppEnv>();
  routes.use("*",requireScope("admin:read"));
  routes.get("/overview",async c=>c.json({data:await service.overview(c.get("principal"))}));
  routes.get("/jobs",async c=>{
    const status=z.enum(["queued","running","waiting_approval","completed","failed","cancelled"]).optional()
      .safeParse(c.req.query("status")||undefined);
    if(!status.success)throw new AppError(422,"VALIDATION_ERROR","Invalid job status.");
    return c.json({data:await service.jobs(c.get("principal"),{status:status.data,limit:limit(c.req.query("limit"),150)})});
  });
  routes.get("/activity",async c=>c.json({data:await service.activity(c.get("principal"),limit(c.req.query("limit"),200))}));
  routes.get("/deployments",async c=>c.json({data:await service.deployments(c.get("principal"),limit(c.req.query("limit"),150,300))}));
  routes.get("/audit",async c=>c.json({data:await service.audit(c.get("principal"),limit(c.req.query("limit"),250))}));
  routes.get("/usage",async c=>{
    const days=z.coerce.number().int().min(1).max(90).default(7).safeParse(c.req.query("days")||7);
    if(!days.success)throw new AppError(422,"VALIDATION_ERROR","Invalid usage window.");
    return c.json({data:await service.usage(c.get("principal"),days.data)});
  });
  return routes;
}

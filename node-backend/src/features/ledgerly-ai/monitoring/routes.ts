import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import type { AppEnv } from "../../../http/types.js";
import { requireScope } from "../../core-identity/security.js";
import type { LedgerlyAiMonitoringService } from "./service.js";

export function createLedgerlyAiMonitoringRoutes(service:LedgerlyAiMonitoringService){
  const routes=new Hono<AppEnv>();

  routes.get("/overview",requireScope("admin:read"),async c=>
    c.json({data:await service.overview(c.get("principal"))})
  );

  routes.get("/samples",requireScope("admin:read"),async c=>{
    const parsed=z.coerce.number().int().min(1).max(500).default(100).safeParse(c.req.query("limit")||100);
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid monitoring sample limit.");
    return c.json({data:await service.samples(c.get("principal"),parsed.data)});
  });

  routes.get("/summaries",requireScope("admin:read"),async c=>{
    const parsed=z.coerce.number().int().min(1).max(100).default(30).safeParse(c.req.query("limit")||30);
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid monitoring summary limit.");
    return c.json({data:await service.summaries(c.get("principal"),parsed.data)});
  });

  routes.post("/scan",requireScope("admin:write"),async c=>
    c.json({data:await service.scan()})
  );

  routes.post("/summaries/:period",requireScope("admin:write"),async c=>{
    const parsed=z.enum(["daily","weekly"]).safeParse(c.req.param("period"));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Summary period must be daily or weekly.");
    return c.json({data:await service.generateSummary(parsed.data)});
  });

  return routes;
}

import { Hono, type Context } from "hono";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import type { AppEnv } from "../../../http/types.js";
import type { LedgerlyAiForgeService } from "./service.js";

const messageSchema=z.object({message:z.string().trim().min(1).max(12000)});
const sandboxSchema=z.object({prompt:z.string().trim().min(1).max(12000)});
async function json<T extends z.ZodType>(schema:T,c:Context<AppEnv>){
  const parsed=schema.safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid Forge request.",parsed.error.flatten());
  return parsed.data as z.infer<T>;
}

export function createLedgerlyAiForgeRoutes(service:LedgerlyAiForgeService){
  const routes=new Hono<AppEnv>();

  routes.get("/sessions",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.listSessions(principal)});
  });

  routes.post("/sessions",async c=>{
    const principal=c.get("principal");
    const parsed=z.object({
      initialMessage:z.string().trim().max(12000).optional(),
      sourceAgentId:z.string().trim().max(160).nullable().optional(),
    }).safeParse(await c.req.json().catch(()=>({})));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid Forge session request.",parsed.error.flatten());
    return c.json({data:await service.createSession(principal,parsed.data)},201);
  });

  routes.get("/sessions/:id",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.builderContext(principal,c.req.param("id"))});
  });

  routes.get("/sessions/:id/messages",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.messages(principal,c.req.param("id"))});
  });

  routes.post("/sessions/:id/messages",async c=>{
    const principal=c.get("principal");
    const body=await json(messageSchema,c);
    return c.json({data:await service.sendMessage(principal,c.req.param("id"),body.message)});
  });

  routes.get("/sessions/:id/preview",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.preview(principal,c.req.param("id"))});
  });

  routes.post("/sessions/:id/sandbox",async c=>{
    const principal=c.get("principal");
    const body=await json(sandboxSchema,c);
    return c.json({data:await service.sandbox(principal,c.req.param("id"),body.prompt)});
  });

  routes.post("/sessions/:id/activate",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.activate(principal,c.req.param("id"))},201);
  });

  routes.get("/agents",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.listCustomAgents(principal)});
  });

  routes.post("/agents/:id/disable",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.disable(principal,c.req.param("id"))});
  });

  routes.post("/agents/:id/enable",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.enable(principal,c.req.param("id"))});
  });

  routes.post("/agents/:id/revise",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.beginRevision(principal,c.req.param("id"))},201);
  });

  routes.post("/agents/:id/clone",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.clone(principal,c.req.param("id"))},201);
  });

  routes.get("/agents/:id/export",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.exportAgent(principal,c.req.param("id"))});
  });

  routes.get("/agents/:id/versions",async c=>{
    const principal=c.get("principal");
    return c.json({data:await service.versions(principal,c.req.param("id"))});
  });

  routes.delete("/agents/:id",async c=>{
    const principal=c.get("principal");
    await service.deleteAgent(principal,c.req.param("id"));
    return c.body(null,204);
  });

  return routes;
}

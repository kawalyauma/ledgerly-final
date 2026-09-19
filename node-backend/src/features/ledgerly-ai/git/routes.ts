import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import type { AppEnv } from "../../../http/types.js";
import { requireScope } from "../../core-identity/security.js";
import type { LedgerlyAiGitService } from "./service.js";

const agentKeys=["kato","maya","tendo","nia","jabali","safi"] as const;

export function createLedgerlyAiGitRoutes(service:LedgerlyAiGitService){
  const routes=new Hono<AppEnv>();

  routes.get("/workspaces",requireScope("admin:read"),async c=>{
    const parsed=z.coerce.number().int().min(1).max(300).default(100).safeParse(c.req.query("limit")||100);
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid Git workspace limit.");
    return c.json({data:await service.list(c.get("principal"),parsed.data)});
  });

  routes.post("/workspaces",requireScope("admin:write"),async c=>{
    const parsed=z.object({
      workKind:z.enum(["task","manual"]),
      workKey:z.string().trim().min(1).max(120),
      agentKey:z.enum(agentKeys),
      title:z.string().trim().min(2).max(220),
    }).safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid Git workspace request.",parsed.error.flatten());
    const principal=c.get("principal");
    return c.json({data:await service.createWorkspace({
      organizationId:principal.organizationId,
      workKind:parsed.data.workKind,
      workKey:parsed.data.workKey,
      agentKey:parsed.data.agentKey,
      title:parsed.data.title,
      createdBy:principal.userId,
    })},201);
  });

  routes.post("/workspaces/:id/pull-request",requireScope("admin:write"),async c=>{
    const body=z.object({
      title:z.string().trim().max(240).optional(),
      body:z.string().max(60000).optional(),
    }).safeParse(await c.req.json().catch(()=>({})));
    if(!body.success)throw new AppError(422,"VALIDATION_ERROR","Invalid pull request request.",body.error.flatten());
    const principal=c.get("principal");
    const workspace=await service.getWorkspace(c.req.param("id"));
    if(workspace.organizationId!==principal.organizationId)throw new AppError(404,"GIT_WORKSPACE_NOT_FOUND","Git workspace not found.");
    return c.json({data:await service.createPullRequest({
      workspaceId:workspace.id,title:body.data.title,body:body.data.body,createdBy:principal.userId,
    })},201);
  });

  routes.post("/workspaces/:id/update-base",requireScope("admin:write"),async c=>{
    const body=z.object({push:z.boolean().default(false)}).safeParse(await c.req.json().catch(()=>({})));
    if(!body.success)throw new AppError(422,"VALIDATION_ERROR","Invalid Git update request.",body.error.flatten());
    const principal=c.get("principal");
    const workspace=await service.getWorkspace(c.req.param("id"));
    if(workspace.organizationId!==principal.organizationId)throw new AppError(404,"GIT_WORKSPACE_NOT_FOUND","Git workspace not found.");
    return c.json({data:await service.updateFromBase({workspaceId:workspace.id,push:body.data.push})});
  });

  routes.post("/pull-requests/:id/sync",requireScope("admin:read"),async c=>{
    const principal=c.get("principal");
    const pr=await service.getPullRequest(c.req.param("id"));
    if(pr.organizationId!==principal.organizationId)throw new AppError(404,"GIT_PR_NOT_FOUND","Pull request record not found.");
    return c.json({data:await service.syncPullRequest(pr.id)});
  });

  routes.get("/pull-requests/:id/readiness",requireScope("admin:read"),async c=>{
    const principal=c.get("principal");
    const pr=await service.getPullRequest(c.req.param("id"));
    if(pr.organizationId!==principal.organizationId)throw new AppError(404,"GIT_PR_NOT_FOUND","Pull request record not found.");
    return c.json({data:await service.assertMergeReady(pr.id)});
  });

  routes.post("/pull-requests/:id/merge",requireScope("admin:write"),async c=>
    c.json({data:await service.mergePullRequest(c.req.param("id"),c.get("principal"))})
  );

  return routes;
}

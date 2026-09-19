import { Hono } from "hono";
import { z } from "zod";
import { AppError, requireScope } from "./shared.js";
import type { AppVariables, Env } from "./shared.js";

export const agenticIntegrationRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

agenticIntegrationRoutes.get("/multi-agent/activity", requireScope("school:read"), async c => {
  const parsed=z.coerce.number().int().min(1).max(500).default(100).safeParse(c.req.query("limit") ?? 100);
  if(!parsed.success) throw new AppError(422,"VALIDATION_ERROR","Invalid activity limit");
  const principal=c.get("principal");
  const rows=await c.env.FINANCE_DB.prepare(`
    SELECT id,job_id AS "jobId",chat_id AS "chatId",handoff_id AS "handoffId",
           agent_key AS "agentKey",event_type AS "eventType",status,
           metadata_json AS metadata,created_at AS "createdAt"
    FROM lai_agent_activity
    WHERE organization_id=?
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(principal.organizationId,parsed.data).all();
  return c.json({data:rows.results});
});

agenticIntegrationRoutes.get("/multi-agent/handoffs", requireScope("school:read"), async c => {
  const status=c.req.query("status");
  const parsed=z.enum(["running","completed","failed","cancelled"]).optional().safeParse(status || undefined);
  if(!parsed.success) throw new AppError(422,"VALIDATION_ERROR","Invalid handoff status");
  const principal=c.get("principal");
  const rows=await c.env.FINANCE_DB.prepare(`
    SELECT id,parent_handoff_id AS "parentHandoffId",root_handoff_id AS "rootHandoffId",
           parent_job_id AS "parentJobId",child_job_id AS "childJobId",
           parent_chat_id AS "parentChatId",child_chat_id AS "childChatId",
           from_agent_key AS "fromAgentKey",to_agent_key AS "toAgentKey",
           requested_by AS "requestedBy",request_text AS request,status,depth,
           response_text AS response,error_text AS error,
           context_json AS context,created_at AS "createdAt",completed_at AS "completedAt"
    FROM lai_agent_handoffs
    WHERE organization_id=? AND (? IS NULL OR status=?)
    ORDER BY created_at DESC
    LIMIT 200
  `).bind(principal.organizationId,parsed.data ?? null,parsed.data ?? null).all();
  return c.json({data:rows.results});
});

agenticIntegrationRoutes.get("/multi-agent/jobs", requireScope("school:read"), async c => {
  const status=c.req.query("status");
  const parsed=z.enum(["queued","running","waiting_approval","completed","failed","cancelled"]).optional().safeParse(status || undefined);
  if(!parsed.success) throw new AppError(422,"VALIDATION_ERROR","Invalid job status");
  const principal=c.get("principal");
  const rows=await c.env.FINANCE_DB.prepare(`
    SELECT id,agent_id AS "agentId",chat_id AS "chatId",created_by AS "createdBy",
           status,correlation_id AS "correlationId",input_json AS input,
           result_json AS result,error_text AS error,
           started_at AS "startedAt",completed_at AS "completedAt",created_at AS "createdAt"
    FROM lai_jobs
    WHERE organization_id=? AND kind='agentic-employee'
      AND (? IS NULL OR status=?)
    ORDER BY created_at DESC
    LIMIT 200
  `).bind(principal.organizationId,parsed.data ?? null,parsed.data ?? null).all();
  return c.json({data:rows.results});
});

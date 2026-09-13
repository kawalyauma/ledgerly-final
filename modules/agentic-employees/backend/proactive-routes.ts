import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../src/lib/errors";
import { requireScope } from "../../../src/lib/auth";
import type { AppVariables, Env } from "../../../src/types";
import { ensureDefaultProactiveSchedules, nextOccurrence, organizationTimezone, workflowDefinition } from "./proactive";
import { runProactiveWorkflow } from "./proactive-orchestrator";

export const agenticProactiveRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

agenticProactiveRoutes.get("/proactive/schedules", requireScope("school:read"), async c => {
  const p = c.get("principal");
  const rows = await c.env.FINANCE_DB.prepare(`SELECT id,workflow_key AS workflowKey,agent_key AS agentKey,actor_user_id AS actorUserId,enabled,cadence,
    run_hour AS runHour,run_minute AS runMinute,weekday,last_run_at AS lastRunAt,next_run_at AS nextRunAt,updated_at AS updatedAt
    FROM ae_proactive_schedules WHERE organization_id=? ORDER BY run_hour,run_minute,workflow_key`).bind(p.organizationId).all();
  return c.json({ data: rows.results });
});

agenticProactiveRoutes.post("/proactive/initialize", requireScope("school:write"), async c => {
  const p = c.get("principal");
  await ensureDefaultProactiveSchedules(c.env.FINANCE_DB, p.organizationId, p.userId);
  const rows = await c.env.FINANCE_DB.prepare(`SELECT id,workflow_key AS workflowKey,agent_key AS agentKey,actor_user_id AS actorUserId,enabled,cadence,
    run_hour AS runHour,run_minute AS runMinute,weekday,last_run_at AS lastRunAt,next_run_at AS nextRunAt
    FROM ae_proactive_schedules WHERE organization_id=? ORDER BY run_hour,run_minute,workflow_key`).bind(p.organizationId).all();
  return c.json({ data: rows.results }, 201);
});

agenticProactiveRoutes.patch("/proactive/schedules/:id", requireScope("school:write"), async c => {
  const parsed = z.object({ enabled: z.boolean().optional(), cadence: z.enum(["daily", "weekly"]).optional(), runHour: z.number().int().min(0).max(23).optional(), runMinute: z.number().int().min(0).max(59).optional(), weekday: z.number().int().min(0).max(6).nullable().optional() }).safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid proactive schedule", parsed.error.flatten());
  const p = c.get("principal");
  const row = await c.env.FINANCE_DB.prepare("SELECT id,cadence,run_hour AS runHour,run_minute AS runMinute,weekday FROM ae_proactive_schedules WHERE id=? AND organization_id=?")
    .bind(c.req.param("id"), p.organizationId).first<any>();
  if (!row) throw new AppError(404, "NOT_FOUND", "Proactive schedule not found");
  const cadence = parsed.data.cadence || row.cadence;
  const runHour = parsed.data.runHour ?? Number(row.runHour);
  const runMinute = parsed.data.runMinute ?? Number(row.runMinute);
  const weekday = parsed.data.weekday === undefined ? row.weekday : parsed.data.weekday;
  const timeZone = await organizationTimezone(c.env.FINANCE_DB, p.organizationId);
  const nextRunAt = nextOccurrence(timeZone, runHour, runMinute, cadence, weekday);
  await c.env.FINANCE_DB.prepare(`UPDATE ae_proactive_schedules SET enabled=COALESCE(?,enabled),cadence=?,run_hour=?,run_minute=?,weekday=?,actor_user_id=?,next_run_at=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`)
    .bind(parsed.data.enabled === undefined ? null : parsed.data.enabled ? 1 : 0, cadence, runHour, runMinute, weekday, p.userId, nextRunAt, p.userId, row.id, p.organizationId).run();
  return c.json({ data: { id: row.id, enabled: parsed.data.enabled, cadence, runHour, runMinute, weekday, nextRunAt, actorUserId: p.userId } });
});

agenticProactiveRoutes.post("/proactive/run/:workflowKey", requireScope("school:write"), async c => {
  const p = c.get("principal"), workflowKey = c.req.param("workflowKey");
  if (!workflowDefinition(workflowKey)) throw new AppError(404, "PROACTIVE_WORKFLOW_NOT_FOUND", "Unknown proactive AI workflow");
  const data = await runProactiveWorkflow(c.env, p.organizationId, p.userId, workflowKey, "manual");
  return c.json({ data }, 201);
});

agenticProactiveRoutes.get("/proactive/runs", requireScope("school:read"), async c => {
  const p = c.get("principal"), limit = Math.max(1, Math.min(100, Number(c.req.query("limit") || 30)));
  const rows = await c.env.FINANCE_DB.prepare(`SELECT id,workflow_key AS workflowKey,agent_key AS agentKey,actor_user_id AS actorUserId,parent_run_id AS parentRunId,
    trigger_type AS triggerType,status,summary,error_text AS errorText,model,started_at AS startedAt,completed_at AS completedAt
    FROM ae_proactive_runs WHERE organization_id=? ORDER BY started_at DESC LIMIT ?`).bind(p.organizationId, limit).all();
  return c.json({ data: rows.results });
});

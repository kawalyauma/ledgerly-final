import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import type { Env } from "../../../src/types";
import { AGENTS, type AgentKey, type ModelTier } from "./policy";
import { proactiveContext } from "./proactive-data";
import { runProactiveModel } from "./proactive-model";
import { workflowDefinition } from "./proactive";

async function assertActor(db: D1Database, organizationId: string, userId: string) {
  const row = await db.prepare(`SELECT u.status,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? AND m.user_id=?`)
    .bind(organizationId, userId).first<{ status: string; role: string }>();
  if (!row || row.status !== "active") throw new AppError(403, "AUTOMATION_ACTOR_INVALID", "The proactive schedule owner no longer has an active organization membership");
  return row;
}

async function agentSettings(db: D1Database, organizationId: string, key: AgentKey) {
  const base = AGENTS[key];
  const row = await db.prepare("SELECT enabled,model_tier AS modelTier,system_prompt AS systemPrompt FROM ae_agent_settings WHERE organization_id=? AND agent_key=?")
    .bind(organizationId, key).first<{ enabled: number; modelTier: ModelTier | null; systemPrompt: string | null }>();
  return { ...base, enabled: row ? Boolean(row.enabled) : true, modelTier: (row?.modelTier || base.modelTier) as ModelTier, systemPrompt: row?.systemPrompt?.trim() || base.systemPrompt };
}

async function createRun(db: D1Database, organizationId: string, actorUserId: string, workflowKey: string, agentKey: AgentKey, triggerType: string, scheduleId?: string | null, parentRunId?: string | null) {
  const id = createId("apr"), conversationId = createId("aac");
  await db.batch([
    db.prepare("INSERT INTO ae_proactive_runs(id,organization_id,schedule_id,workflow_key,agent_key,actor_user_id,conversation_id,parent_run_id,trigger_type,status) VALUES(?,?,?,?,?,?,?,?,?,'running')")
      .bind(id, organizationId, scheduleId || null, workflowKey, agentKey, actorUserId, conversationId, parentRunId || null, triggerType),
    db.prepare("INSERT INTO ae_conversations(id,organization_id,agent_key,created_by,title,status) VALUES(?,?,?,?,?,'active')")
      .bind(conversationId, organizationId, agentKey, actorUserId, `Proactive: ${workflowKey}`),
  ]);
  return { id, conversationId };
}

async function completeRun(db: D1Database, organizationId: string, runId: string, summary: string, model: string, metadata: unknown) {
  await db.prepare("UPDATE ae_proactive_runs SET status='completed',summary=?,model=?,metadata_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
    .bind(summary, model, JSON.stringify(metadata || {}), runId, organizationId).run();
}

async function failRun(db: D1Database, organizationId: string, runId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await db.prepare("UPDATE ae_proactive_runs SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
    .bind(message.slice(0, 2000), runId, organizationId).run();
}

export async function runSingleProactive(env: Env, organizationId: string, actorUserId: string, workflowKey: string, triggerType = "manual", scheduleId?: string | null, parentRunId?: string | null, suppliedContext?: unknown) {
  const workflow = workflowDefinition(workflowKey);
  if (!workflow) throw new AppError(404, "PROACTIVE_WORKFLOW_NOT_FOUND", "Unknown proactive AI workflow");
  await assertActor(env.FINANCE_DB, organizationId, actorUserId);
  const agent = await agentSettings(env.FINANCE_DB, organizationId, workflow.agentKey);
  const run = await createRun(env.FINANCE_DB, organizationId, actorUserId, workflowKey, workflow.agentKey, triggerType, scheduleId, parentRunId);
  if (!agent.enabled) {
    await env.FINANCE_DB.prepare("UPDATE ae_proactive_runs SET status='skipped',summary='Agent disabled',completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(run.id, organizationId).run();
    return { id: run.id, workflowKey, agentKey: workflow.agentKey, status: "skipped", summary: "Agent disabled" };
  }
  try {
    const context = suppliedContext ?? await proactiveContext(env.FINANCE_DB, organizationId, workflowKey);
    const result = await runProactiveModel(env as Env & Record<string, unknown>, agent.modelTier, `${agent.systemPrompt}\nThis is a proactive read-only run. Do not claim to have changed or sent anything.`, `${workflow.prompt}\n\nVerified Ledgerly context:\n${JSON.stringify(context)}`);
    await completeRun(env.FINANCE_DB, organizationId, run.id, result.text, result.model, { providerResponseId: result.providerResponseId, usage: result.usage });
    return { id: run.id, workflowKey, agentKey: workflow.agentKey, status: "completed", summary: result.text, model: result.model };
  } catch (error) {
    await failRun(env.FINANCE_DB, organizationId, run.id, error);
    throw error;
  }
}

export { assertActor, agentSettings, createRun, completeRun, failRun };

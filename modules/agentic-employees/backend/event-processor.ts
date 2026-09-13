import { createId } from "../../../src/lib/ids";
import type { Env } from "../../../src/types";
import { AGENTS, type AgentKey, type ModelTier } from "./policy";
import { loadEventSettings, type EventEnvelope, type EvaluatedEvent } from "./event-context";
import { evaluateEmployeeEvent } from "./event-context-v13";
import { retryDelayMinutes } from "./event-policy";
import { runProactiveModel } from "./proactive-model";

type EventRow = EventEnvelope & { attempts: number };

async function effectiveAgent(db: D1Database, organizationId: string, key: AgentKey) {
  const base = AGENTS[key];
  const row = await db.prepare("SELECT enabled,model_tier AS modelTier,system_prompt AS systemPrompt FROM ae_agent_settings WHERE organization_id=? AND agent_key=?")
    .bind(organizationId,key).first<{ enabled: number; modelTier: ModelTier | null; systemPrompt: string | null }>();
  return {
    ...base,
    enabled: row ? Boolean(row.enabled) : true,
    modelTier: (row?.modelTier || base.modelTier) as ModelTier,
    systemPrompt: row?.systemPrompt?.trim() || base.systemPrompt,
  };
}

async function reactionText(env: Env, db: D1Database, event: EventEnvelope, evaluated: EvaluatedEvent, agentKey: AgentKey) {
  const agent = await effectiveAgent(db,event.organizationId,agentKey);
  if (!agent.enabled) return { text: evaluated.fallbackSummary || "Event detected.", model: null, aiError: "Agent disabled" };
  try {
    const result = await runProactiveModel(
      env as Env & Record<string, unknown>,
      agent.modelTier,
      `${agent.systemPrompt}\nYou are reacting to a verified Ledgerly event. Be concise. Do not claim to have contacted anyone or changed any record. Never propose bypassing approvals. State the verified facts, why they matter, and one recommended next action.`,
      JSON.stringify({ eventType: event.eventType, severity: evaluated.severity, facts: evaluated.facts, recommendedAction: evaluated.recommendedAction }),
    );
    return { text: result.text, model: result.model, aiError: null };
  } catch (error) {
    return { text: evaluated.fallbackSummary || "Event detected.", model: null, aiError: error instanceof Error ? error.message : String(error) };
  }
}

async function storeReaction(env: Env, event: EventEnvelope, evaluated: EvaluatedEvent, agentKey: AgentKey) {
  const generated = await reactionText(env,env.FINANCE_DB,event,evaluated,agentKey);
  await env.FINANCE_DB.prepare(`INSERT INTO ae_event_reactions
    (id,organization_id,event_id,agent_key,severity,title,summary,recommended_action,model,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(organization_id,event_id,agent_key) DO NOTHING`)
    .bind(
      createId("aer"),event.organizationId,event.id,agentKey,evaluated.severity || "info",evaluated.title || event.eventType,
      generated.text,evaluated.recommendedAction || null,generated.model,
      JSON.stringify({ facts: evaluated.facts || {}, aiFallback: Boolean(generated.aiError), aiError: generated.aiError }),
    ).run();
}

async function markFailure(db: D1Database, event: EventRow, error: unknown) {
  const attempts = Number(event.attempts || 0) + 1;
  const message = (error instanceof Error ? error.message : String(error)).slice(0,2000);
  if (attempts >= 3) {
    await db.prepare("UPDATE ae_event_inbox SET status='failed',attempts=?,error_text=?,processed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(attempts,message,event.id,event.organizationId).run();
    return;
  }
  const retryAt = new Date(Date.now() + retryDelayMinutes(attempts) * 60_000).toISOString();
  await db.prepare("UPDATE ae_event_inbox SET status='pending',attempts=?,error_text=?,next_attempt_at=? WHERE id=? AND organization_id=?")
    .bind(attempts,message,retryAt,event.id,event.organizationId).run();
}

export async function processEventInbox(env: Env) {
  const rows = await env.FINANCE_DB.prepare(`SELECT id,organization_id AS organizationId,event_type AS eventType,source_module AS sourceModule,
    source_record_id AS sourceRecordId,subject_type AS subjectType,subject_id AS subjectId,payload_json AS payloadJson,
    occurred_at AS occurredAt,attempts FROM ae_event_inbox
    WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP)
    ORDER BY occurred_at LIMIT 20`).all<EventRow>();

  for (const event of rows.results) {
    const claim = await env.FINANCE_DB.prepare(`UPDATE ae_event_inbox SET status='processing',processing_started_at=CURRENT_TIMESTAMP
      WHERE id=? AND organization_id=? AND status='pending'`).bind(event.id,event.organizationId).run();
    if (!Number(claim.meta.changes || 0)) continue;
    try {
      const settings = await loadEventSettings(env.FINANCE_DB,event.organizationId);
      const evaluated = await evaluateEmployeeEvent(env.FINANCE_DB,event,settings);
      if (evaluated.ignored || !evaluated.agentKey) {
        await env.FINANCE_DB.prepare("UPDATE ae_event_inbox SET status='ignored',error_text=?,processed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
          .bind(evaluated.ignoreReason || null,event.id,event.organizationId).run();
        continue;
      }
      await storeReaction(env,event,evaluated,evaluated.agentKey);
      if (evaluated.secondaryAgentKey) await storeReaction(env,event,evaluated,evaluated.secondaryAgentKey);
      await env.FINANCE_DB.prepare("UPDATE ae_event_inbox SET status='processed',error_text=NULL,processed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
        .bind(event.id,event.organizationId).run();
    } catch (error) {
      await markFailure(env,event,error);
    }
  }
}

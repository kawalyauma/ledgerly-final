import { AppError } from "../../../src/lib/errors";
import type { Env } from "../../../src/types";
import { AGENTS, type AgentKey, type ModelTier } from "./policy";

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

export async function runSingleProactive(_env: Env) { return null; }
export { assertActor, agentSettings };

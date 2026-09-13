import { createId } from "../../../src/lib/ids";
import type { EventEnvelope, EvaluatedEvent } from "./event-context";
import { proposalForEvent } from "./action-policy";
import { communicationProposalForEvent } from "./action-communications";

export async function ensureActionForEvent(db: D1Database, event: EventEnvelope, evaluated: EvaluatedEvent) {
  const proposal = communicationProposalForEvent(event,evaluated) || proposalForEvent(event,evaluated);
  if (!proposal) return null;
  const reaction = await db.prepare("SELECT id FROM ae_event_reactions WHERE organization_id=? AND event_id=? AND agent_key=? ORDER BY created_at LIMIT 1")
    .bind(event.organizationId,event.id,proposal.agentKey).first<{id:string}>();
  const id = createId("aea");
  await db.prepare(`INSERT INTO ae_actions
    (id,organization_id,event_id,reaction_id,agent_key,action_type,title,summary,required_scope,payload_json,idempotency_key,status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'suggested')
    ON CONFLICT(organization_id,idempotency_key) DO NOTHING`)
    .bind(id,event.organizationId,event.id,reaction?.id||null,proposal.agentKey,proposal.actionType,proposal.title,proposal.summary,
      proposal.requiredScope,JSON.stringify(proposal.payload),proposal.idempotencyKey).run();
  return db.prepare(`SELECT id,status,action_type AS actionType,title FROM ae_actions WHERE organization_id=? AND idempotency_key=?`)
    .bind(event.organizationId,proposal.idempotencyKey).first();
}

import { createId } from "../../../src/lib/ids";
import type { AuthPrincipal, Env } from "../../../src/types";
import { AGENTS, type AgentDefinition, type AgentKey, type ModelTier } from "./policy";

const READ_ONLY_TOOL_BLOCKLIST = new Set(["prepare_communication", "delegate_to_employee", "family_comprehensive_report"]);

const DELEGATION_TARGETS: Record<AgentKey, AgentKey[]> = {
  secretary: [],
  dos: ["bursar", "secretary", "librarian"],
  bursar: [],
  headteacher: ["dos", "bursar", "hr", "secretary", "librarian"],
  hr: [],
  librarian: [],
};

async function effectiveDelegatedAgent(db: D1Database, organizationId: string, key: AgentKey) {
  const base = AGENTS[key];
  const row = await db.prepare(`SELECT enabled,model_tier AS modelTier,system_prompt AS systemPrompt
    FROM ae_agent_settings WHERE organization_id=? AND agent_key=?`).bind(organizationId, key)
    .first<{ enabled: number; modelTier: ModelTier | null; systemPrompt: string | null }>();
  const agent: AgentDefinition & { enabled: boolean } = {
    ...base,
    modelTier: (row?.modelTier || base.modelTier) as ModelTier,
    systemPrompt: `${row?.systemPrompt?.trim() || base.systemPrompt}\nYou are handling a delegated read-only subtask. Do not prepare communications, delegate further, or claim to have changed Ledgerly data. Return verified findings to the requesting employee.`,
    enabled: row ? Boolean(row.enabled) : true,
  };
  return agent;
}

export async function delegateToEmployee(input: {
  db: D1Database;
  env: Env & Record<string, unknown>;
  principal: AuthPrincipal;
  parentConversationId: string;
  fromAgent: AgentDefinition;
  toAgentKey: AgentKey;
  request: string;
}) {
  const allowed = DELEGATION_TARGETS[input.fromAgent.key] || [];
  if (!allowed.includes(input.toAgentKey)) throw new Error(`${input.fromAgent.key} cannot delegate to ${input.toAgentKey}`);
  const target = await effectiveDelegatedAgent(input.db, input.principal.organizationId, input.toAgentKey);
  if (!target.enabled) throw new Error(`The ${target.title} is disabled`);

  const delegationId = createId("aed"), childConversationId = createId("aac"), userMessageId = createId("aam");
  await input.db.batch([
    input.db.prepare(`INSERT INTO ae_delegations
      (id,organization_id,parent_conversation_id,child_conversation_id,from_agent_key,to_agent_key,requested_by,request_text,status)
      VALUES (?,?,?,?,?,?,?,?, 'running')`)
      .bind(delegationId,input.principal.organizationId,input.parentConversationId,childConversationId,input.fromAgent.key,input.toAgentKey,input.principal.userId,input.request),
    input.db.prepare(`INSERT INTO ae_conversations(id,organization_id,agent_key,created_by,title,status)
      VALUES (?,?,?,?,?,'active')`)
      .bind(childConversationId,input.principal.organizationId,input.toAgentKey,input.principal.userId,`Delegated by ${input.fromAgent.title}`),
    input.db.prepare(`INSERT INTO ae_messages(id,organization_id,conversation_id,role,content,user_id)
      VALUES (?,?,?,'user',?,?)`)
      .bind(userMessageId,input.principal.organizationId,childConversationId,input.request,input.principal.userId),
  ]);

  try {
    const { runAgent } = await import("./openai");
    const requestedTools = target.tools.filter(name => !READ_ONLY_TOOL_BLOCKLIST.has(name));
    const result = await runAgent({
      db: input.db,
      env: input.env,
      principal: input.principal,
      agent: target,
      modelTier: target.modelTier,
      requestedTools,
      conversationId: childConversationId,
      messages: [{ role: "user", content: input.request }],
    });
    const assistantMessageId = createId("aam");
    await input.db.batch([
      input.db.prepare(`INSERT INTO ae_messages
        (id,organization_id,conversation_id,role,content,user_id,model,provider_response_id,metadata_json)
        VALUES (?,?,?,'assistant',?,?,?,?,?)`)
        .bind(assistantMessageId,input.principal.organizationId,childConversationId,result.text,input.principal.userId,result.model,result.providerResponseId,JSON.stringify({ delegated: true, toolEvents: result.toolEvents, usage: result.usage })),
      input.db.prepare(`UPDATE ae_delegations SET status='completed',response_text=?,model=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`)
        .bind(result.text,result.model,delegationId,input.principal.organizationId),
    ]);
    return { delegationId, employee: { key: target.key, name: target.name, title: target.title }, response: result.text, model: result.model };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.db.prepare(`UPDATE ae_delegations SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`)
      .bind(message.slice(0,2000),delegationId,input.principal.organizationId).run();
    throw error;
  }
}

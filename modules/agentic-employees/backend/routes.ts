import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { requireScope } from "../../../src/lib/auth";
import { createId } from "../../../src/lib/ids";
import { AGENTS, allowedTools, isAgentKey, type AgentDefinition, type AgentKey, type ModelTier } from "./policy";
import { runAgent } from "./openai";

export const agenticEmployeeRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type OverrideRow = {
  agentKey: string;
  enabled: number;
  modelTier: ModelTier | null;
  systemPrompt: string | null;
  toolAllowlistJson: string | null;
};

async function effectiveAgent(db: D1Database, organizationId: string, key: AgentKey): Promise<AgentDefinition & { enabled: boolean; configuredTools: string[] }> {
  const base = AGENTS[key];
  const row = await db.prepare(`
    SELECT agent_key AS agentKey, enabled, model_tier AS modelTier,
           system_prompt AS systemPrompt, tool_allowlist_json AS toolAllowlistJson
    FROM ae_agent_settings WHERE organization_id=? AND agent_key=?
  `).bind(organizationId, key).first<OverrideRow>();

  let requested: string[] | null = null;
  try { requested = row?.toolAllowlistJson ? JSON.parse(row.toolAllowlistJson) : null; } catch { requested = null; }

  return {
    ...base,
    modelTier: (row?.modelTier || base.modelTier) as ModelTier,
    systemPrompt: row?.systemPrompt?.trim() || base.systemPrompt,
    enabled: row ? Boolean(row.enabled) : true,
    configuredTools: allowedTools(base, requested),
  };
}

async function assertConversation(db: D1Database, organizationId: string, id: string) {
  const row = await db.prepare(`
    SELECT id, agent_key AS agentKey, title, status
    FROM ae_conversations WHERE id=? AND organization_id=?
  `).bind(id, organizationId).first<{ id: string; agentKey: string; title: string; status: string }>();
  if (!row) throw new AppError(404, "NOT_FOUND", "AI conversation not found");
  return row;
}

agenticEmployeeRoutes.get("/agents", requireScope("school:read"), async c => {
  const principal = c.get("principal");
  const data = [];
  for (const key of Object.keys(AGENTS) as AgentKey[]) data.push(await effectiveAgent(c.env.FINANCE_DB, principal.organizationId, key));
  return c.json({ data });
});

agenticEmployeeRoutes.get("/settings", requireScope("school:read"), async c => {
  const env = c.env as Env & Record<string, unknown>;
  return c.json({
    data: {
      provider: "openai-responses",
      configured: Boolean(env.OPENAI_API_KEY),
      baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      models: {
        luna: env.OPENAI_MODEL_LUNA || "gpt-5.6-luna",
        terra: env.OPENAI_MODEL_TERRA || "gpt-5.6-terra",
        sol: env.OPENAI_MODEL_SOL || "gpt-5.6-sol",
      },
    },
  });
});

agenticEmployeeRoutes.patch("/agents/:key", requireScope("school:write"), async c => {
  const key = c.req.param("key");
  if (!isAgentKey(key)) throw new AppError(404, "NOT_FOUND", "AI employee not found");
  const parsed = z.object({
    enabled: z.boolean().optional(),
    modelTier: z.enum(["luna", "terra", "sol"]).optional(),
    systemPrompt: z.string().min(30).max(8000).nullable().optional(),
    tools: z.array(z.string()).max(20).optional(),
  }).safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid AI employee settings", parsed.error.flatten());

  const principal = c.get("principal");
  const current = await effectiveAgent(c.env.FINANCE_DB, principal.organizationId, key);
  const base = AGENTS[key];
  const enabled = parsed.data.enabled ?? current.enabled;
  const modelTier = parsed.data.modelTier ?? current.modelTier;
  const systemPrompt = parsed.data.systemPrompt === undefined ? current.systemPrompt : parsed.data.systemPrompt;
  const tools = parsed.data.tools ? allowedTools(base, parsed.data.tools) : current.configuredTools;

  await c.env.FINANCE_DB.prepare(`
    INSERT INTO ae_agent_settings
      (organization_id, agent_key, enabled, model_tier, system_prompt, tool_allowlist_json, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(organization_id, agent_key) DO UPDATE SET
      enabled=excluded.enabled,
      model_tier=excluded.model_tier,
      system_prompt=excluded.system_prompt,
      tool_allowlist_json=excluded.tool_allowlist_json,
      updated_by=excluded.updated_by,
      updated_at=CURRENT_TIMESTAMP
  `).bind(
    principal.organizationId,
    key,
    enabled ? 1 : 0,
    modelTier,
    systemPrompt === base.systemPrompt ? null : systemPrompt,
    JSON.stringify(tools),
    principal.userId,
  ).run();

  return c.json({ data: await effectiveAgent(c.env.FINANCE_DB, principal.organizationId, key) });
});

agenticEmployeeRoutes.get("/conversations", requireScope("school:read"), async c => {
  const principal = c.get("principal");
  const result = await c.env.FINANCE_DB.prepare(`
    SELECT id, agent_key AS agentKey, title, status, last_message_at AS lastMessageAt, created_at AS createdAt
    FROM ae_conversations WHERE organization_id=?
    ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT 100
  `).bind(principal.organizationId).all();
  return c.json({ data: result.results });
});

agenticEmployeeRoutes.post("/conversations", requireScope("school:read"), async c => {
  const parsed = z.object({ agentKey: z.string(), title: z.string().max(160).optional() }).safeParse(await c.req.json());
  if (!parsed.success || !isAgentKey(parsed.data.agentKey)) throw new AppError(422, "VALIDATION_ERROR", "Invalid AI employee");
  const principal = c.get("principal");
  const agent = await effectiveAgent(c.env.FINANCE_DB, principal.organizationId, parsed.data.agentKey);
  if (!agent.enabled) throw new AppError(409, "AGENT_DISABLED", "This AI employee is disabled");
  const id = createId("aac");
  const title = parsed.data.title || agent.title;
  await c.env.FINANCE_DB.prepare(`
    INSERT INTO ae_conversations(id, organization_id, agent_key, created_by, title, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).bind(id, principal.organizationId, agent.key, principal.userId, title).run();
  return c.json({ data: { id, agentKey: agent.key, title, status: "active" } }, 201);
});

agenticEmployeeRoutes.get("/conversations/:id/messages", requireScope("school:read"), async c => {
  const principal = c.get("principal");
  await assertConversation(c.env.FINANCE_DB, principal.organizationId, c.req.param("id"));
  const result = await c.env.FINANCE_DB.prepare(`
    SELECT id, role, content, model, provider_response_id AS providerResponseId, created_at AS createdAt
    FROM ae_messages WHERE organization_id=? AND conversation_id=? ORDER BY created_at, id
  `).bind(principal.organizationId, c.req.param("id")).all();
  return c.json({ data: result.results });
});

agenticEmployeeRoutes.post("/conversations/:id/messages", requireScope("school:read"), async c => {
  const parsed = z.object({ content: z.string().trim().min(1).max(12000) }).safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Message is required", parsed.error.flatten());
  const principal = c.get("principal");
  const conversation = await assertConversation(c.env.FINANCE_DB, principal.organizationId, c.req.param("id"));
  if (conversation.status === "closed") throw new AppError(409, "CONVERSATION_CLOSED", "This chat is closed. Start a new chat to continue.");
  if (!isAgentKey(conversation.agentKey)) throw new AppError(409, "AGENT_INVALID", "Conversation agent is invalid");
  const agent = await effectiveAgent(c.env.FINANCE_DB, principal.organizationId, conversation.agentKey);
  if (!agent.enabled) throw new AppError(409, "AGENT_DISABLED", "This AI employee is disabled");

  const userMessageId = createId("aam");
  await c.env.FINANCE_DB.prepare(`
    INSERT INTO ae_messages(id, organization_id, conversation_id, role, content, user_id)
    VALUES (?, ?, ?, 'user', ?, ?)
  `).bind(userMessageId, principal.organizationId, conversation.id, parsed.data.content, principal.userId).run();

  const history = await c.env.FINANCE_DB.prepare(`
    SELECT role, content FROM ae_messages
    WHERE organization_id=? AND conversation_id=? AND role IN ('user','assistant')
    ORDER BY created_at DESC, id DESC LIMIT 24
  `).bind(principal.organizationId, conversation.id).all<{ role: "user" | "assistant"; content: string }>();

  const result = await runAgent({
    db: c.env.FINANCE_DB,
    env: c.env as Env & Record<string, unknown>,
    principal,
    agent,
    modelTier: agent.modelTier,
    requestedTools: agent.configuredTools,
    conversationId: conversation.id,
    messages: [...history.results].reverse(),
  });

  const assistantMessageId = createId("aam");
  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare(`
      INSERT INTO ae_messages
        (id, organization_id, conversation_id, role, content, user_id, model, provider_response_id, metadata_json)
      VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?)
    `).bind(
      assistantMessageId,
      principal.organizationId,
      conversation.id,
      result.text,
      principal.userId,
      result.model,
      result.providerResponseId,
      JSON.stringify({ usage: result.usage, toolEvents: result.toolEvents }),
    ),
    c.env.FINANCE_DB.prepare(`
      UPDATE ae_conversations SET last_message_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND organization_id=?
    `).bind(conversation.id, principal.organizationId),
  ]);

  return c.json({
    data: {
      id: assistantMessageId,
      role: "assistant",
      content: result.text,
      model: result.model,
      toolEvents: result.toolEvents,
    },
  });
});

agenticEmployeeRoutes.get("/tasks", requireScope("school:read"), async c => {
  const principal = c.get("principal");
  const result = await c.env.FINANCE_DB.prepare(`
    SELECT id, agent_key AS agentKey, title, instructions, status,
           result_text AS resultText, error_text AS errorText,
           created_at AS createdAt, completed_at AS completedAt
    FROM ae_tasks WHERE organization_id=? ORDER BY created_at DESC LIMIT 100
  `).bind(principal.organizationId).all();
  return c.json({ data: result.results });
});

agenticEmployeeRoutes.post("/tasks", requireScope("school:read"), async c => {
  const parsed = z.object({
    agentKey: z.string(),
    title: z.string().trim().min(1).max(160),
    instructions: z.string().trim().min(1).max(12000),
  }).safeParse(await c.req.json());
  if (!parsed.success || !isAgentKey(parsed.data.agentKey)) {
    throw new AppError(422, "VALIDATION_ERROR", "Invalid agent task", parsed.success ? undefined : parsed.error.flatten());
  }

  const principal = c.get("principal");
  const agent = await effectiveAgent(c.env.FINANCE_DB, principal.organizationId, parsed.data.agentKey);
  if (!agent.enabled) throw new AppError(409, "AGENT_DISABLED", "This AI employee is disabled");
  const taskId = createId("aak");
  const conversationId = createId("aac");
  const messageId = createId("aam");

  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare(`
      INSERT INTO ae_conversations(id, organization_id, agent_key, created_by, title, status)
      VALUES (?, ?, ?, ?, ?, 'active')
    `).bind(conversationId, principal.organizationId, agent.key, principal.userId, parsed.data.title),
    c.env.FINANCE_DB.prepare(`
      INSERT INTO ae_tasks(id, organization_id, agent_key, conversation_id, created_by, title, instructions, status, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'running', CURRENT_TIMESTAMP)
    `).bind(taskId, principal.organizationId, agent.key, conversationId, principal.userId, parsed.data.title, parsed.data.instructions),
    c.env.FINANCE_DB.prepare(`
      INSERT INTO ae_messages(id, organization_id, conversation_id, role, content, user_id)
      VALUES (?, ?, ?, 'user', ?, ?)
    `).bind(messageId, principal.organizationId, conversationId, parsed.data.instructions, principal.userId),
  ]);

  try {
    const result = await runAgent({
      db: c.env.FINANCE_DB,
      env: c.env as Env & Record<string, unknown>,
      principal,
      agent,
      modelTier: agent.modelTier,
      requestedTools: agent.configuredTools,
      conversationId,
      messages: [{ role: "user", content: parsed.data.instructions }],
    });
    const assistantMessageId = createId("aam");
    await c.env.FINANCE_DB.batch([
      c.env.FINANCE_DB.prepare(`
        UPDATE ae_tasks SET status='completed', result_text=?, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND organization_id=?
      `).bind(result.text, taskId, principal.organizationId),
      c.env.FINANCE_DB.prepare(`
        INSERT INTO ae_messages(id, organization_id, conversation_id, role, content, user_id, model, provider_response_id, metadata_json)
        VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?)
      `).bind(assistantMessageId, principal.organizationId, conversationId, result.text, principal.userId, result.model, result.providerResponseId, JSON.stringify({ usage: result.usage, toolEvents: result.toolEvents })),
      c.env.FINANCE_DB.prepare(`
        UPDATE ae_conversations SET last_message_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND organization_id=?
      `).bind(conversationId, principal.organizationId),
    ]);
    return c.json({ data: { id: taskId, status: "completed", resultText: result.text, conversationId } }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await c.env.FINANCE_DB.prepare(`
      UPDATE ae_tasks SET status='failed', error_text=?, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND organization_id=?
    `).bind(message, taskId, principal.organizationId).run();
    throw error;
  }
});

agenticEmployeeRoutes.get("/approvals", requireScope("school:read"), async c => {
  const principal = c.get("principal");
  const status = c.req.query("status") || "pending";
  const result = await c.env.FINANCE_DB.prepare(`
    SELECT id, conversation_id AS conversationId, agent_key AS agentKey,
           action_type AS actionType, required_scope AS requiredScope,
           payload_json AS payloadJson, status, requested_by AS requestedBy,
           reviewed_by AS reviewedBy, review_note AS reviewNote,
           created_at AS createdAt, reviewed_at AS reviewedAt
    FROM ae_approvals WHERE organization_id=? AND status=? ORDER BY created_at DESC LIMIT 100
  `).bind(principal.organizationId, status).all<Record<string, unknown>>();
  return c.json({
    data: result.results.map(row => {
      const payloadJson = String(row.payloadJson || "{}");
      const { payloadJson: _discard, ...rest } = row;
      return { ...rest, payload: JSON.parse(payloadJson) };
    }),
  });
});

agenticEmployeeRoutes.post("/approvals/:id/:decision", requireScope("school:write"), async c => {
  const decision = c.req.param("decision");
  if (!new Set(["approve", "reject"]).has(decision)) throw new AppError(404, "NOT_FOUND", "Unknown approval action");
  const principal = c.get("principal");
  const row = await c.env.FINANCE_DB.prepare(`
    SELECT id, status, required_scope AS requiredScope
    FROM ae_approvals WHERE id=? AND organization_id=?
  `).bind(c.req.param("id"), principal.organizationId).first<{ id: string; status: string; requiredScope: string }>();
  if (!row) throw new AppError(404, "NOT_FOUND", "Approval not found");
  if (row.status !== "pending") throw new AppError(409, "ALREADY_REVIEWED", "Approval has already been reviewed");
  if (decision === "approve" && principal.role !== "owner" && principal.role !== "admin" && !principal.scopes.includes(row.requiredScope)) {
    throw new AppError(403, "FORBIDDEN", `Approval requires ${row.requiredScope}`);
  }
  const body = await c.req.json().catch(() => ({})) as { note?: string };
  const status = decision === "approve" ? "approved" : "rejected";
  await c.env.FINANCE_DB.prepare(`
    UPDATE ae_approvals SET status=?, reviewed_by=?, review_note=?, reviewed_at=CURRENT_TIMESTAMP
    WHERE id=? AND organization_id=? AND status='pending'
  `).bind(status, principal.userId, body.note || null, row.id, principal.organizationId).run();
  return c.json({
    data: {
      id: row.id,
      status,
      executionStatus: status === "approved" ? "approved-for-executor" : "not-applicable",
    },
  });
});

agenticEmployeeRoutes.get("/activity", requireScope("school:write"), async c => {
  const principal = c.get("principal");
  const [tools, approvals] = await Promise.all([
    c.env.FINANCE_DB.prepare(`
      SELECT id, agent_key AS agentKey, conversation_id AS conversationId,
             tool_name AS toolName, status, error_text AS errorText,
             created_at AS createdAt, completed_at AS completedAt
      FROM ae_tool_calls WHERE organization_id=? ORDER BY created_at DESC LIMIT 100
    `).bind(principal.organizationId).all(),
    c.env.FINANCE_DB.prepare(`
      SELECT id, agent_key AS agentKey, action_type AS actionType, status,
             created_at AS createdAt, reviewed_at AS reviewedAt
      FROM ae_approvals WHERE organization_id=? ORDER BY created_at DESC LIMIT 100
    `).bind(principal.organizationId).all(),
  ]);
  return c.json({ data: { toolCalls: tools.results, approvals: approvals.results } });
});

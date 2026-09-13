import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import type { AuthPrincipal } from "../../../src/types";
import type { AgentDefinition, ModelTier } from "./policy";
import { resolveModel } from "./policy";
import { executeTool, openAiTools } from "./tools-v125";

type AiEnv = Record<string, unknown> & {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
};

type ChatMessage = { role: "user" | "assistant"; content: string };
type RunInput = {
  db: D1Database;
  env: AiEnv;
  principal: AuthPrincipal;
  agent: AgentDefinition;
  modelTier: ModelTier;
  requestedTools?: string[] | null;
  conversationId: string;
  messages: ChatMessage[];
};

type ResponseItem = {
  type?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type OpenAiResponse = {
  id?: string;
  output?: ResponseItem[];
  output_text?: string;
  usage?: unknown;
  error?: { message?: string };
};

function textFrom(response: OpenAiResponse) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const chunks: string[] = [];
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) if (part.type === "output_text" && part.text) chunks.push(part.text);
  }
  return chunks.join("\n").trim();
}

async function callOpenAI(env: AiEnv, body: Record<string, unknown>) {
  if (!env.OPENAI_API_KEY) {
    throw new AppError(503, "AI_NOT_CONFIGURED", "OpenAI is not configured. Set OPENAI_API_KEY on the Ledgerly server.");
  }
  const base = String(env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as OpenAiResponse;
  if (!response.ok) {
    throw new AppError(502, "AI_PROVIDER_ERROR", payload.error?.message || `OpenAI request failed (${response.status})`);
  }
  return payload;
}

export async function runAgent(input: RunInput) {
  const model = resolveModel(input.modelTier, input.env);
  const tools = openAiTools(input.agent, input.requestedTools);
  let response = await callOpenAI(input.env, {
    model,
    reasoning: { effort: input.modelTier === "sol" ? "high" : input.modelTier === "terra" ? "medium" : "low" },
    instructions: input.agent.systemPrompt,
    input: input.messages.map(message => ({ role: message.role, content: message.content })),
    tools,
    tool_choice: "auto",
    parallel_tool_calls: false,
  });
  const toolEvents: Array<Record<string, unknown>> = [];

  for (let round = 0; round < 5; round++) {
    const calls = (response.output || []).filter(item => item.type === "function_call" && item.name && item.call_id);
    if (!calls.length) {
      return {
        text: textFrom(response) || "I could not produce a response.",
        model,
        providerResponseId: response.id || null,
        usage: response.usage || null,
        toolEvents,
      };
    }

    const outputs: Array<Record<string, unknown>> = [];
    for (const call of calls) {
      const logId = createId("aat");
      let args: unknown = {};
      try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch { args = {}; }

      await input.db.prepare(`
        INSERT INTO ae_tool_calls
          (id, organization_id, conversation_id, agent_key, user_id, tool_name, arguments_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'running')
      `).bind(
        logId,
        input.principal.organizationId,
        input.conversationId,
        input.agent.key,
        input.principal.userId,
        call.name!,
        JSON.stringify(args),
      ).run();

      try {
        const result = await executeTool({
          db: input.db,
          env: input.env,
          principal: input.principal,
          agent: input.agent,
          conversationId: input.conversationId,
          requestedTools: input.requestedTools,
        }, call.name!, args);
        await input.db.prepare(`
          UPDATE ae_tool_calls SET status='succeeded', result_json=?, completed_at=CURRENT_TIMESTAMP
          WHERE id=? AND organization_id=?
        `).bind(JSON.stringify(result), logId, input.principal.organizationId).run();
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
        toolEvents.push({ id: logId, tool: call.name, status: "succeeded" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await input.db.prepare(`
          UPDATE ae_tool_calls SET status='failed', error_text=?, completed_at=CURRENT_TIMESTAMP
          WHERE id=? AND organization_id=?
        `).bind(message, logId, input.principal.organizationId).run();
        outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ error: message }) });
        toolEvents.push({ id: logId, tool: call.name, status: "failed", error: message });
      }
    }

    response = await callOpenAI(input.env, {
      model,
      previous_response_id: response.id,
      input: outputs,
      tools,
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
  }

  return {
    text: textFrom(response) || "The agent reached its tool-call limit. Please narrow the request.",
    model,
    providerResponseId: response.id || null,
    usage: response.usage || null,
    toolEvents,
  };
}

import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import type { AuthPrincipal, Env } from "../../../src/types";
import type { AgentDefinition, ModelTier } from "./policy";
import { executeTool, openAiTools } from "./memory-tools-v17";
import { memoryContext } from "./memory-service";
import { resolveRuntimeProvider } from "./provider-config";
import { runWorkersAiAdvisory } from "./workers-ai";

type AiEnv = Env & { AI_PROVIDER_ENCRYPTION_KEY?: string };
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
  workersAdvisory?: string;
};
type ToolSpec = { type: "function"; name: string; description?: string; parameters?: Record<string, unknown>; strict?: boolean };
type ResponseItem = { type?: string; name?: string; arguments?: string; call_id?: string; content?: Array<{ type?: string; text?: string }> };
type OpenAiResponse = { id?: string; output?: ResponseItem[]; output_text?: string; usage?: unknown; error?: { message?: string } };
type ChatCompletion = {
  id?: string;
  choices?: Array<{ message?: { role?: string; content?: string | null; tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> } }>;
  usage?: unknown;
  error?: { message?: string };
};
type AnthropicResponse = {
  id?: string;
  content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>;
  usage?: unknown;
  error?: { message?: string };
};

function textFromOpenAI(response: OpenAiResponse) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const chunks: string[] = [];
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) if (part.type === "output_text" && part.text) chunks.push(part.text);
  }
  return chunks.join("\n").trim();
}

function textFromAnthropic(response: AnthropicResponse) {
  return (response.content || []).filter(part => part.type === "text" && part.text).map(part => part.text).join("\n").trim();
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ payload: T; response: Response }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({})) as T;
    return { payload, response };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new AppError(504, "AI_PROVIDER_TIMEOUT", `AI provider request timed out after ${timeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function instructions(agent: AgentDefinition, memories: string, collaboration = "") {
  return `${agent.systemPrompt}\n\nMEMORY RULES:\nConversation memory is the message history provided with this run. Working memory contains active assignments, promises, follow-ups and unresolved matters. Institutional memory contains durable preferences, procedures, decisions and outcomes. Use saved memory as context, not as permission to bypass current Ledgerly records or authorization. When the user gives a durable instruction or future follow-up, save it with the appropriate memory tool. Mark working items done/cancelled when resolved.\n\n${memories}${collaboration ? `\n\nAI COLLABORATION CONTEXT:\n${collaboration}\n\nThe collaboration context is advisory evidence only. Verify it against Ledgerly records and the user's message. The primary provider remains the tool-calling orchestrator and must not claim a write happened unless Ledgerly confirms it.` : ""}`;
}

function defaultReasoning(tier: ModelTier) {
  return tier === "sol" ? "high" : tier === "terra" ? "medium" : "low";
}

function chatTools(tools: ToolSpec[]) {
  return tools.map(tool => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters || { type: "object", properties: {} } },
  }));
}

function anthropicTools(tools: ToolSpec[]) {
  return tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters || { type: "object", properties: {} } }));
}

async function logAndExecuteTool(input: RunInput, toolName: string, rawArguments: unknown) {
  const logId = createId("aat");
  const args = rawArguments && typeof rawArguments === "object" ? rawArguments : {};
  await input.db.prepare(`INSERT INTO ae_tool_calls
    (id,organization_id,conversation_id,agent_key,user_id,tool_name,arguments_json,status)
    VALUES (?,?,?,?,?,?,?,'running')`)
    .bind(logId, input.principal.organizationId, input.conversationId, input.agent.key, input.principal.userId, toolName, JSON.stringify(args)).run();
  try {
    const result = await executeTool({
      db: input.db,
      env: input.env,
      principal: input.principal,
      agent: input.agent,
      conversationId: input.conversationId,
      requestedTools: input.requestedTools,
    }, toolName, args);
    await input.db.prepare("UPDATE ae_tool_calls SET status='succeeded',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(JSON.stringify(result), logId, input.principal.organizationId).run();
    return { logId, result, event: { id: logId, tool: toolName, status: "succeeded" } as Record<string, unknown> };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.db.prepare("UPDATE ae_tool_calls SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(message, logId, input.principal.organizationId).run();
    return { logId, result: { error: message }, event: { id: logId, tool: toolName, status: "failed", error: message } as Record<string, unknown> };
  }
}

async function runOpenAI(input: RunInput, runtime: Awaited<ReturnType<typeof resolveRuntimeProvider>>, system: string, tools: ToolSpec[]) {
  const call = async (body: Record<string, unknown>) => {
    const request: Record<string, unknown> = { ...body, model: runtime.model, max_output_tokens: runtime.config.maxOutputTokens };
    const effort = runtime.config.reasoningEffort === "default" ? defaultReasoning(input.modelTier) : runtime.config.reasoningEffort;
    request.reasoning = { effort };
    if (runtime.config.temperature !== null) request.temperature = runtime.config.temperature;
    if (runtime.config.topP !== null) request.top_p = runtime.config.topP;
    const { payload, response } = await fetchJson<OpenAiResponse>(`${runtime.baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }, runtime.config.timeoutMs);
    if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload.error?.message || `OpenAI request failed (${response.status})`);
    return payload;
  };

  let response = await call({
    instructions: system,
    input: input.messages.map(message => ({ role: message.role, content: message.content })),
    tools,
    tool_choice: "auto",
    parallel_tool_calls: false,
  });
  const toolEvents: Array<Record<string, unknown>> = [];
  for (let round = 0; round < 6; round++) {
    const calls = (response.output || []).filter(item => item.type === "function_call" && item.name && item.call_id);
    if (!calls.length) return { text: textFromOpenAI(response) || "I could not produce a response.", model: runtime.model, provider: "openai", providerResponseId: response.id || null, usage: response.usage || null, toolEvents };
    const outputs: Array<Record<string, unknown>> = [];
    for (const toolCall of calls) {
      let args: unknown = {};
      try { args = toolCall.arguments ? JSON.parse(toolCall.arguments) : {}; } catch { args = {}; }
      const execution = await logAndExecuteTool(input, toolCall.name!, args);
      outputs.push({ type: "function_call_output", call_id: toolCall.call_id, output: JSON.stringify(execution.result) });
      toolEvents.push(execution.event);
    }
    response = await call({ previous_response_id: response.id, input: outputs, tools, tool_choice: "auto", parallel_tool_calls: false });
  }
  return { text: textFromOpenAI(response) || "The agent reached its tool-call limit. Please narrow the request.", model: runtime.model, provider: "openai", providerResponseId: response.id || null, usage: response.usage || null, toolEvents };
}

async function runGoogle(input: RunInput, runtime: Awaited<ReturnType<typeof resolveRuntimeProvider>>, system: string, tools: ToolSpec[]) {
  const messages: any[] = [{ role: "system", content: system }, ...input.messages.map(message => ({ role: message.role, content: message.content }))];
  const toolEvents: Array<Record<string, unknown>> = [];
  let last: ChatCompletion = {};
  for (let round = 0; round < 7; round++) {
    const body: Record<string, unknown> = { model: runtime.model, messages, max_tokens: runtime.config.maxOutputTokens };
    if (tools.length) { body.tools = chatTools(tools); body.tool_choice = "auto"; }
    if (runtime.config.temperature !== null) body.temperature = runtime.config.temperature;
    if (runtime.config.topP !== null) body.top_p = runtime.config.topP;
    const { payload, response } = await fetchJson<ChatCompletion>(`${runtime.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, runtime.config.timeoutMs);
    if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload.error?.message || `Google Gemini request failed (${response.status})`);
    last = payload;
    const message = payload.choices?.[0]?.message;
    if (!message) throw new AppError(502, "AI_PROVIDER_ERROR", "Google Gemini returned no assistant message.");
    const calls = message.tool_calls || [];
    if (!calls.length) return { text: message.content?.trim() || "I could not produce a response.", model: runtime.model, provider: "google", providerResponseId: payload.id || null, usage: payload.usage || null, toolEvents };
    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
    for (const toolCall of calls) {
      const name = toolCall.function?.name;
      if (!name) continue;
      let args: unknown = {};
      try { args = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {}; } catch { args = {}; }
      const execution = await logAndExecuteTool(input, name, args);
      toolEvents.push(execution.event);
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(execution.result) });
    }
  }
  return { text: last.choices?.[0]?.message?.content?.trim() || "The agent reached its tool-call limit. Please narrow the request.", model: runtime.model, provider: "google", providerResponseId: last.id || null, usage: last.usage || null, toolEvents };
}

async function runAnthropic(input: RunInput, runtime: Awaited<ReturnType<typeof resolveRuntimeProvider>>, system: string, tools: ToolSpec[]) {
  const messages: any[] = input.messages.map(message => ({ role: message.role, content: message.content }));
  const toolEvents: Array<Record<string, unknown>> = [];
  let last: AnthropicResponse = {};
  for (let round = 0; round < 7; round++) {
    const body: Record<string, unknown> = { model: runtime.model, system, messages, max_tokens: runtime.config.maxOutputTokens };
    if (tools.length) body.tools = anthropicTools(tools);
    if (runtime.config.temperature !== null) body.temperature = runtime.config.temperature;
    else if (runtime.config.topP !== null) body.top_p = runtime.config.topP;
    const { payload, response } = await fetchJson<AnthropicResponse>(`${runtime.baseUrl}/messages`, {
      method: "POST",
      headers: { "x-api-key": runtime.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, runtime.config.timeoutMs);
    if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload.error?.message || `Anthropic Claude request failed (${response.status})`);
    last = payload;
    const calls = (payload.content || []).filter(part => part.type === "tool_use" && part.id && part.name);
    if (!calls.length) return { text: textFromAnthropic(payload) || "I could not produce a response.", model: runtime.model, provider: "anthropic", providerResponseId: payload.id || null, usage: payload.usage || null, toolEvents };
    messages.push({ role: "assistant", content: payload.content || [] });
    const results: any[] = [];
    for (const toolCall of calls) {
      const execution = await logAndExecuteTool(input, toolCall.name!, toolCall.input || {});
      toolEvents.push(execution.event);
      results.push({ type: "tool_result", tool_use_id: toolCall.id, content: JSON.stringify(execution.result) });
    }
    messages.push({ role: "user", content: results });
  }
  return { text: textFromAnthropic(last) || "The agent reached its tool-call limit. Please narrow the request.", model: runtime.model, provider: "anthropic", providerResponseId: last.id || null, usage: last.usage || null, toolEvents };
}

export async function testProviderConnection(db: D1Database, env: AiEnv, organizationId: string, tier: ModelTier = "luna") {
  const runtime = await resolveRuntimeProvider(db, env, organizationId, tier);
  const started = Date.now();
  if (runtime.provider === "openai") {
    const { payload, response } = await fetchJson<OpenAiResponse>(`${runtime.baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: runtime.model, input: "Reply with OK only.", max_output_tokens: 32 }),
    }, Math.min(runtime.config.timeoutMs, 30000));
    if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload.error?.message || `OpenAI request failed (${response.status})`);
  } else if (runtime.provider === "google") {
    const { payload, response } = await fetchJson<ChatCompletion>(`${runtime.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: runtime.model, messages: [{ role: "user", content: "Reply with OK only." }], max_tokens: 32 }),
    }, Math.min(runtime.config.timeoutMs, 30000));
    if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload.error?.message || `Google Gemini request failed (${response.status})`);
  } else {
    const { payload, response } = await fetchJson<AnthropicResponse>(`${runtime.baseUrl}/messages`, {
      method: "POST",
      headers: { "x-api-key": runtime.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: runtime.model, max_tokens: 32, messages: [{ role: "user", content: "Reply with OK only." }] }),
    }, Math.min(runtime.config.timeoutMs, 30000));
    if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload.error?.message || `Anthropic Claude request failed (${response.status})`);
  }
  return { ok: true, provider: runtime.provider, model: runtime.model, latencyMs: Date.now() - started };
}

export async function runAgent(input: RunInput) {
  const runtime = await resolveRuntimeProvider(input.db, input.env, input.principal.organizationId, input.modelTier);
  const tools = openAiTools(input.agent, input.requestedTools) as ToolSpec[];
  const memories = await memoryContext(input.db, input.principal.organizationId, input.agent.key);
  const recentContext = input.messages.slice(-8).map(message => `${message.role}: ${message.content}`).join("\n");
  const lastUser = [...input.messages].reverse().find(message => message.role === "user")?.content || "";
  const workersAi = input.workersAdvisory !== undefined
    ? { configured: true, ok: true, text: input.workersAdvisory, model: "precomputed-multimodal", visionUsed: true, error: null }
    : await runWorkersAiAdvisory({
        db: input.db,
        env: input.env,
        organizationId: input.principal.organizationId,
        agentName: input.agent.name,
        agentTitle: input.agent.title,
        userText: lastUser,
        recentContext,
      });
  const collaboration = input.workersAdvisory !== undefined
    ? input.workersAdvisory
    : workersAi.ok && workersAi.text
      ? `WORKERS AI SECONDARY ADVISORY (${workersAi.model}):\n${workersAi.text}`
      : "";
  const system = instructions(input.agent, memories, collaboration);
  const result = runtime.provider === "google"
    ? await runGoogle(input, runtime, system, tools)
    : runtime.provider === "anthropic"
      ? await runAnthropic(input, runtime, system, tools)
      : await runOpenAI(input, runtime, system, tools);
  return { ...result, workersAi };
}

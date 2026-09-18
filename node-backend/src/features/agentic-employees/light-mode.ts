import { AppError, createId } from "./shared.js";
import type { AuthPrincipal, Env } from "./shared.js";
import type { AgentDefinition } from "./policy.js";
import { resolveRuntimeProvider } from "./provider-config.js";
import { executeTool } from "./memory-tools-v17.js";
import { lookupSystemSchema } from "./system-schemas.js";
import {
  buildLightToolRegistry,
  toolsForGroups,
  toolsForKind,
  toolsForModules,
  type LightTaskKind,
  type LightToolDescriptor,
} from "./light-tool-registry.js";
import { resolveLightReferences } from "./light-reference-resolver.js";
import { analysisKnowledgeSummary, getAnalysisTopic, suggestAnalysisTopics, type AnalysisMode } from "./analysis-knowledge.js";
import { identifyAnalysisEntity, type AnalysisEntityOption } from "./analysis-entity-resolver.js";
import { buildResponseLanguageBrief,buildResponseRealizationPrompt,cleanHumanResponse,composeFallbackHumanResponse,responseFingerprint,templateRisk } from "./response-intelligence/engine.js";

type ChatMessage = { role: "user" | "assistant"; content: string };
type LightInput = {
  db: D1Database;
  env: Env;
  principal: AuthPrincipal;
  agent: AgentDefinition;
  conversationId: string;
  messages: ChatMessage[];
};
type Runtime = Awaited<ReturnType<typeof resolveRuntimeProvider>>;
type RouteArguments = {
  pathParams?: Record<string, string | number>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  title?: string;
  summary?: string;
};
type ToolExecution = { tool: LightToolDescriptor; result: any };
type UsageRecord = { stage: string; usage: unknown };
type UsageSummary = {
  calls: UsageRecord[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

const KINDS: LightTaskKind[] = ["query", "report", "create", "update", "delete", "action", "communication", "document", "analysis"];

function latestUser(input: LightInput) {
  return [...input.messages].reverse().find(message => message.role === "user")?.content.trim() || "";
}
function stripFence(value: string) {
  const text = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}
function parseObject<T extends Record<string, unknown>>(value: string, fallback: T): T {
  try {
    const parsed = JSON.parse(stripFence(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as T : fallback;
  } catch { return fallback; }
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({})) as T;
    return { response, payload };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new AppError(504, "AI_PROVIDER_TIMEOUT", "Light AI request timed out");
    throw error;
  } finally { clearTimeout(timer); }
}
function responseText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const chunks: string[] = [];
  for (const item of payload?.output || []) if (item?.type === "message") for (const part of item.content || []) if (part?.type === "output_text" && part.text) chunks.push(part.text);
  return chunks.join("\n").trim();
}
async function cheapText(runtime: Runtime, prompt: string, maxTokens = 400) {
  const timeout = Math.min(runtime.config.timeoutMs, 45_000);
  const system = "You are Ledgerly Light AI. Be concise, follow the requested output format exactly, and never invent school data or IDs.";
  if (runtime.apiStyle === "responses") {
    const { response, payload } = await fetchJson<any>(`${runtime.baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: runtime.model, instructions: system, input: prompt, max_output_tokens: maxTokens }),
    }, timeout);
    if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload?.error?.message || `AI request failed (${response.status})`);
    return { text: responseText(payload), id: payload?.id || null, usage: payload?.usage || null };
  }
  if (runtime.apiStyle === "anthropic") {
    const { response, payload } = await fetchJson<any>(`${runtime.baseUrl}/messages`, {
      method: "POST",
      headers: { "x-api-key": runtime.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: runtime.model, system, messages: [{ role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0 }),
    }, timeout);
    if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload?.error?.message || `AI request failed (${response.status})`);
    const text = (payload?.content || []).filter((part: any) => part?.type === "text" && part.text).map((part: any) => part.text).join("\n").trim();
    return { text, id: payload?.id || null, usage: payload?.usage || null };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;
  const { response, payload } = await fetchJson<any>(`${runtime.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: runtime.model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], max_tokens: maxTokens, temperature: 0 }),
  }, timeout);
  if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload?.error?.message || `AI request failed (${response.status})`);
  return { text: String(payload?.choices?.[0]?.message?.content || "").trim(), id: payload?.id || null, usage: payload?.usage || null };
}
function emptyUsage(): UsageSummary { return { calls: [], inputTokens: 0, outputTokens: 0, totalTokens: 0 }; }
function addUsage(summary: UsageSummary, stageName: string, usage: any) {
  if (!usage) return;
  summary.calls.push({ stage: stageName, usage });
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? 0) || 0;
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? 0) || 0;
  const total = Number(usage.total_tokens ?? usage.totalTokens ?? input + output) || input + output;
  summary.inputTokens += input;
  summary.outputTokens += output;
  summary.totalTokens += total;
}
async function cheapJson<T extends Record<string, unknown>>(runtime: Runtime, prompt: string, fallback: T, maxTokens = 300) {
  const result = await cheapText(runtime, `${prompt}\n\nReturn JSON only. No markdown.`, maxTokens);
  return { value: parseObject(result.text, fallback), id: result.id, usage: result.usage };
}

async function stage<T>(input: LightInput, name: string, work: () => Promise<T>) {
  const id = createId("aat");
  await input.db.prepare(`INSERT INTO ae_tool_calls(id,organization_id,conversation_id,agent_key,user_id,tool_name,arguments_json,status) VALUES(?,?,?,?,?,?,?,'running')`)
    .bind(id, input.principal.organizationId, input.conversationId, input.agent.key, input.principal.userId, name, "{}").run();
  try {
    const result = await work();
    await input.db.prepare("UPDATE ae_tool_calls SET status='succeeded',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(JSON.stringify(result).slice(0, 16_000), id, input.principal.organizationId).run();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.db.prepare("UPDATE ae_tool_calls SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(message, id, input.principal.organizationId).run();
    throw error;
  }
}
async function aiJson<T extends Record<string, unknown>>(input: LightInput, runtime: Runtime, usage: UsageSummary, stageName: string, prompt: string, fallback: T, maxTokens: number) {
  return stage(input, stageName, async () => {
    const result = await cheapJson(runtime, prompt, fallback, maxTokens);
    addUsage(usage, stageName, result.usage);
    return result.value;
  });
}
async function aiText(input: LightInput, runtime: Runtime, usage: UsageSummary, stageName: string, prompt: string, maxTokens: number) {
  return stage(input, stageName, async () => {
    const result = await cheapText(runtime, prompt, maxTokens);
    addUsage(usage, stageName, result.usage);
    return result;
  });
}

function words(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean); }
function lexicalScore(query: string, tool: LightToolDescriptor) {
  const queryWords = new Set(words(query));
  let score = 0;
  for (const token of words(`${tool.name} ${tool.description} ${tool.aliases.join(" ")} ${tool.module} ${tool.group}`)) if (queryWords.has(token)) score += token.length > 4 ? 3 : 1;
  return score;
}
function ranked(query: string, tools: LightToolDescriptor[]) {
  return tools.map(tool => ({ tool, score: lexicalScore(query, tool) })).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
}
function shortlist(query: string, tools: LightToolDescriptor[], limit = 32) { return ranked(query, tools).slice(0, limit).map(item => item.tool); }
function inferKinds(prompt: string): LightTaskKind[] {
  const value = prompt.toLowerCase(), result: LightTaskKind[] = [];
  if (/\b(create|add|register|new|make)\b/.test(value)) result.push("create");
  if (/\b(update|edit|change|rename|modify|move)\b/.test(value)) result.push("update");
  if (/\b(delete|remove)\b/.test(value)) result.push("delete");
  if (/\b(report|statement|summary|analytics)\b/.test(value)) result.push("report");
  if (/\b(pdf|excel|xlsx|spreadsheet|workbook|presentation|powerpoint|pptx|word|docx|print)\b/.test(value)) result.push("document");
  if (/\b(send|message|sms|whatsapp|notify)\b/.test(value)) result.push("communication");
  if (/\b(analy[sz]e|compare|trend|why|relationship)\b/.test(value)) result.push("analysis");
  if (!result.length || /\b(check|show|find|get|list|what|who|balance)\b/.test(value)) result.unshift("query");
  return [...new Set(result)];
}
function validSelections(value: unknown, allowed: readonly string[], max = 6) {
  const set = new Set(allowed), raw = Array.isArray(value) ? value.map(String) : [];
  return [...new Set(raw.filter(item => set.has(item)))].slice(0, max);
}
function requestedFormat(prompt: string): "pdf" | "docx" | "xlsx" | "pptx" | null {
  const value = prompt.toLowerCase();
  if (/\bpdf\b/.test(value)) return "pdf";
  if (/\b(excel|xlsx|spreadsheet|workbook)\b/.test(value)) return "xlsx";
  if (/\b(powerpoint|pptx|presentation|slides?)\b/.test(value)) return "pptx";
  if (/\b(word|docx)\b/.test(value)) return "docx";
  return null;
}
function documentNeedsData(prompt: string) { return /\b(report|statement|summary|balance|arrears|attendance|student|learner|staff|teacher|fees?|finance|academic|inventory|stock|payroll|class|collection|performance|budget|bank|journal)\b/i.test(prompt); }
function formatTools(tools: LightToolDescriptor[]) {
  return tools.map(tool => ({ name: tool.name, kind: tool.kind, module: tool.module, group: tool.group, source: tool.source, description: tool.description.slice(0, 220), aliases: tool.aliases.slice(0, 5) }));
}
function chooseModulesLexically(prompt: string, tools: LightToolDescriptor[]) {
  const scores = [...new Set(tools.map(tool => tool.module))].map(module => ({
    module,
    score: Math.max(0, ...tools.filter(tool => tool.module === module).map(tool => lexicalScore(prompt, tool))),
  })).sort((a, b) => b.score - a.score || a.module.localeCompare(b.module));
  const first = scores[0], second = scores[1];
  return first && first.score >= 5 && (!second || first.score >= second.score + 2) ? [first.module] : [];
}
function chooseGroupsLexically(prompt: string, tools: LightToolDescriptor[]) {
  const scores = [...new Set(tools.map(tool => tool.group))].map(group => ({
    group,
    score: Math.max(0, ...tools.filter(tool => tool.group === group).map(tool => lexicalScore(prompt, tool))),
  })).sort((a, b) => b.score - a.score || a.group.localeCompare(b.group));
  const first = scores[0], second = scores[1];
  return first && first.score >= 5 && (!second || first.score >= second.score + 2) ? [first.group] : [];
}

function genericReferenceKey(pathTemplate: string, param: string) {
  if (param !== "id") return param;
  const parts = pathTemplate.split("/").filter(Boolean), index = parts.indexOf(`:${param}`), resource = (index > 0 ? parts[index - 1] : "")?.toLowerCase();
  const map: Record<string, string> = { students: "studentId", guardians: "guardianId", classes: "classId", classlevels: "classLevelId", streams: "streamId", subjects: "subjectId", terms: "termId", academicyears: "academicYearId", departments: "departmentId", positions: "positionId", staff: "staffId", employees: "staffId", accounts: "accountId", contacts: "contactId", products: "productId" };
  return map[resource || ""] || param;
}
async function resolvePathParams(input: LightInput, tool: LightToolDescriptor, params: Record<string, string | number>) {
  const value: Record<string, string | number> = {}, issues: string[] = [];
  for (const [key, raw] of Object.entries(params)) {
    if (typeof raw !== "string") { value[key] = raw; continue; }
    const referenceKey = genericReferenceKey(tool.pathTemplate || "", key);
    const resolved = await resolveLightReferences(input.db, input.principal.organizationId, { [referenceKey]: raw });
    const candidate = (resolved.value as Record<string, unknown>)[referenceKey];
    value[key] = typeof candidate === "string" || typeof candidate === "number" ? candidate : raw;
    issues.push(...resolved.issues);
  }
  return { value, issues };
}
function fillPath(template: string, params: Record<string, string | number>) {
  const missing: string[] = [];
  const path = template.replace(/:([A-Za-z0-9_]+)/g, (_all, key) => {
    const value = params[key];
    if (value === undefined || value === null || String(value).trim() === "") { missing.push(key); return `:${key}`; }
    return encodeURIComponent(String(value));
  });
  return { path, missing };
}
function queryObject(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === null || typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") result[key] = raw;
    else if (Array.isArray(raw)) result[key] = raw.map(item => String(item)).join(",");
  }
  return result;
}
function appendQuery(path: string, query: Record<string, string | number | boolean | null>) {
  const entries = Object.entries(query).filter(([, value]) => value !== null && value !== undefined && String(value) !== "");
  if (!entries.length) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}`;
}
function scopeFor(path: string) {
  const p = path.toLowerCase();
  if (p.includes("/accounts")) return "accounts:write";
  if (p.includes("/journals")) return "journals:write";
  if (p.includes("/contacts")) return "contacts:write";
  if (p.includes("/documents") || p.includes("/files")) return "documents:write";
  if (p.includes("/payments") || p.includes("/banking")) return "payments:write";
  if (p.includes("/payroll")) return "payroll:write";
  if (p.includes("/communications")) return "communications:write";
  if (p.includes("/inventory") || p.includes("/products")) return "products:write";
  return "school:write";
}
function hashText(value: string) { let h = 2166136261; for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
function codeFromName(value: string, fallback: string) { return value.replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, 40) || fallback; }
function commonDefaults(tool: LightToolDescriptor, body: Record<string, unknown>) {
  const path = tool.pathTemplate || "", method = tool.method;
  if (method === "POST" && path === "/api/v1/school/setup/classes") {
    if (typeof body.name === "string" && !body.code) body.code = codeFromName(body.name, "CLASS");
    if (typeof body.name === "string" && !body.classLevelId) body.classLevelId = body.name;
  }
  if (method === "POST" && path === "/api/v1/school/setup/classLevels") {
    if (typeof body.name === "string" && !body.code) body.code = codeFromName(body.name, "LEVEL");
    if (typeof body.name === "string" && body.sequenceNo === undefined) { const match = body.name.match(/(\d{1,3})/); if (match) body.sequenceNo = Number(match[1]); }
  }
  if (method === "POST" && path === "/api/v1/school/setup/streams" && typeof body.name === "string" && !body.code) body.code = codeFromName(body.name, "STREAM");
  if (method === "POST" && path === "/api/v1/school/setup/subjects" && typeof body.name === "string" && !body.code) body.code = codeFromName(body.name, "SUBJECT");
  if (method === "POST" && path === "/api/v1/school/setup/terms" && typeof body.name === "string" && body.sequenceNo === undefined) { const match = body.name.match(/(\d{1,2})/); if (match) body.sequenceNo = Number(match[1]); }
  if (method === "POST" && path === "/api/v1/school/student-management/students" && !body.admissionDate) body.admissionDate = new Date().toISOString().slice(0, 10);
  if (method === "POST" && path === "/api/v1/school/staff-management/staff" && !body.hireDate) body.hireDate = new Date().toISOString().slice(0, 10);
  return body;
}
function schemaHint(tool: LightToolDescriptor) {
  const schema = tool.pathTemplate ? lookupSystemSchema(tool.pathTemplate) : null;
  return schema ? `Validated request fields: ${JSON.stringify(schema.fields)}` : "No curated body schema is available. Use only fields clearly stated by the user and never invent IDs.";
}
function validateCuratedSchema(tool: LightToolDescriptor, body: Record<string, unknown>) {
  const schema = tool.pathTemplate ? lookupSystemSchema(tool.pathTemplate) : null;
  if (!schema || schema.method !== (tool.method || "")) return [] as string[];
  const issues: string[] = [];
  for (const field of schema.fields) {
    const value = body[field.name];
    if (field.required && (value === undefined || value === null || String(value).trim() === "")) issues.push(`${field.name} is required`);
    if (field.enum?.length && value !== undefined && value !== null && !field.enum.includes(String(value))) issues.push(`${field.name} must be one of: ${field.enum.join(", ")}`);
  }
  return issues;
}
async function prepareRouteAction(input: LightInput, tool: LightToolDescriptor, path: string, body: unknown, title: string, summary: string) {
  const method = tool.method || "POST", payload = { agentKey: input.agent.key, method, path, body }, key = `conversation:${input.conversationId}:light:${method}:${path}:${hashText(JSON.stringify(body))}`, id = createId("aea");
  await input.db.prepare(`INSERT INTO ae_actions(id,organization_id,agent_key,action_type,title,summary,required_scope,payload_json,idempotency_key,status) VALUES(?,?,?,?,?,?,?,?,?,'suggested') ON CONFLICT(organization_id,idempotency_key) DO NOTHING`)
    .bind(id, input.principal.organizationId, input.agent.key, "system.api.request", title.slice(0, 240), summary.slice(0, 600), scopeFor(path), JSON.stringify(payload), key).run();
  const action = await input.db.prepare("SELECT id,status,title,action_type AS actionType,required_scope AS requiredScope FROM ae_actions WHERE organization_id=? AND idempotency_key=?")
    .bind(input.principal.organizationId, key).first();
  return { prepared: true, executed: false, requiresHumanApproval: true, approvalSurface: "chat", action };
}

function priorContext(prior: ToolExecution[]) {
  if (!prior.length) return "No prior tool results.";
  return `Prior verified results from earlier tools in this same request: ${JSON.stringify(prior.map(item => ({ tool: item.tool.name, result: item.result }))).slice(0, 10_000)}`;
}
async function extractNativeArguments(runtime: Runtime, tool: LightToolDescriptor, prompt: string, prior: ToolExecution[], usage: UsageSummary) {
  const result = await cheapJson<Record<string, unknown>>(runtime, `Extract the exact argument object for Ledgerly tool ${tool.name}.\nDescription: ${tool.description}\nSchema: ${JSON.stringify(tool.parameters || {}).slice(0, 7000)}\n${priorContext(prior)}\nUser request: ${prompt}\nUse canonical IDs from prior verified results when a tool requires them. Never invent an ID.`, {}, 600);
  addUsage(usage, `extract:${tool.name}`, result.usage);
  return result.value;
}
async function extractRouteArguments(runtime: Runtime, tool: LightToolDescriptor, prompt: string, prior: ToolExecution[], usage: UsageSummary) {
  const result = await cheapJson<RouteArguments>(runtime, `Extract arguments for exactly ${tool.method} ${tool.pathTemplate}.\n${schemaHint(tool)}\n${priorContext(prior)}\nUser request: ${prompt}\nReturn {"pathParams":{},"query":{},"body":{},"title":"short approval title","summary":"what will happen"}. Omit unknown fields. Human names may be placed in corresponding *Id fields because Ledgerly resolves them deterministically. Use canonical IDs from prior verified results when available.`, {}, 700);
  addUsage(usage, `extract:${tool.name}`, result.usage);
  return result.value;
}
async function executeSelected(input: LightInput, runtime: Runtime, tool: LightToolDescriptor, prompt: string, prior: ToolExecution[], events: Array<Record<string, unknown>>, usage: UsageSummary): Promise<ToolExecution> {
  const extracted = await stage(input, `light_extract_${tool.module.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`, () => tool.source === "native" ? extractNativeArguments(runtime, tool, prompt, prior, usage) : extractRouteArguments(runtime, tool, prompt, prior, usage));
  const logId = createId("aat");
  await input.db.prepare(`INSERT INTO ae_tool_calls(id,organization_id,conversation_id,agent_key,user_id,tool_name,arguments_json,status) VALUES(?,?,?,?,?,?,?,'running')`)
    .bind(logId, input.principal.organizationId, input.conversationId, input.agent.key, input.principal.userId, tool.name, JSON.stringify(extracted)).run();
  try {
    let result: any;
    if (tool.source === "native") {
      const resolved = await resolveLightReferences(input.db, input.principal.organizationId, extracted);
      if (resolved.issues.length) result = { needsClarification: true, issues: resolved.issues };
      else result = await executeTool({ db: input.db, env: input.env, principal: input.principal, agent: input.agent, conversationId: input.conversationId, requestedTools: null }, tool.nativeName || tool.name, resolved.value);
    } else {
      if (!input.env.AGENT_SYSTEM_GATEWAY) throw new Error("Light Mode requires the delegated Ledgerly gateway");
      const args = extracted as RouteArguments;
      const pathResolution = await resolvePathParams(input, tool, args.pathParams || {});
      if (pathResolution.issues.length) result = { needsClarification: true, issues: pathResolution.issues };
      else {
        const filled = fillPath(tool.pathTemplate || "", pathResolution.value);
        if (filled.missing.length) result = { needsClarification: true, issues: [`The request needs ${filled.missing.join(", ")} before it can run.`] };
        else {
          const resolvedQuery = await resolveLightReferences(input.db, input.principal.organizationId, args.query || {});
          if (resolvedQuery.issues.length) result = { needsClarification: true, issues: resolvedQuery.issues };
          else {
            const path = appendQuery(filled.path, queryObject(resolvedQuery.value));
            const body = commonDefaults(tool, { ...(args.body || {}) });
            const resolvedBody = await resolveLightReferences(input.db, input.principal.organizationId, body);
            const schemaIssues = validateCuratedSchema(tool, resolvedBody.value as Record<string, unknown>);
            if (resolvedBody.issues.length) result = { needsClarification: true, issues: resolvedBody.issues };
            else if (schemaIssues.length) result = { needsClarification: true, issues: schemaIssues };
            else if (tool.readOnly) {
              const response = await input.env.AGENT_SYSTEM_GATEWAY.request({ agentKey: input.agent.key, principal: input.principal, method: tool.method || "GET", path, body: tool.method === "GET" ? undefined : resolvedBody.value });
              if (!response.ok) throw new Error(`Ledgerly API ${response.status}: ${JSON.stringify(response.data).slice(0, 1800)}`);
              result = response.data;
            } else result = await prepareRouteAction(input, tool, path, resolvedBody.value, args.title || tool.name.replace(/_/g, " "), args.summary || `Prepared from: ${prompt}`);
          }
        }
      }
    }
    await input.db.prepare("UPDATE ae_tool_calls SET status='succeeded',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(JSON.stringify(result).slice(0, 20_000), logId, input.principal.organizationId).run();
    events.push({ id: logId, tool: tool.name, status: "succeeded" });
    return { tool, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.db.prepare("UPDATE ae_tool_calls SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(message, logId, input.principal.organizationId).run();
    events.push({ id: logId, tool: tool.name, status: "failed", error: message });
    return { tool, result: { error: message } };
  }
}
function titleFromPrompt(prompt: string) {
  const clean = prompt.replace(/^(please\s+)?(create|prepare|generate|give me|make)\s+(me\s+)?/i, "").replace(/\s+(as|in)\s+(a\s+)?(pdf|excel|xlsx|spreadsheet|powerpoint|pptx|presentation|word|docx)\b.*$/i, "").trim();
  const title = (clean || "Ledgerly Report").slice(0, 120);
  return title.replace(/\b\w/g, letter => letter.toUpperCase());
}
async function prepareDocumentFromResults(input: LightInput, runtime: Runtime, prompt: string, format: "pdf" | "docx" | "xlsx" | "pptx", results: unknown[], events: Array<Record<string, unknown>>, usage: UsageSummary) {
  const specResult = await aiJson<Record<string, unknown>>(input, runtime, usage, "light_build_document", `Build a professional ${format.toUpperCase()} specification using ONLY these verified Ledgerly results. Never invent a figure.\nUser request: ${prompt}\nVerified results: ${JSON.stringify(results).slice(0, 22_000)}\nReturn a JSON report structure using subtitle, summary, dataAsOf, sources, sections, tables, charts, sheets and slides where useful. Tables carry exact figures. Charts only use verified numeric comparisons. Default to white background and black/dark text.`, {}, 1600);
  const args = { title: titleFromPrompt(prompt), format, contentJson: JSON.stringify(specResult) }, logId = createId("aat");
  await input.db.prepare(`INSERT INTO ae_tool_calls(id,organization_id,conversation_id,agent_key,user_id,tool_name,arguments_json,status) VALUES(?,?,?,?,?,?,?,'running')`)
    .bind(logId, input.principal.organizationId, input.conversationId, input.agent.key, input.principal.userId, "prepare_document", JSON.stringify({ title: args.title, format })).run();
  try {
    const result = await executeTool({ db: input.db, env: input.env, principal: input.principal, agent: input.agent, conversationId: input.conversationId, requestedTools: null }, "prepare_document", args);
    await input.db.prepare("UPDATE ae_tool_calls SET status='succeeded',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(JSON.stringify(result), logId, input.principal.organizationId).run();
    events.push({ id: logId, tool: "prepare_document", status: "succeeded" });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await input.db.prepare("UPDATE ae_tool_calls SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?")
      .bind(message, logId, input.principal.organizationId).run();
    events.push({ id: logId, tool: "prepare_document", status: "failed", error: message });
    throw error;
  }
}

export async function runLightAgent(input: LightInput) {
  const prompt = latestUser(input);
  if (!prompt) throw new AppError(422, "VALIDATION_ERROR", "A user message is required");
  const runtime = await resolveRuntimeProvider(input.db, input.env, input.principal.organizationId, "luna");
  const usage = emptyUsage();
  const registry = await stage(input, "light_build_registry", () => buildLightToolRegistry(input.env, input.principal, input.agent));
  let kinds = await stage(input, "light_route_type", async () => inferKinds(prompt));
  const format = requestedFormat(prompt);
  if (kinds.includes("analysis")) kinds = [...new Set<LightTaskKind>([...kinds, "query", "report"])];
  else if (kinds.includes("report") || kinds.includes("communication") || (format && documentNeedsData(prompt))) kinds = [...new Set<LightTaskKind>([...kinds, "query"])];

  let pool = toolsForKind(registry, kinds);
  if (!pool.length) pool = registry.tools;
  const globalSafety = shortlist(prompt, pool, 10);
  const availableModules = [...new Set(pool.map(tool => tool.module))].sort();
  let modules = chooseModulesLexically(prompt, pool);
  if (!modules.length && availableModules.length > 1) {
    const routed = await aiJson<{ modules?: unknown }>(input, runtime, usage, "light_route_module", `Choose the Ledgerly modules needed for this request.\nRequest: ${prompt}\nAvailable modules: ${availableModules.join(", ")}\nReturn {"modules":[...]}, maximum 5.`, { modules: [] }, 240);
    modules = validSelections(routed.modules, availableModules, 5);
  }
  if (!modules.length) modules = availableModules.slice(0, 1);
  let candidates = toolsForModules(pool, modules);
  if (!candidates.length) candidates = toolsForModules(registry.tools, modules);

  if (candidates.length > 45) {
    const availableGroups = [...new Set(candidates.map(tool => tool.group))].sort();
    let groups = chooseGroupsLexically(prompt, candidates);
    if (!groups.length && availableGroups.length > 1) {
      const routed = await aiJson<{ groups?: unknown }>(input, runtime, usage, "light_route_group", `Choose the relevant Ledgerly subgroups.\nRequest: ${prompt}\nAvailable groups: ${availableGroups.join(", ")}\nReturn {"groups":[...]}, maximum 5.`, { groups: [] }, 220);
      groups = validSelections(routed.groups, availableGroups, 5);
    }
    const grouped = toolsForGroups(candidates, groups);
    if (grouped.length) candidates = grouped;
  }

  candidates = shortlist(prompt, [...new Map([...candidates, ...globalSafety].map(tool => [tool.name, tool])).values()], 32);
  if (format && documentNeedsData(prompt)) {
    const dataCandidates = candidates.filter(tool => !(tool.source === "native" && ["prepare_document", "prepare_print_document", "list_saved_documents"].includes(tool.name)));
    if (dataCandidates.length) candidates = dataCandidates;
  }
  if (!candidates.length) throw new AppError(409, "LIGHT_TOOL_NOT_FOUND", "No permitted Light Mode capability matched this request");

  let selected: LightToolDescriptor[];
  if (candidates.length === 1) selected = candidates;
  else {
    const routed = await aiJson<{ tools?: unknown }>(input, runtime, usage, "light_route_tool", `Choose the fewest exact Ledgerly tools needed to fully complete this request.\nRequest: ${prompt}\nCandidates: ${JSON.stringify(formatTools(candidates))}\nWrites prepare editable approval cards and never execute directly. Return tools in execution order: put lookup/resolution/read tools before tools that need their IDs or results. Return {"tools":["exact_name",...]}, maximum 6.`, { tools: [] }, 700);
    const names = validSelections(routed.tools, candidates.map(tool => tool.name), 6);
    selected = (names.length ? names : [candidates[0]!.name]).map(name => candidates.find(tool => tool.name === name)!).filter(Boolean);
  }

  const events: Array<Record<string, unknown>> = [], executed: ToolExecution[] = [];
  for (const tool of selected) {
    const item = await executeSelected(input, runtime, tool, prompt, executed, events, usage);
    executed.push(item);
    if (item.result?.needsClarification) break;
  }
  const results = executed.map(item => ({ tool: item.tool.name, module: item.tool.module, kind: item.tool.kind, result: item.result }));
  const issues = results.flatMap(item => item.result?.needsClarification && Array.isArray(item.result.issues) ? item.result.issues.map(String) : []);
  const routing = { mode: "light", kinds, modules, selected: selected.map(tool => tool.name), registry: registry.stats };
  if (issues.length) return { text: `I need one detail before I can safely continue: ${[...new Set(issues)].join(" ")}`, model: runtime.model, provider: runtime.provider, providerResponseId: null, usage, toolEvents: events, routing };

  const alreadyPreparedDocument = results.some(item => item.tool === "prepare_document" && item.result?.prepared);
  if (format && !alreadyPreparedDocument) {
    await prepareDocumentFromResults(input, runtime, prompt, format, results, events, usage);
    return { text: `I prepared the ${format.toUpperCase()} output from verified Ledgerly data. Review or edit the document approval below, then approve it to generate the file.`, model: runtime.model, provider: runtime.provider, providerResponseId: null, usage, toolEvents: events, routing };
  }
  const prepared = results.filter(item => item.result?.prepared && item.result?.requiresHumanApproval);
  if (prepared.length) return { text: prepared.length === 1 ? "I prepared the requested Ledgerly action. Review or edit the approval card below, then approve it when ready." : `I prepared ${prepared.length} Ledgerly actions. Review or edit the approval cards below before approving them.`, model: runtime.model, provider: runtime.provider, providerResponseId: null, usage, toolEvents: events, routing };

  const recentText=input.messages.filter(message=>message.role==="assistant").slice(-3).map(message=>message.content).join("\n\n").slice(0,12000),languageBrief=buildResponseLanguageBrief({purpose:kinds.includes("analysis")?"analysis":"general",request:prompt,seed:createId("rsp"),topic:modules.join(", "),category:kinds.join(", "),detail:"standard",audience:input.agent.title||input.agent.key,recentText});
  const answer = await aiText(input, runtime, usage, "light_write_answer", `${languageBrief}\n\nAnswer using ONLY these verified Ledgerly results. Be concise but complete. Use a markdown table for exact comparisons when useful. Never invent missing values.\nUser request: ${prompt}\nVerified results: ${JSON.stringify(results).slice(0, 22_000)}`, 1200);
  const text=cleanHumanResponse(answer.text||"The Ledgerly lookup completed.");
  return { text, model: runtime.model, provider: runtime.provider, providerResponseId: answer.id, usage, toolEvents: events, routing:{...routing,responseFingerprint:responseFingerprint(text),templateRisk:templateRisk(text).risk} };
}


type CompositeCompiled = {
  title?: string; joinKey?: string; columns?: unknown; rows?: unknown; summary?: unknown;
  appliedFilters?: unknown; calculations?: unknown; missingData?: unknown; notes?: unknown;
};
function compositeSearchText(prompt: string) {
  let extra = "";
  if (/\b(attendance|absent|present|late)\b/i.test(prompt)) extra += " student class attendance report present absent marked percentage";
  if (/\b(fee|fees|balance|arrears|outstanding|billing)\b/i.test(prompt)) extra += " school fees balances arrears billed paid outstanding student";
  if (/\b(performance|academic|grade|marks?|results?|division|aggregate)\b/i.test(prompt)) extra += " academics exams results report cards marks grades aggregate division";
  if (/\b(last|previous|current|term|year|compare|trend|fallen|improved|declined)\b/i.test(prompt)) extra += " terms academic years exams comparison current previous";
  if (/\b(class|p[1-7]|learner|student)\b/i.test(prompt)) extra += " students classes streams enrollment";
  return (prompt + " " + extra).trim();
}
function compositeCandidate(tool: LightToolDescriptor) {
  return { name: tool.name, module: tool.module, group: tool.group, kind: tool.kind, source: tool.source, method: tool.method, path: tool.pathTemplate, description: tool.description.slice(0, 260), aliases: tool.aliases.slice(0, 6) };
}
function compositeStrings(value: unknown) { return Array.isArray(value) ? value.map(String).map(item => item.trim()).filter(Boolean) : []; }
function compositeObjectRows(value: unknown): Record<string, unknown>[] {
  const seen = new Set<unknown>(); let best: Record<string, unknown>[] = [];
  function visit(node: unknown, depth: number) {
    if (depth > 5 || node === null || node === undefined || seen.has(node)) return;
    if (typeof node === "object") seen.add(node);
    if (Array.isArray(node)) {
      const rows = node.filter(item => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown>[];
      if (rows.length > best.length) best = rows;
      for (const item of node.slice(0, 30)) visit(item, depth + 1);
      return;
    }
    if (typeof node === "object") for (const child of Object.values(node as Record<string, unknown>)) visit(child, depth + 1);
  }
  visit(value, 0); return best.slice(0, 1000);
}
function sanitizeComposite(value: CompositeCompiled, fallbackRows: Record<string, unknown>[]) {
  const rows = Array.isArray(value.rows) ? value.rows.filter(row => row && typeof row === "object" && !Array.isArray(row)).slice(0, 1000) as Record<string, unknown>[] : fallbackRows;
  const columns = compositeStrings(value.columns);
  const derived = columns.length ? columns : [...new Set(rows.flatMap(row => Object.keys(row)))].slice(0, 40);
  return {
    title: String(value.title || "Composite Ledgerly Report").slice(0, 180),
    joinKey: String(value.joinKey || "studentId").slice(0, 80),
    columns: derived, rows, summary: value.summary ?? {}, appliedFilters: compositeStrings(value.appliedFilters),
    calculations: compositeStrings(value.calculations), missingData: compositeStrings(value.missingData), notes: compositeStrings(value.notes),
  };
}

export async function runCompositeReport(input: LightInput, prompt: string) {
  const request = String(prompt || "").trim();
  if (!request) throw new AppError(422, "VALIDATION_ERROR", "Describe the report you want Ledgerly to build.");
  const runtime = await resolveRuntimeProvider(input.db, input.env, input.principal.organizationId, "luna"), usage = emptyUsage();
  const registry = await stage(input, "composite_build_registry", () => buildLightToolRegistry(input.env, input.principal, input.agent));
  const readable = registry.tools.filter(tool => tool.readOnly && (tool.kind === "query" || tool.kind === "report" || tool.kind === "analysis"));
  if (!readable.length) throw new AppError(409, "COMPOSITE_REPORT_UNAVAILABLE", "No permitted read capabilities are available for this AI employee.");
  const candidates = shortlist(compositeSearchText(request), readable, 60);
  const plannerPrompt = "Plan a READ-ONLY composite Ledgerly report. The user may combine school, attendance, fees, exams, staff, books or finance data.\nUser request: " + request + "\nAvailable READ-ONLY capabilities: " + JSON.stringify(candidates.map(compositeCandidate)) + "\nReturn JSON with steps, questions and joinKey. Each step is {tool,purpose,instruction}. Rules: use 1 to 8 steps and only exact tool names above; the same tool may appear more than once when comparing periods; put prerequisite lookups before dependent reads; prefer studentId/staffId/guardianId as join keys; never join different people only because names look similar; resolve relative periods such as last term from Ledgerly data when possible; questions is only for criteria impossible to resolve safely; never select a write capability.";
  const planner = await aiJson<{ steps?: unknown; questions?: unknown; joinKey?: unknown }>(input, runtime, usage, "composite_plan", plannerPrompt, { steps: [], questions: [], joinKey: "studentId" }, 1500);
  const allowed = new Map(candidates.map(tool => [tool.name, tool]));
  const rawSteps = Array.isArray(planner.steps) ? planner.steps as Array<Record<string, unknown>> : [];
  const steps = rawSteps.map(step => ({ tool: String(step.tool || ""), purpose: String(step.purpose || ""), instruction: String(step.instruction || "") })).filter(step => allowed.has(step.tool)).slice(0, 8);
  const questions = compositeStrings(planner.questions);
  const plan = { joinKey: String(planner.joinKey || "studentId"), steps: steps.length ? steps : candidates.slice(0, 1).map(tool => ({ tool: tool.name, purpose: "Fetch the primary data requested", instruction: request })) };
  if (questions.length) return { mode: "composite-report", request, needsCriteria: true, questions, plan, data: { columns: [], rows: [], summary: {}, appliedFilters: [], calculations: [], missingData: questions, notes: [] }, sources: [], usage };

  const events: Array<Record<string, unknown>> = [], executed: Array<ToolExecution & { purpose: string; instruction: string }> = [];
  for (const step of plan.steps) {
    const tool = allowed.get(step.tool); if (!tool) continue;
    const previous = executed.length ? "\nPrevious verified step results (use IDs/periods from these when needed): " + JSON.stringify(executed.map(item => ({ tool: item.tool.name, purpose: item.purpose, result: item.result }))).slice(0, 10000) : "";
    const instruction = "Composite report step: " + (step.instruction || step.purpose || request) + "\nOverall user request: " + request + previous + "\nThis step is read-only. Do not invent IDs, dates or records.";
    const item = await executeSelected(input, runtime, tool, instruction, executed, events, usage);
    executed.push({ ...item, purpose: step.purpose, instruction: step.instruction });
    if (item.result?.needsClarification) break;
  }
  const issues = executed.flatMap(item => item.result?.needsClarification && Array.isArray(item.result.issues) ? item.result.issues.map(String) : []);
  const sourcePayload = executed.map(item => ({ tool: item.tool.name, module: item.tool.module, purpose: item.purpose, result: item.result }));
  const sourceInfo = executed.map(item => ({ tool: item.tool.name, module: item.tool.module, purpose: item.purpose, rowCount: compositeObjectRows(item.result).length }));
  if (issues.length) return { mode: "composite-report", request, needsCriteria: true, questions: [...new Set(issues)], plan, data: { columns: [], rows: [], summary: {}, appliedFilters: [], calculations: [], missingData: [...new Set(issues)], notes: [] }, sources: sourceInfo, toolEvents: events, usage };

  const fallbackRows = sourcePayload.length === 1 ? compositeObjectRows(sourcePayload[0]!.result) : [];
  const compilePrompt = "Compile a structured composite report using ONLY the verified Ledgerly source results below.\nUser request: " + request + "\nPreferred join key: " + plan.joinKey + "\nVerified sources: " + JSON.stringify(sourcePayload).slice(0, 36000) + "\nReturn JSON {title,joinKey,columns,rows,summary,appliedFilters,calculations,missingData,notes}. Never invent a learner, ID, amount, mark, attendance count, date or other source fact. Join learner data by studentId whenever available; never merge people merely by matching names. Apply every numeric/comparison condition exactly. For attendance percentage calculate only from verified counts and state the formula. For academic trend compare verified current and previous performance values and state the measure. Values ending in Minor are minor-unit values; do not silently reinterpret currency scale. If a human-currency threshold cannot be compared safely, put that in missingData instead of guessing. Keep rows flat and export-friendly. Include studentId plus a human identifier/name when available. If a requested field cannot be derived, list it in missingData. Rows must contain only records satisfying the requested filters.";
  const compiled = await aiJson<CompositeCompiled>(input, runtime, usage, "composite_compile", compilePrompt, { title: "Composite Ledgerly Report", joinKey: plan.joinKey, columns: [], rows: fallbackRows, summary: {}, appliedFilters: [], calculations: [], missingData: [], notes: [] }, 5200);
  const data = sanitizeComposite(compiled, fallbackRows),summaryText=typeof data.summary==="string"?data.summary:(data.summary&&typeof data.summary==="object"?JSON.stringify(data.summary):""),reportSemantic={title:data.title,summary:summaryText,sections:data.calculations.length?[{title:"How the result was derived",analysis:data.calculations.join(". ")}]:[],findings:data.notes,limitations:data.missingData,rows:data.rows},recentRows=await input.db.prepare("SELECT content FROM ae_messages WHERE organization_id=? AND conversation_id=? AND role='assistant' ORDER BY created_at DESC,id DESC LIMIT 3").bind(input.principal.organizationId,input.conversationId).all<{content:string}>(),responseInput={purpose:"report" as const,request,seed:createId("rsp"),topic:"composite report",category:"report",detail:"standard" as const,audience:input.agent.title||input.agent.key,recentText:recentRows.results.map(row=>row.content).join("\n\n").slice(0,12000)};
  let humanResponse=composeFallbackHumanResponse(reportSemantic,responseInput);try{const realized=await aiText(input,runtime,usage,"composite_response_realize",buildResponseRealizationPrompt(responseInput,reportSemantic,sourcePayload),2400);if(realized.text.trim())humanResponse=cleanHumanResponse(realized.text);}catch{}
  return { mode: "composite-report", request, needsCriteria: false, questions: [], plan, data, humanResponse, responseMeta:{fingerprint:responseFingerprint(humanResponse),templateRisk:templateRisk(humanResponse).risk}, sources: sourceInfo, toolEvents: events, model: runtime.model, provider: runtime.provider, usage };
}


type GuidedAnalysisSection={title?:unknown;analysis?:unknown;evidence?:unknown;metrics?:unknown};
type GuidedAnalysisCompiled={
 title?:unknown;summary?:unknown;sections?:unknown;findings?:unknown;metrics?:unknown;relationships?:unknown;
 limitations?:unknown;unanswered?:unknown;suggestedActions?:unknown;rows?:unknown;confidenceNote?:unknown;
};
function analysisArray(value:unknown){return Array.isArray(value)?value:[];}
function analysisStrings(value:unknown){return analysisArray(value).map(String).map(x=>x.trim()).filter(Boolean);}
function sanitizeGuidedAnalysis(value:GuidedAnalysisCompiled){
 const sections=analysisArray(value.sections).filter(x=>x&&typeof x==="object").slice(0,12).map((x:any)=>({
  title:String(x.title||"Analysis").slice(0,160),analysis:String(x.analysis||"").slice(0,6000),
  evidence:analysisStrings(x.evidence).slice(0,20),metrics:analysisArray(x.metrics).slice(0,20)
 }));
 const rows=analysisArray(value.rows).filter(x=>x&&typeof x==="object"&&!Array.isArray(x)).slice(0,1000);
 return{
  title:String(value.title||"Ledgerly Analysis").slice(0,180),summary:String(value.summary||"").slice(0,8000),sections,
  findings:analysisArray(value.findings).slice(0,30),metrics:analysisArray(value.metrics).slice(0,40),
  relationships:analysisArray(value.relationships).slice(0,30),limitations:analysisStrings(value.limitations).slice(0,30),
  unanswered:analysisStrings(value.unanswered).slice(0,30),suggestedActions:analysisArray(value.suggestedActions).slice(0,30),
  rows,confidenceNote:String(value.confidenceNote||"").slice(0,2000)
 };
}
function guidedCapabilitySearch(prompt:string,topicText:string){return (prompt+" "+topicText).slice(0,12000);}

export async function runGuidedAnalysis(input:LightInput,payload:{mode:AnalysisMode;prompt:string;topicId?:string|null;entity?:AnalysisEntityOption|null}){
 const mode:AnalysisMode=payload.mode==="account-for"?"account-for":"analyse",request=String(payload.prompt||"").trim();
 if(!request)throw new AppError(422,"VALIDATION_ERROR","Describe what you want Ledgerly to analyse.");
 const runtime=await resolveRuntimeProvider(input.db,input.env,input.principal.organizationId,"luna"),usage=emptyUsage();
 const registry=await stage(input,"analysis_build_registry",()=>buildLightToolRegistry(input.env,input.principal,input.agent));
 const readable=registry.tools.filter(tool=>tool.readOnly&&(tool.kind==="query"||tool.kind==="report"||tool.kind==="analysis"));
 if(!readable.length)throw new AppError(409,"ANALYSIS_UNAVAILABLE","No permitted read capabilities are available for this AI employee.");

 let topic=getAnalysisTopic(payload.topicId||null);
 if(!topic){
  const suggestions=suggestAnalysisTopics(mode,request,readable.map(tool=>tool.name+" "+tool.description+" "+tool.aliases.join(" ")).join(" ")).slice(0,12);
  const classified=await aiJson<{topicId?:unknown}>(input,runtime,usage,"analysis_classify_topic",
   "Choose the best investigation topic for this request. Return one topicId or an empty string if none is a good fit.\nRequest: "+request+"\nTopics: "+JSON.stringify(suggestions.map(item=>({id:item.id,label:item.label,description:item.description,evidence:item.evidence.slice(0,5)}))),
   {topicId:suggestions[0]?.id||""},300);
  topic=getAnalysisTopic(String(classified.topicId||""))||suggestions[0]||null;
 }
 const knowledge=analysisKnowledgeSummary(topic);
 let entity=payload.entity||null,entityResolution:any=null;
 if(!entity){
  const extracted=await aiJson<{mention?:unknown;types?:unknown}>(input,runtime,usage,"analysis_extract_entity",
   "Extract the primary named Ledgerly entity only if the user clearly names one specific person, account, class, stream, subject, department, term, product or contact. Do not treat generic phrases such as P6 learners, all teachers or the school as a named entity. Return {mention:'',types:[]} when there is no specific named entity.\nRequest: "+request+"\nLikely entity types for this topic: "+JSON.stringify(topic?.entityTypes||[]),
   {mention:"",types:[]},260);
  const mention=String(extracted.mention||"").trim(),types=analysisStrings(extracted.types);
  if(mention.length>=2){
   entityResolution=await identifyAnalysisEntity(input.db,input.principal.organizationId,mention,types.length?types:topic?.entityTypes);
   if(entityResolution.status==="resolved")entity=entityResolution.entity;
   else if(entityResolution.status==="ambiguous")return{mode,request,topic,needsEntity:true,entityQuery:mention,entityOptions:entityResolution.options,needsCriteria:false,questions:[],plan:null,analysis:null,sources:[],usage};
  }
 }

 const topicText=topic?[topic.label,topic.description,...topic.keywords,...topic.evidence].join(" "):knowledge;
 const candidates=shortlist(guidedCapabilitySearch(request,topicText),readable,72);
 const plannerPrompt="Build a fresh READ-ONLY evidence investigation for Ledgerly. This is not a report template. Select evidence because it can answer this exact request.\nMode: "+mode+"\nRequest: "+request+"\nResolved entity: "+JSON.stringify(entity)+"\nInvestigation knowledge: "+knowledge+"\nAvailable capabilities: "+JSON.stringify(candidates.map(compositeCandidate))+"\nReturn {steps:[{tool,purpose,instruction}],questions:[],joinKey}. Use 1 to 10 steps. The same read tool may appear more than once for different periods or comparison groups. Use the resolved entity ID/type exactly when present. Include comparison/baseline evidence when it materially helps. For account-for requests, investigate competing explanations and counter-evidence; do not jump from correlation to causation. Never use a write tool. Ask questions only when a required identifier, period or comparison truly cannot be resolved from Ledgerly.";
 const planned=await aiJson<{steps?:unknown;questions?:unknown;joinKey?:unknown}>(input,runtime,usage,"analysis_plan",plannerPrompt,{steps:[],questions:[],joinKey:entity?.type==="staff"||entity?.type==="teacher"?"staffId":"studentId"},1800);
 const rawSteps=Array.isArray(planned.steps)?planned.steps as Array<Record<string,unknown>>:[],allowed=new Map(candidates.map(tool=>[tool.name,tool]));
 const steps=rawSteps.map(step=>({tool:String(step.tool||""),purpose:String(step.purpose||""),instruction:String(step.instruction||"")})).filter(step=>allowed.has(step.tool)).slice(0,10);
 const questions=analysisStrings(planned.questions);
 const plan={joinKey:String(planned.joinKey||"studentId"),steps:steps.length?steps:candidates.slice(0,1).map(tool=>({tool:tool.name,purpose:"Retrieve primary evidence",instruction:request}))};
 if(questions.length)return{mode,request,topic,entity,needsEntity:false,needsCriteria:true,questions,plan,analysis:null,sources:[],usage};

 const events:Array<Record<string,unknown>>=[],executed:Array<ToolExecution&{purpose:string;instruction:string}>=[];
 for(const step of plan.steps){
  const tool=allowed.get(step.tool);if(!tool)continue;
  const prior=executed.length?"\nVerified results from earlier steps that may provide IDs, dates or baselines: "+JSON.stringify(executed.map(item=>({tool:item.tool.name,purpose:item.purpose,result:item.result}))).slice(0,12000):"";
  const instruction="Investigation step purpose: "+(step.purpose||"evidence")+"\nStep instruction: "+(step.instruction||request)+"\nOverall request: "+request+"\nResolved entity: "+JSON.stringify(entity)+prior+"\nUse only read operations and never invent an ID, period or record.";
  const item=await executeSelected(input,runtime,tool,instruction,executed,events,usage);executed.push({...item,purpose:step.purpose,instruction:step.instruction});
  if(item.result?.needsClarification)break;
 }
 const issues=executed.flatMap(item=>item.result?.needsClarification&&Array.isArray(item.result.issues)?item.result.issues.map(String):[]);
 const sources=executed.map(item=>({tool:item.tool.name,module:item.tool.module,purpose:item.purpose,rowCount:compositeObjectRows(item.result).length}));
 if(issues.length)return{mode,request,topic,entity,needsEntity:false,needsCriteria:true,questions:[...new Set(issues)],plan,analysis:null,sources,toolEvents:events,usage};

 const verified=executed.map(item=>({tool:item.tool.name,module:item.tool.module,purpose:item.purpose,result:item.result}));
 const compilePrompt="Perform a genuine evidence-based Ledgerly "+(mode==="account-for"?"explanation/investigation":"analysis")+". Do NOT fill a fixed report template and do NOT force the same headings used in other analyses. Decide the number and titles of sections from the evidence and the user's question.\nRequest: "+request+"\nTopic knowledge (a checklist of evidence to consider, not conclusions): "+knowledge+"\nResolved entity: "+JSON.stringify(entity)+"\nVerified Ledgerly evidence: "+JSON.stringify(verified).slice(0,42000)+"\nReturn JSON {title,summary,sections:[{title,analysis,evidence,metrics}],findings,metrics,relationships,limitations,unanswered,suggestedActions,rows,confidenceNote}. Rules: every factual claim must be traceable to verified evidence above; distinguish direct facts, calculations, associations and explanations; never invent missing records; never infer private motives; never blame a teacher, learner or guardian from correlation alone; for account-for, identify strongest observed contributors, counter-evidence and alternative explanations, and explicitly say when causation cannot be established; use comparisons and calculations only when denominators/periods are compatible; suggestedActions are advisory only and must not claim they were executed; rows should be flat supporting data when useful. Vary the analysis structure according to what the evidence actually shows.";
 const compiled=await aiJson<GuidedAnalysisCompiled>(input,runtime,usage,"analysis_synthesize",compilePrompt,{title:topic?.label||"Ledgerly Analysis",summary:"",sections:[],findings:[],metrics:[],relationships:[],limitations:[],unanswered:[],suggestedActions:[],rows:[],confidenceNote:""},6200);
 const analysis=sanitizeGuidedAnalysis(compiled),recentRows=await input.db.prepare("SELECT content FROM ae_messages WHERE organization_id=? AND conversation_id=? AND role='assistant' ORDER BY created_at DESC,id DESC LIMIT 3").bind(input.principal.organizationId,input.conversationId).all<{content:string}>(),recentText=recentRows.results.map(row=>row.content).join("\n\n").slice(0,12000),responseInput={purpose:(mode==="account-for"?"account-for":"analysis") as const,request,seed:createId("rsp"),topic:topic?.label||null,category:topic?.category||null,entityType:entity?.type||null,detail:"deep" as const,audience:input.agent.title||input.agent.key,recentText};
 let humanResponse=composeFallbackHumanResponse(analysis,responseInput),responseModel=runtime.model;try{const realized=await aiText(input,runtime,usage,"analysis_response_realize",buildResponseRealizationPrompt(responseInput,analysis,verified.map(item=>({tool:item.tool,module:item.module,purpose:item.purpose,result:item.result}))),3200);if(realized.text.trim())humanResponse=cleanHumanResponse(realized.text);}catch{}
 const responseQuality=templateRisk(humanResponse);
 return{mode,request,topic,entity,needsEntity:false,needsCriteria:false,questions:[],plan,analysis,humanResponse,responseMeta:{fingerprint:responseFingerprint(humanResponse),templateRisk:responseQuality.risk,registerBrief:buildResponseLanguageBrief(responseInput).split("\n").slice(0,5),model:responseModel},sources,toolEvents:events,model:runtime.model,provider:runtime.provider,usage};
}

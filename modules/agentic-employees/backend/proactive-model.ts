import { AppError } from "../../../src/lib/errors";
import type { ModelTier } from "./policy";
import { resolveModel } from "./policy";

type AiEnv = Record<string, unknown> & { OPENAI_API_KEY?: string; OPENAI_BASE_URL?: string };

type OpenAiResponse = {
  id?: string;
  output_text?: string;
  usage?: unknown;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

function textFrom(response: OpenAiResponse) {
  if (response.output_text?.trim()) return response.output_text.trim();
  const chunks: string[] = [];
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) if (part.type === "output_text" && part.text) chunks.push(part.text);
  }
  return chunks.join("\n").trim();
}

export async function runProactiveModel(env: AiEnv, tier: ModelTier, instructions: string, input: string) {
  if (!env.OPENAI_API_KEY) throw new AppError(503, "AI_NOT_CONFIGURED", "OpenAI is not configured. Set OPENAI_API_KEY on the Ledgerly server.");
  const model = resolveModel(tier, env);
  const base = String(env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${base}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: tier === "sol" ? "high" : tier === "terra" ? "medium" : "low" },
      instructions,
      input: [{ role: "user", content: input }],
    }),
  });
  const payload = await response.json().catch(() => ({})) as OpenAiResponse;
  if (!response.ok) throw new AppError(502, "AI_PROVIDER_ERROR", payload.error?.message || `OpenAI request failed (${response.status})`);
  return { text: textFrom(payload) || "No proactive summary was produced.", model, providerResponseId: payload.id || null, usage: payload.usage || null };
}

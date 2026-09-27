import { rm } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import type { AppEnv } from "../../../http/types.js";
import { createId, requireScope } from "../../core-identity/security.js";
import { createLedgerlyAiCorrelationId } from "../logger.js";
import type { LedgerlyAiFoundationService } from "../service.js";

/**
 * Stateless completion for other self-hosted apps (e.g. EduShare classification), called with
 * an API key that has the `ai:write` scope. Unlike /prompt it skips chats, memory and Ledgerly
 * tools, and runs a short read-only provider job through the shared queue (with failover).
 */
const completeSchema = z.object({
  system: z.string().trim().max(8000).optional(),
  prompt: z.string().trim().min(1).max(60000),
  responseFormat: z.enum(["text", "json"]).default("text"),
  provider: z.enum(["codex", "claude-code"]).optional(),
});

/** Pulls the first JSON object out of a model reply (tolerates code fences and prose). */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  for (const candidate of [fenced, text]) {
    if (!candidate) continue;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* try the next candidate */ }
  }
  return null;
}

export function createLedgerlyAiIntegrationRoutes(service: LedgerlyAiFoundationService) {
  const routes = new Hono<AppEnv>();
  routes.post("/integrations/complete", requireScope("ai:write"), async (c) => {
    if (!service.config.LEDGERLY_AI_ENABLED) throw new AppError(503, "LEDGERLY_AI_DISABLED", "Ledgerly AI is disabled on this server.");
    const parsed = completeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid completion request.", parsed.error.flatten());
    const input = parsed.data;
    const principal = c.get("principal");
    const id = createId("laiint");
    const prompt = [
      input.system ? `<instructions>\n${input.system}\n</instructions>` : "",
      input.prompt,
      input.responseFormat === "json"
        ? "Reply with a single JSON object only. No prose, no markdown, no code fences. Do not run tools or read files."
        : "Answer directly. Do not run tools or read files.",
    ].filter(Boolean).join("\n\n");
    try {
      const result = await service.providers.execute({
        id,
        organizationId: principal.organizationId,
        userId: principal.userId,
        correlationId: createLedgerlyAiCorrelationId("laiint"),
        prompt,
        taskKind: "analysis",
        sandbox: "read-only",
        providerOverride: input.provider,
        maxTurns: 4,
        timeoutMs: 5 * 60_000,
      });
      const json = input.responseFormat === "json" ? extractJsonObject(result.text) : null;
      if (input.responseFormat === "json" && !json) {
        throw new AppError(502, "LEDGERLY_AI_INVALID_JSON", "The AI reply did not contain a JSON object.");
      }
      return c.json({ data: { text: result.text, json, provider: result.provider, durationMs: result.durationMs } });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, "LEDGERLY_AI_PROVIDER_FAILED", error instanceof Error ? error.message : "Ledgerly AI provider failed.");
    } finally {
      // Each execution gets a scratch workspace; integration calls never need it afterwards.
      await rm(path.join(service.config.LEDGERLY_AI_WORK_ROOT, id), { recursive: true, force: true }).catch(() => undefined);
    }
  });
  return routes;
}

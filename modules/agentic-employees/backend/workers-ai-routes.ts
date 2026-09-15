import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { requireScope } from "../../../src/lib/auth";
import { DEFAULT_WORKERS_AI_MODEL, getWorkersAiSettings, saveWorkersAiSettings, testWorkersAi } from "./workers-ai";

export const agenticWorkersAiRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

agenticWorkersAiRoutes.get("/workers-ai-settings", requireScope("school:read"), async c => {
  const p = c.get("principal");
  return c.json({ data: await getWorkersAiSettings(c.env.FINANCE_DB, p.organizationId) });
});

agenticWorkersAiRoutes.patch("/workers-ai-settings", requireScope("school:write"), async c => {
  const parsed = z.object({
    accountId: z.string().trim().min(8).max(80),
    apiToken: z.string().trim().max(1024).optional(),
    model: z.string().trim().min(1).max(180).default(DEFAULT_WORKERS_AI_MODEL),
    maxOutputTokens: z.number().int().min(128).max(4096).default(768),
    timeoutMs: z.number().int().min(5000).max(120000).default(30000),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid Workers AI configuration", parsed.error.flatten());
  const p = c.get("principal");
  const data = await saveWorkersAiSettings(c.env.FINANCE_DB, c.env, p.organizationId, p.userId, parsed.data);
  return c.json({ data });
});

agenticWorkersAiRoutes.post("/workers-ai-settings/test", requireScope("school:write"), async c => {
  const p = c.get("principal");
  return c.json({ data: await testWorkersAi(c.env.FINANCE_DB, c.env, p.organizationId) });
});

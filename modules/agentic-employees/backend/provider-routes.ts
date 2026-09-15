import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { requireScope } from "../../../src/lib/auth";
import { AI_PROVIDER_CATALOG, getProviderSettings, saveProviderSettings } from "./provider-config";
import { testProviderConnection } from "./openai";

export const agenticProviderRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const providerSchema = z.enum(["openai", "google", "anthropic"]);
const modelSchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9._:/-]+$/);
const configurationSchema = z.object({
  temperature: z.number().min(0).max(2).nullable().optional(),
  topP: z.number().min(0).max(1).nullable().optional(),
  maxOutputTokens: z.number().int().min(128).max(65536).optional(),
  timeoutMs: z.number().int().min(5000).max(120000).optional(),
  reasoningEffort: z.enum(["default", "low", "medium", "high", "max"]).optional(),
}).optional();

agenticProviderRoutes.get("/provider-catalog", requireScope("school:read"), c => c.json({
  data: {
    providers: Object.values(AI_PROVIDER_CATALOG),
    limits: {
      temperature: { min: 0, max: 2 },
      topP: { min: 0, max: 1 },
      maxOutputTokens: { min: 128, max: 65536 },
      timeoutMs: { min: 5000, max: 120000 },
      reasoningEffort: ["default", "low", "medium", "high", "max"],
    },
  },
}));

agenticProviderRoutes.get("/provider-settings", requireScope("school:read"), async c => {
  const principal = c.get("principal");
  return c.json({ data: await getProviderSettings(c.env.FINANCE_DB, c.env, principal.organizationId) });
});

// Compatibility endpoint used by the existing AI Workforce overview/settings card.
// This route is intentionally mounted before the legacy /settings route.
agenticProviderRoutes.get("/settings", requireScope("school:read"), async c => {
  const principal = c.get("principal");
  const settings = await getProviderSettings(c.env.FINANCE_DB, c.env, principal.organizationId);
  const catalog = AI_PROVIDER_CATALOG[settings.provider];
  return c.json({
    data: {
      provider: catalog.label,
      providerId: settings.provider,
      configured: settings.configured,
      apiKeyConfigured: settings.apiKeyConfigured,
      apiKeyHint: settings.apiKeyHint,
      models: settings.models,
      config: settings.config,
      source: settings.source,
      updatedAt: settings.updatedAt,
    },
  });
});

agenticProviderRoutes.patch("/provider-settings", requireScope("school:write"), async c => {
  const parsed = z.object({
    provider: providerSchema,
    models: z.object({ luna: modelSchema, terra: modelSchema, sol: modelSchema }),
    apiKey: z.string().trim().max(512).nullable().optional(),
    clearApiKey: z.boolean().optional(),
    config: configurationSchema,
  }).safeParse(await c.req.json());
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid AI provider configuration", parsed.error.flatten());
  const principal = c.get("principal");
  const current = await getProviderSettings(c.env.FINANCE_DB, c.env, principal.organizationId);
  const providerChanged = current.source === "school" && current.provider !== parsed.data.provider;
  const hasReplacementKey = typeof parsed.data.apiKey === "string" && parsed.data.apiKey.trim().length > 0;
  const input = {
    ...parsed.data,
    clearApiKey: Boolean(parsed.data.clearApiKey || (providerChanged && !hasReplacementKey)),
  };
  const data = await saveProviderSettings(c.env.FINANCE_DB, c.env, principal.organizationId, principal.userId, input);
  return c.json({ data });
});

agenticProviderRoutes.post("/provider-settings/test", requireScope("school:write"), async c => {
  const parsed = z.object({ tier: z.enum(["luna", "terra", "sol"]).default("luna") }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid test model tier", parsed.error.flatten());
  const principal = c.get("principal");
  const result = await testProviderConnection(c.env.FINANCE_DB, c.env, principal.organizationId, parsed.data.tier);
  return c.json({ data: result });
});
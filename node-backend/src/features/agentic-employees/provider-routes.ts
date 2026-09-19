import { Hono } from "hono";
import { AppError, requireScope } from "./shared.js";
import type { AppVariables, Env } from "./shared.js";
import { testProviderConnection } from "./openai.js";

export const agenticProviderRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function managedSettings() {
  return {
    provider: "Ledgerly AI",
    providerId: "ledgerly-ai",
    configured: true,
    apiKeyConfigured: true,
    apiKeyHint: "Managed by Ledgerly AI",
    models: { luna: "managed", terra: "managed", sol: "managed" },
    config: {
      reasoningEffort: "managed",
      providerSelection: "managed",
    },
    source: "ledgerly-ai",
    updatedAt: null,
  };
}

agenticProviderRoutes.get("/provider-catalog", requireScope("school:read"), c => c.json({
  data: {
    providers: [{
      id: "ledgerly-ai",
      label: "Ledgerly AI",
      managed: true,
      description: "Provider selection and credentials are managed centrally by Ledgerly AI.",
    }],
    providerSelection: "managed",
  },
}));

agenticProviderRoutes.get("/provider-settings", requireScope("school:read"), c => {
  return c.json({ data: managedSettings() });
});

agenticProviderRoutes.get("/settings", requireScope("school:read"), c => {
  return c.json({ data: managedSettings() });
});

agenticProviderRoutes.patch("/provider-settings", requireScope("school:write"), () => {
  throw new AppError(
    409,
    "LEDGERLY_AI_PROVIDER_MANAGED",
    "Agentic Employees now use the centrally managed Ledgerly AI execution service.",
  );
});

agenticProviderRoutes.post("/provider-settings/test", requireScope("school:write"), async c => {
  const principal = c.get("principal");
  const result = await testProviderConnection(
    c.env.FINANCE_DB,
    c.env as Env & Record<string, unknown>,
    principal.organizationId,
  );
  return c.json({ data: result });
});

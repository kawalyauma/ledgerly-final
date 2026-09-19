import { z } from "zod";

export const LEDGERLY_AI_PROVIDERS = ["codex", "claude-code"] as const;
export type LedgerlyAiProviderId = (typeof LEDGERLY_AI_PROVIDERS)[number];

function envBoolean(defaultValue: boolean) {
  return z.union([z.boolean(), z.enum(["true", "false"])]).optional().transform((value) => {
    if (value === undefined) return defaultValue;
    return typeof value === "boolean" ? value : value === "true";
  });
}

const schema = z.object({
  LEDGERLY_AI_ENABLED: envBoolean(true),
  LEDGERLY_AI_DEFAULT_PROVIDER: z.enum(LEDGERLY_AI_PROVIDERS).default("codex"),
  LEDGERLY_AI_FALLBACK_PROVIDER: z.enum(LEDGERLY_AI_PROVIDERS).default("claude-code"),
  LEDGERLY_AI_CODEX_BIN: z.string().min(1).default("codex"),
  LEDGERLY_AI_CLAUDE_BIN: z.string().min(1).default("claude"),
  LEDGERLY_AI_JOB_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(300_000),
  LEDGERLY_AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  LEDGERLY_AI_LOG_PROMPTS: envBoolean(false),
  LEDGERLY_AI_STARTUP_HEALTHCHECK: envBoolean(true),
}).superRefine((value, ctx) => {
  if (value.LEDGERLY_AI_DEFAULT_PROVIDER === value.LEDGERLY_AI_FALLBACK_PROVIDER) {
    ctx.addIssue({
      code: "custom",
      path: ["LEDGERLY_AI_FALLBACK_PROVIDER"],
      message: "Fallback provider must differ from the default provider.",
    });
  }
});

export type LedgerlyAiConfig = z.infer<typeof schema>;

export function parseLedgerlyAiConfig(
  env: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
): LedgerlyAiConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid Ledgerly AI environment: ${details}`);
  }
  return parsed.data;
}

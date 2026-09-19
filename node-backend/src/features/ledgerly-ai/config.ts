import { z } from "zod";

export const LEDGERLY_AI_PROVIDERS = ["codex", "claude-code"] as const;
export type LedgerlyAiProviderId = (typeof LEDGERLY_AI_PROVIDERS)[number];
export type LedgerlyAiExecutionMode = "local" | "docker";

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
  LEDGERLY_AI_EXECUTION_MODE: z.enum(["local", "docker"]).default("docker"),
  LEDGERLY_AI_CODEX_BIN: z.string().min(1).default("codex"),
  LEDGERLY_AI_CLAUDE_BIN: z.string().min(1).default("claude"),
  LEDGERLY_AI_DOCKER_BIN: z.string().min(1).default("docker"),
  LEDGERLY_AI_CODEX_IMAGE: z.string().min(1).default("ledgerly-ai-codex:local"),
  LEDGERLY_AI_CLAUDE_IMAGE: z.string().min(1).default("ledgerly-ai-claude-code:local"),
  LEDGERLY_AI_SESSION_ROOT: z.string().min(1).default("/var/lib/ledgerly-ai/sessions"),
  LEDGERLY_AI_WORK_ROOT: z.string().min(1).default("/var/lib/ledgerly-ai/workspaces"),
  LEDGERLY_AI_JOB_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(300_000),
  LEDGERLY_AI_HEALTH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  LEDGERLY_AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  LEDGERLY_AI_MAX_QUEUE: z.coerce.number().int().min(1).max(10_000).default(100),
  LEDGERLY_AI_MAX_OUTPUT_BYTES: z.coerce.number().int().min(65_536).max(64 * 1024 * 1024).default(4 * 1024 * 1024),
  LEDGERLY_AI_RETRY_ATTEMPTS: z.coerce.number().int().min(0).max(5).default(1),
  LEDGERLY_AI_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).max(60_000).default(1_000),
  LEDGERLY_AI_CODEX_SOFT_JOBS_PER_HOUR: z.coerce.number().int().min(0).max(10_000).default(0),
  LEDGERLY_AI_CLAUDE_SOFT_JOBS_PER_HOUR: z.coerce.number().int().min(0).max(10_000).default(0),
  LEDGERLY_AI_USER_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(20),
  LEDGERLY_AI_ORG_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(200),
  LEDGERLY_AI_AGENT_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(100_000).default(60),
  LEDGERLY_AI_CHAT_HISTORY_MESSAGES: z.coerce.number().int().min(2).max(200).default(30),
  LEDGERLY_AI_LOG_PROMPTS: envBoolean(false),
  LEDGERLY_AI_STARTUP_HEALTHCHECK: envBoolean(true),
}).superRefine((value, ctx) => {
  if (value.LEDGERLY_AI_DEFAULT_PROVIDER === value.LEDGERLY_AI_FALLBACK_PROVIDER) {
    ctx.addIssue({ code: "custom", path: ["LEDGERLY_AI_FALLBACK_PROVIDER"], message: "Fallback provider must differ from the default provider." });
  }
});

export type LedgerlyAiConfig = z.infer<typeof schema>;

export function parseLedgerlyAiConfig(
  env: NodeJS.ProcessEnv | Record<string, unknown> = process.env,
): LedgerlyAiConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid Ledgerly AI environment: ${details}`);
  }
  return parsed.data;
}

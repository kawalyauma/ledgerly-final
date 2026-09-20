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
  LEDGERLY_AI_DOCKER_NETWORK: z.string().trim().min(1).max(120).default("bridge"),
  LEDGERLY_AI_WORKER_MEMORY_MB: z.coerce.number().int().min(512).max(16384).default(3072),
  LEDGERLY_AI_WORKER_CPUS: z.coerce.number().min(0.25).max(8).default(2),
  LEDGERLY_AI_WORKER_PIDS: z.coerce.number().int().min(32).max(2048).default(256),
  LEDGERLY_AI_WORKER_NOFILE: z.coerce.number().int().min(128).max(65535).default(1024),
  LEDGERLY_AI_WORKER_TMPFS_MB: z.coerce.number().int().min(64).max(4096).default(512),
  LEDGERLY_AI_WORKER_MAX_TURNS: z.coerce.number().int().min(1).max(50).default(12),
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
  LEDGERLY_AI_SHORT_TERM_MEMORY_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  LEDGERLY_AI_MEMORY_RETRIEVAL_LIMIT: z.coerce.number().int().min(1).max(30).default(12),
  LEDGERLY_AI_MEMORY_CONTEXT_CHARS: z.coerce.number().int().min(1000).max(100_000).default(12_000),
  LEDGERLY_AI_MAX_TOOL_STEPS: z.coerce.number().int().min(1).max(12).default(6),
  LEDGERLY_AI_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).default(120_000),
  LEDGERLY_AI_TOOL_MAX_RESULT_BYTES: z.coerce.number().int().min(16_384).max(8 * 1024 * 1024).default(512 * 1024),
  LEDGERLY_AI_REPO_ROOT: z.string().min(1).default("/opt/ledgerly/source"),
  LEDGERLY_AI_GIT_BASE_BRANCH: z.string().min(1).default("main"),
  LEDGERLY_AI_GIT_REMOTE: z.string().min(1).default("origin"),
  LEDGERLY_AI_GIT_PROTECTED_BRANCHES: z.string().default("main,master,production"),
  LEDGERLY_AI_GIT_AUTO_PR: envBoolean(false),
  LEDGERLY_AI_GIT_REQUIRED_CHECKS: z.string().default(""),
  LEDGERLY_AI_GITHUB_REPOSITORY: z.string().default(""),
  LEDGERLY_AI_GITHUB_TOKEN: z.string().default(""),
  LEDGERLY_AI_GITHUB_API_URL: z.string().url().default("https://api.github.com"),
  LEDGERLY_AI_INCIDENT_EVENT_COOLDOWN_SECONDS: z.coerce.number().int().min(30).max(86_400).default(300),
  LEDGERLY_AI_INCIDENT_DISPATCH_COOLDOWN_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
  LEDGERLY_AI_MONITOR_DB_WARN_MS: z.coerce.number().int().min(10).max(60_000).default(500),
  LEDGERLY_AI_MONITOR_DB_CRITICAL_MS: z.coerce.number().int().min(50).max(120_000).default(2_000),
  LEDGERLY_AI_MONITOR_SLOW_QUERY_MS: z.coerce.number().int().min(1_000).max(600_000).default(10_000),
  LEDGERLY_AI_MONITOR_QUEUE_WARN: z.coerce.number().int().min(1).max(1_000_000).default(100),
  LEDGERLY_AI_MONITOR_QUEUE_CRITICAL: z.coerce.number().int().min(1).max(1_000_000).default(1_000),
  LEDGERLY_AI_MONITOR_DISK_WARN_PERCENT: z.coerce.number().min(1).max(99).default(85),
  LEDGERLY_AI_MONITOR_DISK_CRITICAL_PERCENT: z.coerce.number().min(1).max(100).default(95),
  LEDGERLY_AI_MONITOR_MEMORY_WARN_PERCENT: z.coerce.number().min(1).max(99).default(90),
  LEDGERLY_AI_MONITOR_MEMORY_CRITICAL_PERCENT: z.coerce.number().min(1).max(100).default(97),
  LEDGERLY_AI_LOG_PROMPTS: envBoolean(false),
  LEDGERLY_AI_STARTUP_HEALTHCHECK: envBoolean(true),
  // When true, non-critical (single-approval) incident fixes are reviewed and
  // deployed by the Tuma release employee without a human clicking approve.
  // Critical (two-owner) changes always still require real human reviewers —
  // this flag cannot and does not weaken that check.
  LEDGERLY_AI_AUTONOMOUS_RELEASE_ENABLED: envBoolean(false),
  LEDGERLY_AI_DEPLOY_COMPOSE_DIR: z.string().min(1).default("/opt/ledgerly/source/node-backend"),
  LEDGERLY_AI_DEPLOY_SERVICES: z.string().min(1).default("api,queue"),
  LEDGERLY_AI_DEPLOY_TIMEOUT_MS: z.coerce.number().int().min(30_000).max(1_800_000).default(600_000),
}).superRefine((value, ctx) => {
  if (value.LEDGERLY_AI_DEFAULT_PROVIDER === value.LEDGERLY_AI_FALLBACK_PROVIDER) {
    ctx.addIssue({ code: "custom", path: ["LEDGERLY_AI_FALLBACK_PROVIDER"], message: "Fallback provider must differ from the default provider." });
  }
  const orderedThresholds = [
    ["LEDGERLY_AI_MONITOR_DB_WARN_MS","LEDGERLY_AI_MONITOR_DB_CRITICAL_MS"],
    ["LEDGERLY_AI_MONITOR_QUEUE_WARN","LEDGERLY_AI_MONITOR_QUEUE_CRITICAL"],
    ["LEDGERLY_AI_MONITOR_DISK_WARN_PERCENT","LEDGERLY_AI_MONITOR_DISK_CRITICAL_PERCENT"],
    ["LEDGERLY_AI_MONITOR_MEMORY_WARN_PERCENT","LEDGERLY_AI_MONITOR_MEMORY_CRITICAL_PERCENT"],
  ] as const;
  for (const [warn,critical] of orderedThresholds) {
    if (value[critical] <= value[warn]) {
      ctx.addIssue({ code: "custom", path: [critical], message: critical + " must be greater than " + warn + "." });
    }
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

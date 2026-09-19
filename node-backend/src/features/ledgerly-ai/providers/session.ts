import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { LedgerlyAiConfig, LedgerlyAiProviderId } from "../config.js";

const SECRET_ENV_KEYS = new Set([
  "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "CODEX_API_KEY",
  "OPENROUTER_API_KEY", "GROQ_API_KEY", "GOOGLE_API_KEY",
]);

export class ProviderSessionStore {
  constructor(private readonly config: LedgerlyAiConfig) {}

  home(provider: LedgerlyAiProviderId) {
    return path.join(this.config.LEDGERLY_AI_SESSION_ROOT, provider);
  }

  async initialize() {
    await Promise.all([
      mkdir(this.home("codex"), { recursive: true, mode: 0o700 }),
      mkdir(this.home("claude-code"), { recursive: true, mode: 0o700 }),
      mkdir(this.config.LEDGERLY_AI_WORK_ROOT, { recursive: true, mode: 0o700 }),
    ]);
  }

  async configured(provider: LedgerlyAiProviderId) {
    try {
      const entries = await readdir(this.home(provider), { withFileTypes: true });
      return entries.some((entry) => !entry.name.startsWith(".ledgerly-placeholder"));
    } catch {
      return false;
    }
  }

  environment(provider: LedgerlyAiProviderId): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !SECRET_ENV_KEYS.has(key)) env[key] = value;
    }
    const home = this.home(provider);
    env.HOME = home;
    if (provider === "codex") env.CODEX_HOME = home;
    return env;
  }
}

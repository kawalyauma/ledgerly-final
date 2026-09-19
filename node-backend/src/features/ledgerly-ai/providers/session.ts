import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { LedgerlyAiConfig, LedgerlyAiProviderId } from "../config.js";

const SAFE_PROVIDER_ENV_KEYS = new Set([
  "PATH","LANG","LC_ALL","LC_CTYPE","TERM","TZ","TMPDIR",
  "HTTP_PROXY","HTTPS_PROXY","NO_PROXY","http_proxy","https_proxy","no_proxy",
  "SSL_CERT_FILE","SSL_CERT_DIR","NODE_EXTRA_CA_CERTS",
]);

export class ProviderSessionStore {
  constructor(private readonly config: LedgerlyAiConfig) {}

  home(provider: LedgerlyAiProviderId) {
    return path.join(this.config.LEDGERLY_AI_SESSION_ROOT, provider);
  }

  private authMarker(provider: LedgerlyAiProviderId) {
    return provider === "codex"
      ? path.join(this.home(provider), "auth.json")
      : path.join(this.home(provider), ".claude", ".credentials.json");
  }

  async initialize() {
    await Promise.all([
      mkdir(this.home("codex"), { recursive: true, mode: 0o700 }),
      mkdir(path.join(this.home("claude-code"), ".claude"), { recursive: true, mode: 0o700 }),
      mkdir(this.config.LEDGERLY_AI_WORK_ROOT, { recursive: true, mode: 0o700 }),
    ]);
  }

  async configured(provider: LedgerlyAiProviderId) {
    try {
      const info = await stat(this.authMarker(provider));
      return info.isFile() && info.size > 0;
    } catch {
      return false;
    }
  }

  environment(provider: LedgerlyAiProviderId): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && SAFE_PROVIDER_ENV_KEYS.has(key)) env[key] = value;
    }
    const home = this.home(provider);
    env.HOME = home;
    if (provider === "codex") env.CODEX_HOME = home;
    return env;
  }
}

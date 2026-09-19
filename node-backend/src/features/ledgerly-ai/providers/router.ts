import type { Pool } from "pg";
import type { LedgerlyAiConfig, LedgerlyAiProviderId } from "../config.js";
import type { LedgerlyAiProviderAdapter, LedgerlyAiTaskKind, ProviderDiagnostics } from "./types.js";

type ProviderStatsRow = {
  provider: LedgerlyAiProviderId;
  jobs: number | string;
  successes: number | string;
  failures: number | string;
  averageDurationMs: number | string | null;
};

export class LedgerlyAiProviderRouter {
  constructor(
    private readonly db: Pool,
    private readonly config: LedgerlyAiConfig,
    private readonly providers: Map<LedgerlyAiProviderId, LedgerlyAiProviderAdapter>,
    private readonly queueState: () => { active: number; queued: number },
  ) {}

  private softLimit(provider: LedgerlyAiProviderId) {
    return provider === "codex"
      ? this.config.LEDGERLY_AI_CODEX_SOFT_JOBS_PER_HOUR
      : this.config.LEDGERLY_AI_CLAUDE_SOFT_JOBS_PER_HOUR;
  }

  private async stats() {
    const result = await this.db.query<ProviderStatsRow>(`
      SELECT provider_internal AS provider,
             COUNT(*)::int AS jobs,
             COUNT(*) FILTER (WHERE status='succeeded')::int AS successes,
             COUNT(*) FILTER (WHERE status='failed')::int AS failures,
             AVG(EXTRACT(EPOCH FROM (completed_at-started_at))*1000)
               FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL) AS "averageDurationMs"
        FROM lai_provider_executions
       WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
       GROUP BY provider_internal
    `);
    return new Map(result.rows.map((row) => [row.provider, {
      provider: row.provider,
      jobs: Number(row.jobs),
      successes: Number(row.successes),
      failures: Number(row.failures),
      averageDurationMs: row.averageDurationMs === null ? null : Number(row.averageDurationMs),
    }]));
  }

  async diagnostics(): Promise<ProviderDiagnostics[]> {
    const stats = await this.stats();
    const queue = this.queueState();
    const values: ProviderDiagnostics[] = [];
    for (const provider of this.providers.values()) {
      const health = await provider.health();
      const row = stats.get(provider.id);
      const jobs = row?.jobs ?? 0;
      const successes = row?.successes ?? 0;
      const failures = row?.failures ?? 0;
      values.push({
        ...health,
        active: queue.active,
        queued: queue.queued,
        jobsLastHour: jobs,
        successesLastHour: successes,
        failuresLastHour: failures,
        successRate: successes + failures ? successes / (successes + failures) : null,
        averageDurationMs: row?.averageDurationMs ?? null,
        softJobsPerHour: this.softLimit(provider.id),
      });
    }
    return values;
  }

  async rank(taskKind: LedgerlyAiTaskKind): Promise<LedgerlyAiProviderId[]> {
    const diagnostics = await this.diagnostics();
    const scored = diagnostics
      .filter((item) => {
        const provider = this.providers.get(item.provider);
        if (!provider?.capabilities.has(taskKind) || !item.executable || !item.sessionConfigured) return false;
        return item.softJobsPerHour === 0 || item.jobsLastHour < item.softJobsPerHour;
      })
      .map((item) => {
        let score = item.available ? 100 : 0;
        if (item.provider === this.config.LEDGERLY_AI_DEFAULT_PROVIDER) score += 8;
        if (["code", "engineering", "testing"].includes(taskKind) && item.provider === "codex") score += 15;
        if (["analysis", "report", "research"].includes(taskKind) && item.provider === "claude-code") score += 8;
        if (item.successRate !== null) score += item.successRate * 20;
        if (item.averageDurationMs !== null) score -= Math.min(10, item.averageDurationMs / 60_000);
        if (item.softJobsPerHour > 0) score -= (item.jobsLastHour / item.softJobsPerHour) * 20;
        return { provider: item.provider, score };
      })
      .sort((a, b) => b.score - a.score);

    if (!scored.length) {
      return [this.config.LEDGERLY_AI_DEFAULT_PROVIDER, this.config.LEDGERLY_AI_FALLBACK_PROVIDER]
        .filter((value, index, all) => all.indexOf(value) === index);
    }
    return scored.map((item) => item.provider);
  }
}

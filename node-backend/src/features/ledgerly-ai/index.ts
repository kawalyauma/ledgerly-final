import type { BackendFeature } from "../types.js";
import { createLedgerlyAiRoutes } from "./routes.js";
import { getLedgerlyAiFoundationService } from "./runtime-service.js";
import {
  executeCustomAgentRun,
  scanCustomAgentTriggers,
} from "./custom-runtime/jobs.js";
import { processLedgerlyAiIncident, recoverLedgerlyAiIncidents } from "./incidents/jobs.js";
import { syncLedgerlyAiGitCi } from "./git/jobs.js";
import {
  scanLedgerlyAiMonitoring,
  generateLedgerlyAiDailyHealth,
  generateLedgerlyAiWeeklyHealth,
} from "./monitoring/jobs.js";

export const ledgerlyAiFeature: BackendFeature = {
  key: "ledgerly-ai",
  version: "0.18.0",
  mount(app, runtime) {
    const service = getLedgerlyAiFoundationService(runtime);
    void service.start().catch(() => undefined);
    app.route("/api/v1/ledgerly-ai", createLedgerlyAiRoutes(service));
  },
  registerJobs(registry) {
    registry.register("ledgerly-ai.custom-agent.scan", scanCustomAgentTriggers);
    registry.register("ledgerly-ai.custom-agent.run", executeCustomAgentRun);
    registry.register("ledgerly-ai.incident.process", processLedgerlyAiIncident);
    registry.register("ledgerly-ai.incident.recover", recoverLedgerlyAiIncidents);
    registry.register("ledgerly-ai.git.ci-sync", syncLedgerlyAiGitCi);
    registry.register("ledgerly-ai.monitor.scan", scanLedgerlyAiMonitoring);
    registry.register("ledgerly-ai.monitor.daily", generateLedgerlyAiDailyHealth);
    registry.register("ledgerly-ai.monitor.weekly", generateLedgerlyAiWeeklyHealth);
  },
  schedules: [
    {
      name: "ledgerly-ai-incident-recovery",
      cron: "* * * * *",
      kind: "ledgerly-ai.incident.recover",
      queue: "ledgerly-ai",
      maxAttempts: 3,
    },
    {
      name: "ledgerly-ai-custom-agent-scan",
      cron: "* * * * *",
      kind: "ledgerly-ai.custom-agent.scan",
      queue: "ledgerly-ai",
      maxAttempts: 3,
    },
    {
      name: "ledgerly-ai-git-ci-sync",
      cron: "*/2 * * * *",
      kind: "ledgerly-ai.git.ci-sync",
      queue: "ledgerly-ai",
      maxAttempts: 3,
    },
    {
      name: "ledgerly-ai-monitor-scan",
      cron: "*/5 * * * *",
      kind: "ledgerly-ai.monitor.scan",
      queue: "ledgerly-ai",
      maxAttempts: 3,
    },
    {
      name: "ledgerly-ai-daily-engineering-health",
      cron: "30 6 * * *",
      kind: "ledgerly-ai.monitor.daily",
      queue: "ledgerly-ai",
      maxAttempts: 3,
    },
    {
      name: "ledgerly-ai-weekly-engineering-health",
      cron: "40 6 * * 1",
      kind: "ledgerly-ai.monitor.weekly",
      queue: "ledgerly-ai",
      maxAttempts: 3,
    },
  ],
};

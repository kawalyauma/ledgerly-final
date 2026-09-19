import type { BackendFeature } from "../types.js";
import { createLedgerlyAiRoutes } from "./routes.js";
import { getLedgerlyAiFoundationService } from "./runtime-service.js";
import {
  executeCustomAgentRun,
  scanCustomAgentTriggers,
} from "./custom-runtime/jobs.js";
import { processLedgerlyAiIncident } from "./incidents/jobs.js";

export const ledgerlyAiFeature: BackendFeature = {
  key: "ledgerly-ai",
  version: "0.10.0",
  mount(app, runtime) {
    const service = getLedgerlyAiFoundationService(runtime);
    void service.start().catch(() => undefined);
    app.route("/api/v1/ledgerly-ai", createLedgerlyAiRoutes(service));
  },
  registerJobs(registry) {
    registry.register("ledgerly-ai.custom-agent.scan", scanCustomAgentTriggers);
    registry.register("ledgerly-ai.custom-agent.run", executeCustomAgentRun);
    registry.register("ledgerly-ai.incident.process", processLedgerlyAiIncident);
  },
  schedules: [{
    name: "ledgerly-ai-custom-agent-scan",
    cron: "* * * * *",
    kind: "ledgerly-ai.custom-agent.scan",
    queue: "ledgerly-ai",
    maxAttempts: 3,
  }],
};

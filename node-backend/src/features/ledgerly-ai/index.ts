import type { BackendFeature } from "../types.js";
import { createLedgerlyAiRoutes } from "./routes.js";
import { getLedgerlyAiFoundationService } from "./runtime-service.js";

export const ledgerlyAiFeature: BackendFeature = {
  key: "ledgerly-ai",
  version: "0.7.0",
  mount(app, runtime) {
    const service = getLedgerlyAiFoundationService(runtime);
    void service.start().catch(() => undefined);
    app.route("/api/v1/ledgerly-ai", createLedgerlyAiRoutes(service));
  },
};

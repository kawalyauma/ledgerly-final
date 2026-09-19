import type { BackendFeature } from "../types.js";
import { createLedgerlyAiRoutes } from "./routes.js";
import { LedgerlyAiFoundationService } from "./service.js";

export const ledgerlyAiFeature: BackendFeature = {
  key: "ledgerly-ai",
  version: "0.4.0",
  mount(app, runtime) {
    const service = new LedgerlyAiFoundationService(runtime);
    service.start();
    app.route("/api/v1/ledgerly-ai", createLedgerlyAiRoutes(service));
  },
};

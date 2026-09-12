import type { BackendFeature } from "../types.js";
import { handleFinanceMobileIntents } from "./intents.js";
import { createFinanceMobileRoutes } from "./routes.js";

export const financeMobileFeature: BackendFeature = {
  key: "finance-mobile",
  version: "1.0.0",
  mount(app,runtime){ app.route("/api/v1/finance-mobile",createFinanceMobileRoutes(runtime)); },
  registerJobs(registry){ registry.register("finance-mobile.intents",handleFinanceMobileIntents); },
  schedules:[{name:"finance-mobile-intents",cron:"* * * * *",kind:"finance-mobile.intents",queue:"finance-mobile",maxAttempts:3}],
};

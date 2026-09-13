import type { BackendFeature } from "../types.js";
import { recoverSchoolPayTransactions } from "./jobs.js";
import { createSchoolPayAdminRoutes, createSchoolPayWebhookRoutes } from "./routes.js";

export const schoolPayFeature: BackendFeature = {
  key: "schoolpay",
  version: "1.1.0",
  mount(app, runtime) {
    app.route("/api/v1/schoolpay", createSchoolPayAdminRoutes(runtime));
    app.route("/webhooks/schoolpay", createSchoolPayWebhookRoutes(runtime));
  },
  registerJobs(registry) { registry.register("schoolpay.reconcile", recoverSchoolPayTransactions); },
  schedules: [{ name: "schoolpay-reconciliation", cron: "15 * * * *", kind: "schoolpay.reconcile", queue: "school", maxAttempts: 2 }],
};

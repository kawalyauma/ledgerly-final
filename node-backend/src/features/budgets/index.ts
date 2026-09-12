import type { BackendFeature } from "../types.js";
import { requireAuth } from "../core-identity/security.js";
import { createBudgetRoutes } from "./routes.js";
import { refreshEligibleBudgets } from "./service.js";

export const budgetsFeature: BackendFeature = {
  key: "budgets",
  version: "1.0.0",
  mount(app, runtime) {
    const auth = requireAuth(runtime);
    app.use("/api/v1/budgets", auth);
    app.use("/api/v1/budgets/*", auth);
    app.route("/api/v1/budgets", createBudgetRoutes(runtime));
  },
  registerJobs(registry) {
    registry.register("budgets.refresh-actuals", async (_job, runtime) => {
      const count = await refreshEligibleBudgets(runtime);
      runtime.logger.info({ count }, "Budget actuals refreshed");
    });
  },
  schedules: [{ name: "budget-actuals-refresh", cron: "0 * * * *", kind: "budgets.refresh-actuals", queue: "finance", maxAttempts: 5 }],
};

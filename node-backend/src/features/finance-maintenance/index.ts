import type { BackendFeature } from "../types.js";
import { createFinanceMaintenanceRoutes } from "./routes.js";

export const financeMaintenanceFeature: BackendFeature = {
  key: "finance-maintenance",
  version: "1.0.0",
  mount(app,runtime){ app.route("/api/v1/finance-maintenance",createFinanceMaintenanceRoutes(runtime)); },
};

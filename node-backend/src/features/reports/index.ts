import type { BackendFeature } from "../types.js";
import { handleReportExport } from "./jobs.js";
import { createReportRoutes } from "./routes.js";

export const reportsFeature: BackendFeature = {
  key: "reports",
  version: "1.0.0",
  mount(app, runtime) {
    app.route("/api/v1/reports", createReportRoutes(runtime));
  },
  registerJobs(registry) {
    registry.register("report.export", handleReportExport);
  },
};

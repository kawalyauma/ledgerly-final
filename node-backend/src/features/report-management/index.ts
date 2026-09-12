import type { BackendFeature } from "../types.js";
import { handleReportScheduleScan } from "./jobs.js";
import { createDashboardRoutes, createReportLibraryRoutes, createReportScheduleRoutes } from "./routes.js";

export const reportManagementFeature: BackendFeature = {
  key: "report-management",
  version: "1.0.0",
  mount(app,runtime){
    app.route("/api/v1/report-library",createReportLibraryRoutes(runtime));
    app.route("/api/v1/report-schedules",createReportScheduleRoutes(runtime));
    app.route("/api/v1/dashboards",createDashboardRoutes(runtime));
  },
  registerJobs(registry){ registry.register("report.schedule.scan",handleReportScheduleScan); },
  schedules:[{name:"report-schedule-scan",cron:"* * * * *",kind:"report.schedule.scan",queue:"reports",maxAttempts:3}],
};

import type { BackendModuleDefinition } from "../../backend-types";
import { agenticEmployeeRoutes } from "./routes";
import { agenticExecutionRoutes } from "./execution-routes";
import { agenticProactiveRoutes } from "./proactive-routes";
import { agenticFamilyReportRoutes } from "./family-report-routes";
import { agenticEventRoutes } from "./event-routes";
import { runDueProactiveSchedules } from "./proactive-scheduler";
import { processEventInbox } from "./event-processor";

export const moduleDefinition: BackendModuleDefinition = {
  key: "agentic-employees",
  name: "AI Employees",
  version: "1.3.0",
  order: 75,
  routes: [
    { basePath: "/api/v1/agentic-employees", router: agenticEmployeeRoutes },
    { basePath: "/api/v1/agentic-employees", router: agenticExecutionRoutes },
    { basePath: "/api/v1/agentic-employees", router: agenticProactiveRoutes },
    { basePath: "/api/v1/agentic-employees", router: agenticFamilyReportRoutes },
    { basePath: "/api/v1/agentic-employees", router: agenticEventRoutes },
  ],
  scheduled: async env => {
    await processEventInbox(env);
    await runDueProactiveSchedules(env);
  },
};

import type { BackendModuleDefinition } from "../../backend-types";
import { agenticEmployeeRoutes } from "./routes";
import { agenticExecutionRoutes } from "./execution-routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "agentic-employees",
  name: "AI Employees",
  version: "1.1.0",
  order: 75,
  routes: [
    { basePath: "/api/v1/agentic-employees", router: agenticEmployeeRoutes },
    { basePath: "/api/v1/agentic-employees", router: agenticExecutionRoutes },
  ],
};

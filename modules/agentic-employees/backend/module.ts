import type { BackendModuleDefinition } from "../../backend-types";
import { agenticEmployeeRoutes } from "./routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "agentic-employees",
  name: "AI Employees",
  version: "1.0.0",
  order: 75,
  routes: [{ basePath: "/api/v1/agentic-employees", router: agenticEmployeeRoutes }],
};

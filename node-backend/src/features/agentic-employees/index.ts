import type { BackendFeature } from "../types.js";
import type { NodeApp } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createD1Compat } from "./d1-compat.js";
import { createAgentSystemGateway } from "./system-gateway.js";
import { agenticEmployeeRoutes } from "./routes.js";
import { agenticProviderRoutes } from "./provider-routes.js";
import { agenticExecutionRoutes } from "./execution-routes.js";
import { agenticActionRoutes } from "./action-routes.js";
import { agenticMemoryRoutes } from "./memory-routes.js";

export const agenticEmployeesFeature: BackendFeature = {
  key: "agentic-employees",
  version: "1.9.0-node",
  mount(app: NodeApp, runtime: Runtime) {
    const d1 = createD1Compat(runtime.db);
    const agenticEnv: Record<string, any> = {
      FINANCE_DB: d1,
      ENVIRONMENT: runtime.config.NODE_ENV,
      OPENAI_API_KEY: runtime.config.OPENAI_API_KEY,
      OPENAI_BASE_URL: runtime.config.OPENAI_BASE_URL,
      OPENAI_MODEL_LUNA: runtime.config.OPENAI_MODEL_LUNA,
      OPENAI_MODEL_TERRA: runtime.config.OPENAI_MODEL_TERRA,
      OPENAI_MODEL_SOL: runtime.config.OPENAI_MODEL_SOL,
      AI_PROVIDER_ENCRYPTION_KEY: runtime.config.AI_PROVIDER_ENCRYPTION_KEY,
    };
    agenticEnv.AGENT_SYSTEM_GATEWAY = createAgentSystemGateway(app, runtime.config.JWT_SECRET, runtime.config.JWT_ISSUER, runtime.config.JWT_AUDIENCE);

    app.use("/api/v1/agentic-employees/*", async (c, next) => {
      (c as any).env = agenticEnv;
      await next();
    });
    app.route("/api/v1/agentic-employees", agenticProviderRoutes as any);
    app.route("/api/v1/agentic-employees", agenticEmployeeRoutes as any);
    app.route("/api/v1/agentic-employees", agenticExecutionRoutes as any);
    app.route("/api/v1/agentic-employees", agenticActionRoutes as any);
    app.route("/api/v1/agentic-employees", agenticMemoryRoutes as any);
  },
};

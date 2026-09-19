import type { BackendFeature } from "../types.js";
import type { NodeApp } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createD1Compat } from "./d1-compat.js";
import { createAgentSystemGateway } from "./system-gateway.js";
import { createAgentDocumentService } from "./document-service.js";
import { agenticEmployeeRoutes } from "./routes.js";
import { agenticProviderRoutes } from "./provider-routes.js";
import { agenticExecutionRoutes } from "./execution-routes.js";
import { agenticActionRoutes } from "./action-routes.js";
import { agenticMemoryRoutes } from "./memory-routes.js";
import { agenticChatStudioRoutes } from "./chat-studio-routes.js";
import { agenticLightRoutes } from "./light-routes.js";
import { agenticDocumentRoutes } from "./document-routes.js";
import { getLedgerlyAiFoundationService } from "../ledgerly-ai/runtime-service.js";
import { AgenticLedgerlyAiBridge } from "./ledgerly-ai-bridge.js";
import { createLegacyEmployeeDelegationTool } from "./ledgerly-ai-tool.js";
import { agenticIntegrationRoutes } from "./integration-routes.js";

function createBucketAdapter(runtime:Runtime){return{
  async put(key:string,body:Uint8Array|ArrayBuffer,options?:any){const bytes=body instanceof Uint8Array?body:new Uint8Array(body);await runtime.storage.put(key,bytes,options?.httpMetadata?.contentType||options?.contentType);return{};},
  async get(key:string){const bytes=await runtime.storage.get(key);if(!bytes)return null;return{size:bytes.byteLength,body:bytes,async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};},
  async delete(key:string){await runtime.storage.delete(key);},
};}

export const agenticEmployeesFeature: BackendFeature = {
  key: "agentic-employees",
  version: "2.9.0-node",
  mount(app: NodeApp, runtime: Runtime) {
    const d1 = createD1Compat(runtime.db);
    const workBucket=createBucketAdapter(runtime);
    const ledgerlyAi=getLedgerlyAiFoundationService(runtime);
    const bridge=new AgenticLedgerlyAiBridge(runtime,ledgerlyAi);
    const agenticEnv: Record<string, any> = {
      FINANCE_DB: d1,
      ENVIRONMENT: runtime.config.NODE_ENV,
      RESPONSE_INTELLIGENCE_URL: runtime.config.RESPONSE_INTELLIGENCE_URL,
      RESPONSE_INTELLIGENCE_TOKEN: runtime.config.RESPONSE_INTELLIGENCE_TOKEN,
      RESPONSE_INTELLIGENCE_TIMEOUT_MS: runtime.config.RESPONSE_INTELLIGENCE_TIMEOUT_MS,
      WORK_FILES_BUCKET: workBucket,
      AGENT_DOCUMENT_SERVICE: createAgentDocumentService(runtime.storage),
      LEDGERLY_AI_AGENTIC_BRIDGE: bridge,
    };
    if (!ledgerlyAi.tools.registry.has("agent.delegate.legacy")) {
      ledgerlyAi.tools.registry.register(createLegacyEmployeeDelegationTool(bridge,d1,agenticEnv));
    }
    agenticEnv.AGENT_SYSTEM_GATEWAY = createAgentSystemGateway(app, runtime.config.JWT_SECRET, runtime.config.JWT_ISSUER, runtime.config.JWT_AUDIENCE);

    app.use("/api/v1/agentic-employees/*", async (c, next) => {
      (c as any).env = agenticEnv;
      await next();
    });
    app.route("/api/v1/agentic-employees", agenticProviderRoutes as any);
    app.route("/api/v1/agentic-employees", agenticEmployeeRoutes as any);
    app.route("/api/v1/agentic-employees", agenticExecutionRoutes as any);
    app.route("/api/v1/agentic-employees", agenticActionRoutes as any);
    app.route("/api/v1/agentic-employees", agenticChatStudioRoutes as any);
    app.route("/api/v1/agentic-employees", agenticLightRoutes as any);
    app.route("/api/v1/agentic-employees", agenticDocumentRoutes as any);
    app.route("/api/v1/agentic-employees", agenticMemoryRoutes as any);
    app.route("/api/v1/agentic-employees", agenticIntegrationRoutes as any);
  },
};

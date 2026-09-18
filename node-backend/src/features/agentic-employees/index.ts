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

function createBucketAdapter(runtime:Runtime){return{
  async put(key:string,body:Uint8Array|ArrayBuffer,options?:any){const bytes=body instanceof Uint8Array?body:new Uint8Array(body);await runtime.storage.put(key,bytes,options?.httpMetadata?.contentType||options?.contentType);return{};},
  async get(key:string){const bytes=await runtime.storage.get(key);if(!bytes)return null;return{size:bytes.byteLength,body:bytes,async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);}};},
  async delete(key:string){await runtime.storage.delete(key);},
};}

export const agenticEmployeesFeature: BackendFeature = {
  key: "agentic-employees",
  version: "2.5.0-node",
  mount(app: NodeApp, runtime: Runtime) {
    const d1 = createD1Compat(runtime.db);
    const workBucket=createBucketAdapter(runtime);
    const agenticEnv: Record<string, any> = {
      FINANCE_DB: d1,
      ENVIRONMENT: runtime.config.NODE_ENV,
      OPENAI_API_KEY: runtime.config.OPENAI_API_KEY,
      OPENAI_BASE_URL: runtime.config.OPENAI_BASE_URL,
      OPENAI_MODEL_LUNA: runtime.config.OPENAI_MODEL_LUNA,
      OPENAI_MODEL_TERRA: runtime.config.OPENAI_MODEL_TERRA,
      OPENAI_MODEL_SOL: runtime.config.OPENAI_MODEL_SOL,
      AI_PROVIDER_ENCRYPTION_KEY: runtime.config.AI_PROVIDER_ENCRYPTION_KEY,
      WORK_FILES_BUCKET: workBucket,
      AGENT_DOCUMENT_SERVICE: createAgentDocumentService(runtime.storage),
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
    app.route("/api/v1/agentic-employees", agenticChatStudioRoutes as any);
    app.route("/api/v1/agentic-employees", agenticLightRoutes as any);
    app.route("/api/v1/agentic-employees", agenticDocumentRoutes as any);
    app.route("/api/v1/agentic-employees", agenticMemoryRoutes as any);
  },
};

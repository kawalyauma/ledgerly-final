import type { BackendFeature } from "../types.js";
import { createIntegrationRoutes } from "./routes.js";
import { handleWebhookDelivery } from "./service.js";

export const integrationsFeature: BackendFeature = {
  key: "integrations",
  version: "1.0.0",
  mount(app,runtime){ app.route("/api/v1/integrations",createIntegrationRoutes(runtime)); },
  registerJobs(registry){ registry.register("webhook.deliver",handleWebhookDelivery); },
};

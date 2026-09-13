import type { BackendFeature } from "../types.js";
import { createCommunicationRoutes } from "./routes.js";
import { dispatchCommunicationCampaign } from "./jobs.js";

export const communicationsFeature: BackendFeature = {
  key: "communications",
  version: "1.1.0",
  mount(app,runtime){
    app.route("/api/v1/communications",createCommunicationRoutes(runtime));
  },
  registerJobs(registry){
    registry.register("communications.dispatch",dispatchCommunicationCampaign);
  },
};

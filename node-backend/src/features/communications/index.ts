import type { BackendFeature } from "../types.js";
import { createCommunicationRoutes } from "./routes.js";

export const communicationsFeature: BackendFeature = {
  key: "communications",
  version: "1.0.0",
  mount(app,runtime){
    app.route("/api/v1/communications",createCommunicationRoutes(runtime));
  },
};

import type { BackendFeature } from "../types.js";
import { createTransportRoutes } from "./routes.js";

export const transportFeature: BackendFeature = {
  key: "school-transport",
  version: "1.0.0",
  mount(app,runtime){ app.route("/api/v1/transport",createTransportRoutes(runtime)); },
};

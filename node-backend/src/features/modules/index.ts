import type { BackendFeature } from "../types.js";
import { createModuleRoutes } from "./routes.js";

export const modulesFeature: BackendFeature = {
  key: "modules",
  version: "1.0.0",
  mount(app,runtime){ app.route("/api/v1/modules",createModuleRoutes(runtime)); },
};

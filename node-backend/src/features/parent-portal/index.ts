import type { BackendFeature } from "../types.js";
import { createParentPortalRoutes } from "./routes.js";

export const parentPortalFeature: BackendFeature = {
  key: "parent-portal",
  version: "1.0.0",
  mount(app, runtime) {
    app.route("/api/v1/parent-portal", createParentPortalRoutes(runtime));
  },
};

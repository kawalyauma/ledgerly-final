import type { BackendFeature } from "../types.js";
import { createParentPortalRoutes } from "./routes.js";
import { createParentPortalParityRoutes } from "./parity.js";
import { createParentPortalAcademicRoutes } from "./academics.js";

export const parentPortalFeature: BackendFeature = {
  key: "parent-portal",
  version: "1.2.0",
  mount(app, runtime) {
    app.route("/api/v1/parent-portal", createParentPortalAcademicRoutes(runtime));
    app.route("/api/v1/parent-portal", createParentPortalParityRoutes(runtime));
    app.route("/api/v1/parent-portal", createParentPortalRoutes(runtime));
  },
};

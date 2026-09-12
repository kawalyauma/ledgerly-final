import type { BackendFeature } from "../types.js";
import { createAdminRoutes, createAuthRoutes, createOrganizationRoutes } from "./routes.js";
import { requireAuth } from "./security.js";

export const coreIdentityFeature: BackendFeature = {
  key: "core-identity",
  version: "1.0.0",
  mount(app, runtime) {
    app.route("/auth", createAuthRoutes(runtime));
    const auth = requireAuth(runtime);
    app.use("/api/v1/organizations", auth);
    app.use("/api/v1/organizations/*", auth);
    app.use("/api/v1/admin", auth);
    app.use("/api/v1/admin/*", auth);
    app.route("/api/v1/organizations", createOrganizationRoutes(runtime));
    app.route("/api/v1/admin", createAdminRoutes(runtime));
  },
};

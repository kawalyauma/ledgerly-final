import type { BackendFeature } from "../types.js";
import { requireAuth } from "../core-identity/security.js";
import { createDimensionRoutes, createProjectRoutes } from "./routes.js";

export const dimensionsProjectsFeature:BackendFeature={
 key:"dimensions-projects",version:"1.0.0",
 mount(app,runtime){const auth=requireAuth(runtime);app.use("/api/v1/dimensions",auth);app.use("/api/v1/dimensions/*",auth);app.use("/api/v1/projects",auth);app.use("/api/v1/projects/*",auth);app.route("/api/v1/dimensions",createDimensionRoutes(runtime));app.route("/api/v1/projects",createProjectRoutes(runtime));},
};

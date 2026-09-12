import type { BackendFeature } from "../types.js";
import { requireAuth } from "../core-identity/security.js";
import { createComplianceRoutes } from "./routes.js";

export const complianceFeature:BackendFeature={key:"compliance",version:"1.0.0",mount(app,runtime){const auth=requireAuth(runtime);app.use("/api/v1/compliance",auth);app.use("/api/v1/compliance/*",auth);app.route("/api/v1/compliance",createComplianceRoutes(runtime));}};

import type { BackendFeature } from "../types.js";
import { requireAuth } from "../core-identity/security.js";
import { createTaxRoutes } from "./routes.js";

export const taxFeature:BackendFeature={key:"tax",version:"1.0.0",mount(app,runtime){const auth=requireAuth(runtime);app.use("/api/v1/tax",auth);app.use("/api/v1/tax/*",auth);app.route("/api/v1/tax",createTaxRoutes(runtime));}};

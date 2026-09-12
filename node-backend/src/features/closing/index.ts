import type { BackendFeature } from "../types.js";
import { requireAuth } from "../core-identity/security.js";
import { createClosingRoutes } from "./routes.js";

export const closingFeature:BackendFeature={key:"closing",version:"1.0.0",mount(app,runtime){const auth=requireAuth(runtime);app.use("/api/v1/closing",auth);app.use("/api/v1/closing/*",auth);app.route("/api/v1/closing",createClosingRoutes(runtime));}};

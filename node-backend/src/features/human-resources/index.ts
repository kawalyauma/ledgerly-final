import type { BackendFeature } from "../types.js";
import { createHumanResourcesRoutes } from "./routes.js";
export const humanResourcesFeature: BackendFeature = {key:"human-resources",version:"1.0.0",mount(app,runtime){app.route("/api/v1/human-resources",createHumanResourcesRoutes(runtime));}};

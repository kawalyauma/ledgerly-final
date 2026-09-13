import type { BackendFeature } from "../types.js";
import { createHumanResourcesRoutes } from "./routes.js";
import { createHumanResourcesWorkflowRoutes } from "./workflows.js";
export const humanResourcesFeature: BackendFeature = {key:"human-resources",version:"1.1.0",mount(app,runtime){app.route("/api/v1/human-resources",createHumanResourcesRoutes(runtime));app.route("/api/v1/human-resources",createHumanResourcesWorkflowRoutes(runtime));}};

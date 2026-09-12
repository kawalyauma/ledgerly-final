import type { BackendFeature } from "../types.js";
import { createSchoolRoutes } from "./routes.js";

export const schoolFeature: BackendFeature = {
  key: "school-management",
  version: "2.0.0",
  mount(app,runtime){ app.route("/api/v1/school",createSchoolRoutes(runtime)); },
};

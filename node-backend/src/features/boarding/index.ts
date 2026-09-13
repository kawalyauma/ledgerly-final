import type { BackendFeature } from "../types.js";
import { createBoardingRoutes } from "./routes.js";

export const boardingFeature: BackendFeature = {
  key: "school-boarding",
  version: "1.0.0",
  mount(app,runtime){ app.route("/api/v1/boarding",createBoardingRoutes(runtime)); },
};

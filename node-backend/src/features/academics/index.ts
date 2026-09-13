import type { BackendFeature } from "../types.js";
import { createAcademicsRoutes } from "./routes.js";

export const academicsFeature: BackendFeature = {
  key: "academics",
  version: "1.0.0",
  mount(app,runtime){ app.route("/api/v1/academics",createAcademicsRoutes(runtime)); },
};

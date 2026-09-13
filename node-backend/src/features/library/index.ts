import type { BackendFeature } from "../types.js";
import { createLibraryRoutes } from "./routes.js";

export const libraryFeature: BackendFeature = {
  key: "school-library",
  version: "1.0.0",
  mount(app,runtime){ app.route("/api/v1/library",createLibraryRoutes(runtime)); },
};

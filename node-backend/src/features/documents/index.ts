import type { BackendFeature } from "../types.js";
import { createDocumentRoutes } from "./routes.js";

export const documentsFeature: BackendFeature = {
  key: "documents",
  version: "1.0.0",
  mount(app, runtime) {
    app.route("/api/v1/documents", createDocumentRoutes(runtime));
  },
};

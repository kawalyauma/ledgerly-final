import type { BackendFeature } from "../types.js";
import { createDocumentOperationsRoutes, createDocumentOutputRoutes } from "./routes.js";

export const documentOutputFeature: BackendFeature = {
  key: "document-output",
  version: "1.0.0",
  mount(app,runtime){
    app.route("/api/v1/documents",createDocumentOutputRoutes(runtime));
    app.route("/api/v1/operations",createDocumentOperationsRoutes(runtime));
  },
};

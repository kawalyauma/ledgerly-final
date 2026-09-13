import type { BackendFeature } from "../types.js";
import { createBookRoutes } from "./routes.js";

export const booksFeature: BackendFeature = {
  key: "books",
  version: "2.0.0",
  mount(app,runtime){ app.route("/api/v1/books",createBookRoutes(runtime)); },
};

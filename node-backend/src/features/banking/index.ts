import type { BackendFeature } from "../types.js";
import { createBankingRoutes } from "./routes.js";

export const bankingFeature: BackendFeature = {
  key: "banking",
  version: "1.0.0",
  mount(app, runtime) {
    app.route("/api/v1/banking", createBankingRoutes(runtime));
  },
};

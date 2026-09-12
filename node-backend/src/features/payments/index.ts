import type { BackendFeature } from "../types.js";
import { createPaymentRoutes } from "./routes.js";

export const paymentsFeature: BackendFeature = {
  key: "payments",
  version: "1.0.0",
  mount(app, runtime) {
    app.route("/api/v1/payments", createPaymentRoutes(runtime));
  },
};

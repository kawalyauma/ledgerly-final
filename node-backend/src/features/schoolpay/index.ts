import type { BackendFeature } from "../types.js";
import { createSchoolPayAdminRoutes, createSchoolPayWebhookRoutes } from "./routes.js";

export const schoolPayFeature: BackendFeature = {
  key: "schoolpay",
  version: "1.0.0",
  mount(app, runtime) {
    app.route("/api/v1/schoolpay", createSchoolPayAdminRoutes(runtime));
    app.route("/webhooks/schoolpay", createSchoolPayWebhookRoutes(runtime));
  },
};

import type { BackendFeature } from "../types.js";
import { createParentPortalRoutes } from "./routes.js";
import { createParentPortalParityRoutes } from "./parity.js";
import { createParentPortalAcademicRoutes } from "./academics.js";
import { createParentPortalConsentRoutes } from "./consents.js";
import { createParentPortalMessagingHomeworkRoutes } from "./messages-homework.js";
import { createParentPortalDocumentFeeRoutes } from "./documents-fees.js";

export const parentPortalFeature: BackendFeature = {
  key: "parent-portal",
  version: "1.5.0",
  mount(app, runtime) {
    app.route("/api/v1/parent-portal", createParentPortalDocumentFeeRoutes(runtime));
    app.route("/api/v1/parent-portal", createParentPortalMessagingHomeworkRoutes(runtime));
    app.route("/api/v1/parent-portal", createParentPortalConsentRoutes(runtime));
    app.route("/api/v1/parent-portal", createParentPortalAcademicRoutes(runtime));
    app.route("/api/v1/parent-portal", createParentPortalParityRoutes(runtime));
    app.route("/api/v1/parent-portal", createParentPortalRoutes(runtime));
  },
};

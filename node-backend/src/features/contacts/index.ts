import type { BackendFeature } from "../types.js";
import { requireAuth } from "../core-identity/security.js";
import { createContactsRoutes } from "./routes.js";

export const contactsFeature: BackendFeature = {
  key: "contacts",
  version: "1.0.0",
  mount(app, runtime) {
    const auth = requireAuth(runtime);
    app.use("/api/v1/contacts", auth);
    app.use("/api/v1/contacts/*", auth);
    app.route("/api/v1/contacts", createContactsRoutes(runtime));
  },
};

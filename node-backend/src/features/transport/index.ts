import type { BackendFeature } from "../types.js";
import { createTransportRoutes } from "./routes.js";
import { createTransportAssignmentIntegrityRoutes } from "./assignment-integrity.js";
import { createTransportTripIntegrityRoutes } from "./trip-integrity.js";

export const transportFeature: BackendFeature = {
  key: "school-transport",
  version: "1.1.0",
  mount(app,runtime){
    app.route("/api/v1/transport",createTransportAssignmentIntegrityRoutes(runtime));
    app.route("/api/v1/transport",createTransportTripIntegrityRoutes(runtime));
    app.route("/api/v1/transport",createTransportRoutes(runtime));
  },
};

import type { BackendFeature } from "../types.js";
import { createMobileSyncPublicRoutes, createMobileSyncRoutes } from "./routes.js";

export const mobileSyncFeature: BackendFeature = {
  key: "mobile-sync",
  version: "1.0.0",
  mount(app,runtime){
    app.route("/api/v1/mobile-sync/offline",createMobileSyncPublicRoutes(runtime));
    app.route("/api/v1/mobile-sync",createMobileSyncRoutes(runtime));
  },
};

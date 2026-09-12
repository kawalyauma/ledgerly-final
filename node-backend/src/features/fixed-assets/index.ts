import type { BackendFeature } from "../types.js";
import { requireAuth } from "../core-identity/security.js";
import { createFixedAssetRoutes } from "./routes.js";

export const fixedAssetsFeature: BackendFeature = {
  key: "fixed-assets",
  version: "1.0.0",
  mount(app,runtime){
    const auth=requireAuth(runtime);
    app.use("/api/v1/fixed-assets",auth);
    app.use("/api/v1/fixed-assets/*",auth);
    app.route("/api/v1/fixed-assets",createFixedAssetRoutes(runtime));
  },
};

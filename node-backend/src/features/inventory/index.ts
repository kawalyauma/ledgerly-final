import type { BackendFeature } from "../types.js";
import { requireAuth } from "../core-identity/security.js";
import { createInventoryRoutes, createProductRoutes } from "./routes.js";
import { releaseExpiredReservations } from "./service.js";

export const inventoryFeature: BackendFeature = {
  key: "inventory",
  version: "1.0.0",
  mount(app, runtime) {
    const auth = requireAuth(runtime);
    app.use("/api/v1/products", auth); app.use("/api/v1/products/*", auth);
    app.use("/api/v1/inventory", auth); app.use("/api/v1/inventory/*", auth);
    app.route("/api/v1/products", createProductRoutes(runtime));
    app.route("/api/v1/inventory", createInventoryRoutes(runtime));
  },
  registerJobs(registry) {
    registry.register("inventory.release-expired-reservations", async (_job, runtime) => {
      const count = await releaseExpiredReservations(runtime);
      runtime.logger.info({ count }, "Expired inventory reservations released");
    });
  },
  schedules: [{ name: "inventory-release-expired-reservations", cron: "0 * * * *", kind: "inventory.release-expired-reservations", queue: "finance", maxAttempts: 5 }],
};

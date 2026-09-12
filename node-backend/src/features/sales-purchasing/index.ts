import type { BackendFeature } from "../types.js";
import { requireAuth } from "../core-identity/security.js";
import { createOperationsRoutes, createOrderRoutes } from "./routes.js";
import { processRecurringTemplates } from "./service.js";

export const salesPurchasingFeature:BackendFeature={
 key:"sales-purchasing",version:"1.0.0",
 mount(app,runtime){const auth=requireAuth(runtime);app.use("/api/v1/orders",auth);app.use("/api/v1/orders/*",auth);app.use("/api/v1/operations",auth);app.use("/api/v1/operations/*",auth);app.route("/api/v1/orders",createOrderRoutes(runtime));app.route("/api/v1/operations",createOperationsRoutes(runtime));},
 registerJobs(registry){registry.register("operations.process-recurring",async(_job,runtime)=>{const count=await processRecurringTemplates(runtime);runtime.logger.info({count},"Recurring finance transactions processed");});},
 schedules:[{name:"finance-recurring-transactions",cron:"0 * * * *",kind:"operations.process-recurring",queue:"finance",maxAttempts:5}],
};

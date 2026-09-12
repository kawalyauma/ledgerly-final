import type { BackendFeature } from "../types.js";
import { requireAuth } from "../core-identity/security.js";
import { createAccountsRoutes, createJournalRoutes } from "./routes.js";
import { provisionPendingOrganizations } from "./service.js";

export const financeCoreFeature:BackendFeature={
  key:"finance-core",
  version:"1.0.0",
  mount(app,runtime){
    const auth=requireAuth(runtime);
    app.use("/api/v1/accounts",auth); app.use("/api/v1/accounts/*",auth);
    app.use("/api/v1/journals",auth); app.use("/api/v1/journals/*",auth);
    app.route("/api/v1/accounts",createAccountsRoutes(runtime));
    app.route("/api/v1/journals",createJournalRoutes(runtime));
  },
  registerJobs(registry){registry.register("finance.provision-organizations",async(_job,runtime)=>{const count=await provisionPendingOrganizations(runtime);runtime.logger.info({count},"Finance organization provisioning completed");});},
  schedules:[{name:"finance-provision-organizations",cron:"* * * * *",kind:"finance.provision-organizations",queue:"finance",maxAttempts:8}],
};

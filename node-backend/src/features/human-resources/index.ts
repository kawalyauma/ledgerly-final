import type { BackendFeature } from "../types.js";
import { createHumanResourcesRoutes } from "./routes.js";
import { createHumanResourcesWorkflowRoutes } from "./workflows.js";
import { createHumanResourcesIntegrityRoutes } from "./integrity.js";
import { createHumanResourcesPeopleRoutes } from "./people.js";
import { handleHrMobileIntents } from "./mobile-intents.js";

export const humanResourcesFeature: BackendFeature = {
  key:"human-resources",
  version:"1.4.0",
  mount(app,runtime){
    app.route("/api/v1/human-resources",createHumanResourcesPeopleRoutes(runtime));
    app.route("/api/v1/human-resources",createHumanResourcesIntegrityRoutes(runtime));
    app.route("/api/v1/human-resources",createHumanResourcesRoutes(runtime));
    app.route("/api/v1/human-resources",createHumanResourcesWorkflowRoutes(runtime));
  },
  registerJobs(registry){registry.register("hr-mobile.intents",handleHrMobileIntents);},
  schedules:[{name:"hr-mobile-intents",cron:"* * * * *",kind:"hr-mobile.intents",queue:"hr-mobile",maxAttempts:3}]
};

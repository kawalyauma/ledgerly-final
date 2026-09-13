import type { BackendFeature } from "../types.js";
import { createCommunicationRoutes } from "./routes.js";
import { createCommunicationManagementRoutes } from "./management.js";
import { dispatchCommunicationCampaign, scheduleDueCommunicationCampaigns } from "./jobs.js";
import { retryFailedCommunicationDeliveries } from "./retry.js";

export const communicationsFeature: BackendFeature = {
  key: "communications",
  version: "1.3.0",
  mount(app,runtime){
    app.route("/api/v1/communications",createCommunicationRoutes(runtime));
    app.route("/api/v1/communications",createCommunicationManagementRoutes(runtime));
  },
  registerJobs(registry){
    registry.register("communications.dispatch",dispatchCommunicationCampaign);
    registry.register("communications.schedule_due",scheduleDueCommunicationCampaigns);
    registry.register("communications.retry_failed",retryFailedCommunicationDeliveries);
  },
  schedules:[
    {name:"communications-schedule-due",cron:"* * * * *",kind:"communications.schedule_due",queue:"communications",maxAttempts:4},
    {name:"communications-retry-failed",cron:"*/2 * * * *",kind:"communications.retry_failed",queue:"communications",maxAttempts:4},
  ],
};

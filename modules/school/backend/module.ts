import "./mobile-sync-adapter";
import "./mobile-sync-fees";
import type { BackendModuleDefinition } from "../../backend-types";
import { schoolRoutes } from "./index";
import { schoolMobilePinAdminRoutes,schoolMobilePinPublicRoutes } from "./mobile-pin";
import { runScheduledFeeBilling } from "./fees/billing";
import { processPendingOfflineFeeReceipts } from "./fees/offline-intents";

export const moduleDefinition: BackendModuleDefinition = {
  key:"school-management",
  name:"School Management",
  version:"1.11.0",
  order:20,
  publicRoutes:[{basePath:"/auth",router:schoolMobilePinPublicRoutes}],
  routes:[
    {basePath:"/api/v1/school",router:schoolRoutes},
    {basePath:"/api/v1/school/mobile-pin",router:schoolMobilePinAdminRoutes},
  ],
  scheduled:async env=>{
    await runScheduledFeeBilling(env.FINANCE_DB);
    await processPendingOfflineFeeReceipts(env.FINANCE_DB,100);
  },
};

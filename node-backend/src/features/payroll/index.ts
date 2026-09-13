import type { BackendFeature } from "../types.js";
import { createPayrollRoutes } from "./routes.js";
import { createPayrollAccountingRoutes } from "./accounting.js";
import { createPayrollPaymentRoutes } from "./payments.js";
import { createPayrollHardeningRoutes } from "./hardening.js";
import { createPayrollReversalHardeningRoutes } from "./reversal-hardening.js";
import { handlePayrollPaymentMobileIntents } from "./mobile-intents.js";

export const payrollFeature: BackendFeature = {
  key: "payroll",
  version: "1.4.0",
  mount(app,runtime){
    app.route("/api/v1/payroll",createPayrollRoutes(runtime));
    app.route("/api/v1/payroll",createPayrollReversalHardeningRoutes(runtime));
    app.route("/api/v1/payroll",createPayrollHardeningRoutes(runtime));
    app.route("/api/v1/payroll",createPayrollAccountingRoutes(runtime));
    app.route("/api/v1/payroll",createPayrollPaymentRoutes(runtime));
  },
  registerJobs(registry){registry.register("payroll-mobile.intents",handlePayrollPaymentMobileIntents);},
  schedules:[{name:"payroll-mobile-intents",cron:"* * * * *",kind:"payroll-mobile.intents",queue:"payroll-mobile",maxAttempts:3}]
};

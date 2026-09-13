import type { BackendFeature } from "../types.js";
import { createPayrollRoutes } from "./routes.js";
import { createPayrollAccountingRoutes } from "./accounting.js";
import { createPayrollPaymentRoutes } from "./payments.js";
import { createPayrollHardeningRoutes } from "./hardening.js";
import { createPayrollReversalHardeningRoutes } from "./reversal-hardening.js";

export const payrollFeature: BackendFeature = {
  key: "payroll",
  version: "1.3.0",
  mount(app,runtime){
    app.route("/api/v1/payroll",createPayrollRoutes(runtime));
    app.route("/api/v1/payroll",createPayrollReversalHardeningRoutes(runtime));
    app.route("/api/v1/payroll",createPayrollHardeningRoutes(runtime));
    app.route("/api/v1/payroll",createPayrollAccountingRoutes(runtime));
    app.route("/api/v1/payroll",createPayrollPaymentRoutes(runtime));
  },
};

import type { BackendFeature } from "../types.js";
import { createPayrollRoutes } from "./routes.js";
import { createPayrollAccountingRoutes } from "./accounting.js";
import { createPayrollPaymentRoutes } from "./payments.js";
export const payrollFeature: BackendFeature = {key:"payroll",version:"1.2.0",mount(app,runtime){app.route("/api/v1/payroll",createPayrollRoutes(runtime));app.route("/api/v1/payroll",createPayrollAccountingRoutes(runtime));app.route("/api/v1/payroll",createPayrollPaymentRoutes(runtime));}};

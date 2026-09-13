import type { BackendFeature } from "../types.js";
import { createPayrollRoutes } from "./routes.js";
import { createPayrollAccountingRoutes } from "./accounting.js";
export const payrollFeature: BackendFeature = {key:"payroll",version:"1.1.0",mount(app,runtime){app.route("/api/v1/payroll",createPayrollRoutes(runtime));app.route("/api/v1/payroll",createPayrollAccountingRoutes(runtime));}};

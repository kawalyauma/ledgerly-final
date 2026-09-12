import type { BackendFeature } from "../types.js";
import { createSchoolRoutes } from "./routes.js";
import { createStudentRoutes } from "./students.js";
import { createAdmissionRoutes } from "./admissions.js";
import { createSchoolIamRoutes } from "./iam.js";
import { createStaffRoutes } from "./staff.js";
import { createPromotionRoutes } from "./promotions.js";

export const schoolFeature: BackendFeature = {
  key: "school-management",
  version: "2.5.0",
  mount(app,runtime){
    app.route("/api/v1/school",createSchoolRoutes(runtime));
    app.route("/api/v1/school/student-management",createStudentRoutes(runtime));
    app.route("/api/v1/school/student-management",createAdmissionRoutes(runtime));
    app.route("/api/v1/school/iam",createSchoolIamRoutes(runtime));
    app.route("/api/v1/school/staff-management",createStaffRoutes(runtime));
    app.route("/api/v1/school/promotion",createPromotionRoutes(runtime));
  },
};

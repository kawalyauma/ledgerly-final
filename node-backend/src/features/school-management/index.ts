import type { BackendFeature } from "../types.js";
import { createSchoolRoutes } from "./routes.js";
import { createStudentRoutes } from "./students.js";
import { createAdmissionRoutes } from "./admissions.js";

export const schoolFeature: BackendFeature = {
  key: "school-management",
  version: "2.2.0",
  mount(app,runtime){
    app.route("/api/v1/school",createSchoolRoutes(runtime));
    app.route("/api/v1/school/student-management",createStudentRoutes(runtime));
    app.route("/api/v1/school/student-management",createAdmissionRoutes(runtime));
  },
};

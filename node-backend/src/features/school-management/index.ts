import type { BackendFeature } from "../types.js";
import { createSchoolRoutes } from "./routes.js";
import { createStudentRoutes } from "./students.js";

export const schoolFeature: BackendFeature = {
  key: "school-management",
  version: "2.1.0",
  mount(app,runtime){
    app.route("/api/v1/school",createSchoolRoutes(runtime));
    app.route("/api/v1/school/student-management",createStudentRoutes(runtime));
  },
};

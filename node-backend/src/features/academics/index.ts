import type { BackendFeature } from "../types.js";
import { createAcademicsRoutes } from "./routes.js";
import { createLessonPlanRoutes } from "./lesson-plans.js";
import { createAcademicSupervisionRoutes } from "./supervision.js";
import { createAcademicTimetableRoutes } from "./timetables.js";

export const academicsFeature: BackendFeature = {
  key: "academics",
  version: "1.2.0",
  mount(app,runtime){
    app.route("/api/v1/academics",createAcademicsRoutes(runtime));
    app.route("/api/v1/academics",createLessonPlanRoutes(runtime));
    app.route("/api/v1/academics",createAcademicSupervisionRoutes(runtime));
    app.route("/api/v1/academics",createAcademicTimetableRoutes(runtime));
  },
};

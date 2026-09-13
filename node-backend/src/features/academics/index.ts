import type { BackendFeature } from "../types.js";
import { createAcademicsRoutes } from "./routes.js";
import { createLessonPlanRoutes } from "./lesson-plans.js";
import { createAcademicSupervisionRoutes } from "./supervision.js";
import { createAcademicTimetableRoutes } from "./timetables.js";
import { createAcademicDeliveryRoutes } from "./delivery.js";

export const academicsFeature: BackendFeature = {
  key: "academics",
  version: "1.3.0",
  mount(app,runtime){
    app.route("/api/v1/academics",createAcademicsRoutes(runtime));
    app.route("/api/v1/academics",createLessonPlanRoutes(runtime));
    app.route("/api/v1/academics",createAcademicSupervisionRoutes(runtime));
    app.route("/api/v1/academics",createAcademicTimetableRoutes(runtime));
    app.route("/api/v1/academics",createAcademicDeliveryRoutes(runtime));
  },
};

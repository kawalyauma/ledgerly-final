import type { BackendFeature } from "../types.js";
import { createAcademicsRoutes } from "./routes.js";
import { createLearningCycleRoutes } from "./learning-cycle.js";
import { createAcademicSupervisionRoutes } from "./supervision.js";
import { createAcademicTimetableRoutes } from "./timetables.js";
import { createAcademicDeliveryRoutes } from "./delivery.js";
import { createAcademicAttachmentRoutes } from "./attachments.js";
import { createSupervisionComplianceRoutes } from "./compliance.js";
import { processLessonPlanOcrJob } from "./ocr-jobs.js";

export const academicsFeature: BackendFeature = {
  key: "academics",
  version: "2.1.0",
  mount(app,runtime){
    app.route("/api/v1/academics",createAcademicsRoutes(runtime));
    app.route("/api/v1/academics",createLearningCycleRoutes(runtime));
    app.route("/api/v1/academics",createAcademicSupervisionRoutes(runtime));
    app.route("/api/v1/academics",createAcademicTimetableRoutes(runtime));
    app.route("/api/v1/academics",createAcademicDeliveryRoutes(runtime));
    app.route("/api/v1/academics",createAcademicAttachmentRoutes(runtime));
    app.route("/api/v1/academics",createSupervisionComplianceRoutes(runtime));
  },
  registerJobs(registry){
    registry.register("academics.ocr.lesson_plan", processLessonPlanOcrJob);
  },
};

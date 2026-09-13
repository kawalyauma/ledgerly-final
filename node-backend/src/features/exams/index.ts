import type { BackendFeature } from "../types.js";
import { createExamRoutes } from "./routes.js";
import { createExamSetupRoutes } from "./setup.js";
import { createExamMarkRoutes } from "./marks.js";
import { createExamReportRoutes } from "./reports.js";
import { createExamFinalizationRoutes } from "./finalization.js";
import { createExamParityRoutes } from "./parity.js";
import { createExamBulkRoutes } from "./bulk.js";
import { createExamHistoryRoutes } from "./history.js";
import { createExamMarkIntegrityRoutes } from "./marks-integrity.js";

export const examsFeature: BackendFeature = {
  key: "exams",
  version: "1.5.0",
  mount(app,runtime){
    app.route("/api/v1/exams",createExamMarkIntegrityRoutes(runtime));
    app.route("/api/v1/exams",createExamBulkRoutes(runtime));
    app.route("/api/v1/exams",createExamHistoryRoutes(runtime));
    app.route("/api/v1/exams",createExamParityRoutes(runtime));
    app.route("/api/v1/exams",createExamRoutes(runtime));
    app.route("/api/v1/exams",createExamSetupRoutes(runtime));
    app.route("/api/v1/exams",createExamMarkRoutes(runtime));
    app.route("/api/v1/exams",createExamReportRoutes(runtime));
    app.route("/api/v1/exams",createExamFinalizationRoutes(runtime));
  },
};

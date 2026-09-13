import type { BackendFeature } from "../types.js";
import { createExamBulkRoutes } from "../exams/bulk.js";
import { createExamHistoryRoutes } from "../exams/history.js";

export const examsIntegrityFeature: BackendFeature = {
  key: "exams-integrity",
  version: "1.0.0",
  mount(app,runtime){
    app.route("/api/v1/exams",createExamBulkRoutes(runtime));
    app.route("/api/v1/exams",createExamHistoryRoutes(runtime));
  },
};

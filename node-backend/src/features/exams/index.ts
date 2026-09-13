import type { BackendFeature } from "../types.js";
import { createExamRoutes } from "./routes.js";
import { createExamSetupRoutes } from "./setup.js";

export const examsFeature: BackendFeature = {
  key: "exams",
  version: "1.0.0",
  mount(app,runtime){
    app.route("/api/v1/exams",createExamRoutes(runtime));
    app.route("/api/v1/exams",createExamSetupRoutes(runtime));
  },
};

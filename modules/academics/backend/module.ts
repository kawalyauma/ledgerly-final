import "./mobile-sync-adapter";
import type { BackendModuleDefinition } from "../../backend-types";
import { academicsRoutes } from "./routes";
import { lessonPlanResubmissionRoutes } from "./lesson-plan-resubmission";
import { academicsMobileSafeRoutes } from "./mobile-safe-updates";
import { academicsLearningCycleRoutes } from "./learning-cycle-routes";
import { academicsTimetableIntelligenceRoutes } from "./timetable-intelligence-routes";

export const moduleDefinition: BackendModuleDefinition = {
  key: "academics",
  name: "Academics",
  version: "2.1.0",
  order: 25,
  routes: [
    { basePath: "/api/v1/academics", router: academicsLearningCycleRoutes },
    { basePath: "/api/v1/academics", router: academicsTimetableIntelligenceRoutes },
    { basePath: "/api/v1/academics", router: academicsRoutes },
    { basePath: "/api/v1/academics", router: lessonPlanResubmissionRoutes },
    { basePath: "/api/v1/academics", router: academicsMobileSafeRoutes },
  ],
};

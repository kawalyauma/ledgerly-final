import { BookOpenCheck } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AcademicsWorkspace } from "./AcademicsWorkspace";
import { LearningCycleWorkspace } from "./LearningCycleWorkspace";
import { SmartTimetableWorkspace } from "./SmartTimetableWorkspace";
import "./academics.css";
import "./professional.css";
import "./learning-cycle.css";
import "./smart-timetable.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "academics",
  name: "Academics",
  version: "2.1.0",
  order: 25,
  routes: {
    academics: { scope: "school:read", view: LearningCycleWorkspace },
    "academics-timetable": { scope: "school:read", view: SmartTimetableWorkspace },
    "academics-operations": { scope: "school:read", view: AcademicsWorkspace },
  },
  navigation: [{
    label: "Academics",
    icon: BookOpenCheck,
    order: 25,
    items: [
      { label: "Teaching & Learning", path: "academics", scope: "school:read" },
      { label: "Smart Timetable", path: "academics-timetable", scope: "school:read" },
      { label: "Academic Operations", path: "academics-operations", scope: "school:read" },
    ],
  }],
};
export default moduleDefinition;

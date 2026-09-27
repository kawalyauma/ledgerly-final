import { BarChart3, BookMarked, BookOpenCheck, CalendarClock, Upload, UserCheck } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AcademicsWorkspace } from "./AcademicsWorkspace";
import "./academics.css";
import "./professional.css";
import "./learning-cycle.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "academics",
  name: "Academics",
  version: "2.2.0",
  order: 25,
  routes: {
    academics: { scope: "school:read", view: AcademicsWorkspace },
  },
  navigation: [{
    label: "Academics",
    icon: BookOpenCheck,
    order: 25,
    items: [
      { label: "Dashboard", path: "academics", scope: "school:read", icon: BarChart3 },
      { label: "Schemes & lessons", path: "academics/schemes", scope: "school:read", icon: BookMarked },
      { label: "Timetables", path: "academics/timetables", scope: "school:read", icon: CalendarClock },
      { label: "Supervision", path: "academics/supervision", scope: "school:read", icon: UserCheck },
      { label: "Imports", path: "academics/imports", scope: "school:read", icon: Upload },
    ],
  }],
};
export default moduleDefinition;

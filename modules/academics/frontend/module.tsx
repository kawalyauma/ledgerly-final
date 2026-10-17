import { BarChart3, BookMarked, BookOpenCheck, Bot, CalendarCheck, CalendarClock, LayoutDashboard, ListChecks, ScanLine, Shapes, Sparkles, Upload, UserCheck } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AcademicsWorkspace } from "./AcademicsWorkspace";
import { LearningEngineWorkspace } from "./learning/LearningEngineWorkspace";
import "./academics.css";
import "./professional.css";
import "./learning-cycle.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "academics",
  name: "Academics",
  version: "2.3.0",
  order: 25,
  routes: {
    academics: { scope: "school:read", view: AcademicsWorkspace },
    // The GitHub- and agent-powered learning engine (/api/v1/learn). Its API accepts learning:* or school:* scopes,
    // so the route itself is open to signed-in staff and each screen shows what the API allows.
    learning: { view: LearningEngineWorkspace },
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
  }, {
    label: "Learning Engine",
    icon: Sparkles,
    order: 26,
    items: [
      { label: "Overview", path: "learning", icon: LayoutDashboard },
      { label: "Schemes & lessons", path: "learning/schemes", icon: BookMarked },
      { label: "Agents & GitHub", path: "learning/agents", icon: Bot },
      { label: "Teaching plan", path: "learning/teaching", icon: CalendarCheck },
      { label: "Question bank", path: "learning/questions", icon: ListChecks },
      { label: "Book scans", path: "learning/scans", icon: ScanLine },
      { label: "Figure library", path: "learning/figures", icon: Shapes },
    ],
  }],
};
export default moduleDefinition;

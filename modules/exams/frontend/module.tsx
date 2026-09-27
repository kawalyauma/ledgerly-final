import { BarChart3, ClipboardList, Edit2, FileText, LayoutDashboard, Settings2 } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { ExamsWorkspace } from "./ExamsWorkspace";
import "./exams.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "exams",
  name: "Examinations",
  version: "1.0.0",
  order: 30,
  routes: {
    exams: { scope: "school:read", view: ExamsWorkspace },
  },
  navigation: [
    { label: "Examinations", icon: ClipboardList, order: 30, items: [
      { label: "Overview", path: "exams", scope: "school:read", icon: LayoutDashboard },
      { label: "Exams", path: "exams/exams", scope: "school:read", icon: ClipboardList },
      { label: "Marks entry", path: "exams/marks", scope: "school:read", icon: Edit2 },
      { label: "Report cards", path: "exams/cards", scope: "school:read", icon: FileText },
      { label: "Academic reports", path: "exams/reports", scope: "school:read", icon: BarChart3 },
      { label: "Grading & comments", path: "exams/grading", scope: "school:read", icon: Settings2 },
    ] },
  ],
};
export default moduleDefinition;

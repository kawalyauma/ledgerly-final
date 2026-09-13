import { Bot } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AgenticEmployeesPage } from "./AgenticEmployeesPage";
import { VisionWorkspacePage } from "./VisionWorkspacePage";
import { MemoryPage } from "./MemoryPage";
import { ProactiveEmployeesPage } from "./ProactiveEmployeesPage";
import { EventReactionsPage } from "./EventReactionsPage";
import { ActionCenterPage } from "./ActionCenterPage";
import { AgentDocumentsPage } from "./AgentDocumentsPage";
import "./agentic-employees.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "agentic-employees",
  name: "Agentic Employees",
  version: "1.7.0",
  order: 75,
  routes: {
    "agentic-employees": { scope: "school:read", view: AgenticEmployeesPage },
    "agentic-employees-vision": { scope: "school:read", view: VisionWorkspacePage },
    "agentic-employees-memory": { scope: "school:read", view: MemoryPage },
    "agentic-employees-proactive": { scope: "school:read", view: ProactiveEmployeesPage },
    "agentic-employees-events": { scope: "school:read", view: EventReactionsPage },
    "agentic-employees-actions": { scope: "school:read", view: ActionCenterPage },
    "agentic-employees-documents": { scope: "documents:read", view: AgentDocumentsPage },
  },
  navigation: [{ label: "Agentic Employees", icon: Bot, order: 75, items: [
    { label: "AI Workforce", path: "agentic-employees", scope: "school:read" },
    { label: "Image & OCR", path: "agentic-employees-vision", scope: "school:read" },
    { label: "Memory", path: "agentic-employees-memory", scope: "school:read" },
    { label: "Proactive Workforce", path: "agentic-employees-proactive", scope: "school:read" },
    { label: "Event Reactions", path: "agentic-employees-events", scope: "school:read" },
    { label: "Action Center", path: "agentic-employees-actions", scope: "school:read" },
    { label: "Agent Documents", path: "agentic-employees-documents", scope: "documents:read" },
  ]}],
};
export default moduleDefinition;

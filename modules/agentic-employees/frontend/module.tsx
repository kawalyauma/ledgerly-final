import { Bot } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AgenticEmployeesPage } from "./AgenticEmployeesPage";
import { ProactiveEmployeesPage } from "./ProactiveEmployeesPage";
import { EventReactionsPage } from "./EventReactionsPage";
import { ActionCenterPage } from "./ActionCenterPage";
import "./agentic-employees.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "agentic-employees",
  name: "Agentic Employees",
  version: "1.4.0",
  order: 75,
  routes: {
    "agentic-employees": { scope: "school:read", view: AgenticEmployeesPage },
    "agentic-employees-proactive": { scope: "school:read", view: ProactiveEmployeesPage },
    "agentic-employees-events": { scope: "school:read", view: EventReactionsPage },
    "agentic-employees-actions": { scope: "school:read", view: ActionCenterPage },
  },
  navigation: [
    {
      label: "Agentic Employees",
      icon: Bot,
      order: 75,
      items: [
        { label: "AI Workforce", path: "agentic-employees", scope: "school:read" },
        { label: "Proactive Workforce", path: "agentic-employees-proactive", scope: "school:read" },
        { label: "Event Reactions", path: "agentic-employees-events", scope: "school:read" },
        { label: "Action Center", path: "agentic-employees-actions", scope: "school:read" },
      ],
    },
  ],
};

export default moduleDefinition;

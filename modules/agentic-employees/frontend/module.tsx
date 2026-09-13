import { Bot } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AgenticEmployeesPage } from "./AgenticEmployeesPage";
import { ProactiveEmployeesPage } from "./ProactiveEmployeesPage";
import { EventReactionsPage } from "./EventReactionsPage";
import "./agentic-employees.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "agentic-employees",
  name: "AI Employees",
  version: "1.3.0",
  order: 75,
  routes: {
    "agentic-employees": { scope: "school:read", view: AgenticEmployeesPage },
    "agentic-employees-proactive": { scope: "school:read", view: ProactiveEmployeesPage },
    "agentic-employees-events": { scope: "school:read", view: EventReactionsPage },
  },
  navigation: [
    {
      label: "AI Employees",
      icon: Bot,
      order: 75,
      items: [
        { label: "AI Workforce", path: "agentic-employees", scope: "school:read" },
        { label: "Proactive Workforce", path: "agentic-employees-proactive", scope: "school:read" },
        { label: "Event Reactions", path: "agentic-employees-events", scope: "school:read" },
      ],
    },
  ],
};

export default moduleDefinition;

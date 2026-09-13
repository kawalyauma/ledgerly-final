import { Bot } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AgenticEmployeesPage } from "./AgenticEmployeesPage";
import "./agentic-employees.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "agentic-employees",
  name: "AI Employees",
  version: "1.0.0",
  order: 75,
  routes: {
    "agentic-employees": { scope: "school:read", view: AgenticEmployeesPage },
  },
  navigation: [
    {
      label: "AI Employees",
      icon: Bot,
      order: 75,
      items: [{ label: "AI Workforce", path: "agentic-employees", scope: "school:read" }],
    },
  ],
};

export default moduleDefinition;

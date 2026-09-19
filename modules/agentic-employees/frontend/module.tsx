import { Bot } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AgenticEmployeesPage } from "./AgenticEmployeesPage";
import { AgenticChatStudioPage } from "./AgenticChatStudioPage";
import { AgenticCommandCenterPage } from "./AgenticCommandCenterPage";
import { ResponseLearningCenterPage } from "./ResponseLearningCenterPage";
import { ResponseKnowledgeCenterPage } from "./ResponseKnowledgeCenterPage";
import { ProviderConfigurationPage } from "./ProviderConfigurationPage";
import { VisionWorkspacePage } from "./VisionWorkspacePage";
import { MemoryPage } from "./MemoryPage";
import { ProactiveEmployeesPage } from "./ProactiveEmployeesPage";
import { EventReactionsPage } from "./EventReactionsPage";
import { ActionCenterPage } from "./ActionCenterPage";
import { AgentDocumentsPage } from "./AgentDocumentsPage";
import { ForgeBuilderPage, ForgeGlobalAction } from "./ForgeBuilderPage";
import "./agentic-employees.css";
import "./chat-studio.css";
import "./chat-studio-lifecycle.css";
import "./command-center.css";
import "./learning-center.css";
import "./knowledge-center.css";
import "./forge-builder.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "agentic-employees",
  name: "Agentic Employees",
  version: "2.9.0",
  order: 75,
  routes: {
    "agentic-employees": { scope: "school:read", view: AgenticChatStudioPage },
    "agentic-employees-command-center": { scope: "school:read", view: AgenticCommandCenterPage },
    "agentic-employees-learning": { scope: "school:read", view: ResponseLearningCenterPage },
    "agentic-employees-knowledge": { scope: "school:read", view: ResponseKnowledgeCenterPage },
    "agentic-employees-workforce": { scope: "school:read", view: AgenticEmployeesPage },
    "agentic-employees-provider": { scope: "school:read", view: ProviderConfigurationPage },
    "agentic-employees-vision": { scope: "school:read", view: VisionWorkspacePage },
    "agentic-employees-memory": { scope: "school:read", view: MemoryPage },
    "agentic-employees-proactive": { scope: "school:read", view: ProactiveEmployeesPage },
    "agentic-employees-events": { scope: "school:read", view: EventReactionsPage },
    "agentic-employees-actions": { scope: "school:read", view: ActionCenterPage },
    "agentic-employees-documents": { scope: "documents:read", view: AgentDocumentsPage },
    "agentic-employees-forge": { view: ForgeBuilderPage },
  },
  navigation: [{ label: "Agentic Employees", icon: Bot, order: 75, items: [
    { label: "AI Chat Studio", path: "agentic-employees", scope: "school:read" },
    { label: "Command Center", path: "agentic-employees-command-center", scope: "school:read" },
    { label: "Learning Center", path: "agentic-employees-learning", scope: "school:read" },
    { label: "Knowledge Center", path: "agentic-employees-knowledge", scope: "school:read" },
    { label: "Create AI Employee", path: "agentic-employees-forge" },
    { label: "AI Runtime Status", path: "agentic-employees-provider", scope: "school:read" },
    { label: "Image & OCR", path: "agentic-employees-vision", scope: "school:read" },
    { label: "Memory", path: "agentic-employees-memory", scope: "school:read" },
    { label: "Proactive Workforce", path: "agentic-employees-proactive", scope: "school:read" },
    { label: "Event Reactions", path: "agentic-employees-events", scope: "school:read" },
    { label: "Agent Documents", path: "agentic-employees-documents", scope: "documents:read" },
  ]}],
  globalActions: [
    { key: "create-ai-employee", label: "Create AI Employee", order: 70, component: ForgeGlobalAction },
  ],
};
export default moduleDefinition;
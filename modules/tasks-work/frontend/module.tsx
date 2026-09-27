import { Bell, BriefcaseBusiness, ContactRound, FolderKanban, LayoutDashboard, ListChecks, MessageCircle, Users } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { WorkManagementPage } from "./WorkManagementPage";
import "./work.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "tasks-work",
  name: "Tasks & Work",
  version: "1.1.0",
  order: 25,
  routes: {
    work: { view: WorkManagementPage },
  },
  navigation: [
    { label: "Tasks & Work", icon: BriefcaseBusiness, order: 25, items: [
      { label: "Overview", path: "work", icon: LayoutDashboard },
      { label: "Tasks", path: "work/tasks", icon: ListChecks },
      { label: "Projects", path: "work/projects", icon: FolderKanban },
      { label: "Teams", path: "work/teams", icon: Users },
      { label: "People & contacts", path: "work/people", icon: ContactRound },
      { label: "Team chat", path: "work/chats", icon: MessageCircle },
      { label: "Notifications", path: "work/notifications", icon: Bell },
    ] },
  ],
};
export default moduleDefinition;

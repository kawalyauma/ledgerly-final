import { History, LayoutDashboard, MessageSquareMore, Send, Settings2, Smartphone } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { CommunicationsWorkspace } from "./CommunicationsWorkspace";
import "./communications.css";
const moduleDefinition:FrontendModuleDefinition={key:"communications",name:"Messages & Notifications",version:"1.0.0",order:20,routes:{communications:{view:CommunicationsWorkspace}},navigation:[{label:"Messages & Notifications",icon:MessageSquareMore,order:20,items:[
 {label:"Overview",path:"communications",icon:LayoutDashboard},
 {label:"Send message",path:"communications/compose",icon:Send},
 {label:"Campaigns",path:"communications/campaigns",icon:History},
 {label:"Delivery history",path:"communications/deliveries",icon:Smartphone},
 {label:"Message types",path:"communications/types",icon:MessageSquareMore},
 {label:"Channels & template",path:"communications/settings",icon:Settings2},
]}]};
export default moduleDefinition;

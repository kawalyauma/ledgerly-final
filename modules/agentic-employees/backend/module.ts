import type { BackendModuleDefinition } from "../../backend-types";
import { agenticProviderRoutes } from "./provider-routes";
import { agenticEmployeeRoutes } from "./routes";
import { agenticExecutionRoutes } from "./execution-routes";
import { agenticProactiveRoutes } from "./proactive-routes";
import { agenticFamilyReportRoutes } from "./family-report-routes";
import { agenticEventRoutes } from "./event-routes";
import { agenticActionRoutes } from "./action-routes";
import { agenticDocumentRoutes } from "./document-routes";
import { agenticVisionRoutes } from "./vision-routes";
import { agenticMemoryRoutes } from "./memory-routes";
import { agenticWorkspaceRoutes } from "./workspace-routes-v21";
import { runDueProactiveSchedules } from "./proactive-scheduler";
import { processEventInbox } from "./event-processor";
import { detectDerivedEmployeeEvents } from "./event-detector";

export const moduleDefinition:BackendModuleDefinition={key:"agentic-employees",name:"AI Employees",version:"2.1.0",order:75,routes:[
 {basePath:"/api/v1/agentic-employees",router:agenticProviderRoutes},{basePath:"/api/v1/agentic-employees",router:agenticWorkspaceRoutes},{basePath:"/api/v1/agentic-employees",router:agenticEmployeeRoutes},{basePath:"/api/v1/agentic-employees",router:agenticExecutionRoutes},{basePath:"/api/v1/agentic-employees",router:agenticProactiveRoutes},{basePath:"/api/v1/agentic-employees",router:agenticFamilyReportRoutes},{basePath:"/api/v1/agentic-employees",router:agenticEventRoutes},{basePath:"/api/v1/agentic-employees",router:agenticActionRoutes},{basePath:"/api/v1/agentic-employees",router:agenticDocumentRoutes},{basePath:"/api/v1/agentic-employees",router:agenticVisionRoutes},{basePath:"/api/v1/agentic-employees",router:agenticMemoryRoutes}],scheduled:async env=>{await detectDerivedEmployeeEvents(env);await processEventInbox(env);await runDueProactiveSchedules(env);}};
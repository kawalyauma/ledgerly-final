import type { BackendModuleDefinition } from "../../backend-types";
import { fileManagerRoutes } from "./routes";

export const moduleDefinition:BackendModuleDefinition={
  key:"file-manager",
  name:"Documents & Files",
  version:"1.0.0",
  order:18,
  routes:[{basePath:"/api/v1/files",router:fileManagerRoutes}],
};

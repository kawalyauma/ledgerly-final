import { FolderArchive } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { FileManagerWorkspace } from "./FileManagerWorkspace";
import "./file-manager.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"file-manager",
  name:"Documents & Files",
  version:"1.0.0",
  order:18,
  routes:{
    files:{scope:"documents:read",view:FileManagerWorkspace},
  },
  navigation:[{
    label:"Documents",
    icon:FolderArchive,
    order:18,
    items:[{label:"Documents & Files",path:"files",scope:"documents:read"}],
  }],
};
export default moduleDefinition;

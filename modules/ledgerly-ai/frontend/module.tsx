import { Sparkles } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { LedgerlyAiConsolePage } from "./LedgerlyAiConsolePage";
import "./ledgerly-ai-console.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"ledgerly-ai",
  name:"Ledgerly AI",
  version:"0.14.0",
  order:74,
  routes:{
    "ledgerly-ai":{scope:"admin:read",admin:true,view:LedgerlyAiConsolePage},
  },
  navigation:[{
    label:"Ledgerly AI",
    icon:Sparkles,
    order:74,
    items:[{label:"Admin Console",path:"ledgerly-ai",scope:"admin:read",admin:true}],
  }],
};
export default moduleDefinition;

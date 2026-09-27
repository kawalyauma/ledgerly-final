import { Sparkles } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { AskLedgerlyAiAction, LedgerlyAiWorkspacePage } from "./LedgerlyAiWorkspacePage";
import "./ledgerly-ai-workspace.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"ledgerly-ai",
  name:"Ledgerly AI",
  version:"0.19.0",
  order:74,
  routes:{
    "ledgerly-ai-ask":{view:LedgerlyAiWorkspacePage},
  },
  navigation:[{
    label:"Ledgerly AI",
    icon:Sparkles,
    order:74,
    items:[
      {label:"Ask Ledgerly AI",path:"ledgerly-ai-ask", icon: Sparkles},
    ],
  }],
  globalActions:[{
    key:"ask-ledgerly-ai",
    label:"Ask Ledgerly AI",
    order:25,
    component:AskLedgerlyAiAction,
  }],
};
export default moduleDefinition;

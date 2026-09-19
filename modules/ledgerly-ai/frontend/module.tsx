import { Sparkles } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { LedgerlyAiConsolePage } from "./LedgerlyAiConsolePage";
import { AskLedgerlyAiAction, LedgerlyAiWorkspacePage } from "./LedgerlyAiWorkspacePage";
import "./ledgerly-ai-console.css";
import "./ledgerly-ai-workspace.css";

const moduleDefinition:FrontendModuleDefinition={
  key:"ledgerly-ai",
  name:"Ledgerly AI",
  version:"0.16.0",
  order:74,
  routes:{
    "ledgerly-ai-ask":{view:LedgerlyAiWorkspacePage},
    "ledgerly-ai":{scope:"admin:read",admin:true,view:LedgerlyAiConsolePage},
  },
  navigation:[{
    label:"Ledgerly AI",
    icon:Sparkles,
    order:74,
    items:[
      {label:"Ask Ledgerly AI",path:"ledgerly-ai-ask"},
      {label:"Admin Console",path:"ledgerly-ai",scope:"admin:read",admin:true},
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

import { Wallet } from "lucide-react";
import type { FrontendModuleDefinition } from "../../frontend-types";
import { PlatformAdminPage, UsagePage } from "./BillingPages";
import "./billing.css";

const moduleDefinition: FrontendModuleDefinition = {
  key: "billing",
  name: "Plans & Billing",
  version: "1.0.0",
  order: 95,
  routes: {
    billing: { view: UsagePage },
    // Access is checked server-side against PLATFORM_ADMIN_EMAILS; the link lives in the account menu.
    "platform-admin": { view: PlatformAdminPage },
  },
  navigation: [{
    label: "Billing",
    icon: Wallet,
    order: 95,
    items: [{ label: "Plan & usage", path: "billing", icon: Wallet }],
  }],
};
export default moduleDefinition;

import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./auth";
import { installDynamicSchoolSelectors } from "./dynamicSchoolSelectors";
import { installLegacyPrintBridge } from "./printing";
import { installJournalReversalGuard } from "./reversalGuard";
import { SchoolKioskApp } from "../modules/school/frontend/SchoolKioskPage";
import "./styles.css";
import "./theme.css";
import "./fusion.css";
import "./fusion-education.css";
import "./fusion-business.css";
import "./fusion-tools.css";
import "./fusion-dashboard.css";
import "./fusion-public.css";
import "./fusion-navigation.css";

installLegacyPrintBridge();
installDynamicSchoolSelectors();
installJournalReversalGuard();

// #kiosk is an unattended wall display signed in with a display-only key, so it skips the app shell and login.
const isKiosk = /^#kiosk(=|$)/.test(window.location.hash);
createRoot(document.getElementById("root")!).render(<React.StrictMode>{isKiosk ? <SchoolKioskApp /> : <AuthProvider><App /></AuthProvider>}</React.StrictMode>);

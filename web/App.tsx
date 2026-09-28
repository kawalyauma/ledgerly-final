import { useEffect, useState } from "react";
import { useAuth } from "./auth";
import { can } from "./api";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./pages/AuthPages";
import { LandingPage } from "./pages/LandingPage";
import { ReceiptVerifyPage } from "./pages/ReceiptVerifyPage";
import { Button, Card } from "./components/ui";
import { appRoutes, routeSections } from "../modules/frontend-registry";
import { currentHashPath, routeKeyOf } from "./navigation";
import { planName, requiredPlan, sectionInPlan, useSubscription } from "./plans";

/** Pages a suspended organization can still open. */
const OPEN_WHEN_SUSPENDED = new Set(["welcome", "billing", "platform-admin"]);

export function App() {
  const { principal } = useAuth();
  const [path, setPath] = useState(currentHashPath());
  const subscription = useSubscription(principal?.organizationId);

  useEffect(() => {
    const onHashChange = () => setPath(currentHashPath());
    addEventListener("hashchange", onHashChange);
    return () => removeEventListener("hashchange", onHashChange);
  }, []);

  const defaultPath = "welcome";
  const activePath = path || defaultPath;
  const routeKey = appRoutes[routeKeyOf(activePath)] ? routeKeyOf(activePath) : defaultPath;

  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, [activePath]);
  // Public: the QR code on printed receipts opens this for anyone, signed in or not.
  if (routeKeyOf(path) === "verify-receipt") return <ReceiptVerifyPage token={path.split("/")[1] ?? ""}/>;
  if (!principal) {
    // Visitors see the marketing page; #login / #signup open the auth screens.
    const authMode = routeKeyOf(path) === "signup" ? "register" : routeKeyOf(path) === "login" ? "login" : null;
    return authMode ? <AuthPage initialMode={authMode}/> : <LandingPage/>;
  }

  const route = appRoutes[routeKey] || appRoutes["system-status"];
  if (!route) return <div className="page"><Card><div className="empty"><h3>No application route is available</h3><p>Check the module registry and rebuild the frontend.</p></div></Card></div>;
  const View = route.view;
  const allowed = (!route.scope || can(principal, route.scope)) && (!route.admin || ["owner", "admin"].includes(principal.role));
  const section = routeSections[routeKey];
  const inPlan = !subscription || sectionInPlan(section, subscription.plan);
  const suspended = subscription?.status === "suspended" && !OPEN_WHEN_SUSPENDED.has(routeKey);

  return <AppShell active={activePath} onNavigate={next => { location.hash = next; }}>
    {!allowed ? <PermissionDenied fallback={defaultPath}/>
      : suspended ? <Suspended/>
      : !inPlan ? <UpgradeRequired needed={planName(requiredPlan(section!))} current={subscription!.planName}/>
      : <View key={routeKey}/>}
  </AppShell>;
}

function PermissionDenied({ fallback }: { fallback: string }) {
  return <div className="page"><Card><div className="empty"><h3>Permission denied</h3><p>Your role or assigned scopes do not allow access to this page. Ask an organization owner or administrator if you need access.</p><Button onClick={() => location.hash = fallback}>Return to your workspace</Button></div></Card></div>;
}

function UpgradeRequired({ needed, current }: { needed: string; current: string }) {
  return <div className="page"><Card><div className="empty"><h3>Available on the {needed} plan</h3><p>Your school is on the {current} plan. Upgrade to {needed} to unlock this module; your data and settings stay as they are.</p><Button onClick={() => location.hash = "billing"}>See plans &amp; usage</Button></div></Card></div>;
}

function Suspended() {
  return <div className="page"><Card><div className="empty"><h3>Subscription suspended</h3><p>This organization's Ledgerly subscription is suspended. Settle the balance for this term to restore access.</p><Button onClick={() => location.hash = "billing"}>View plan &amp; usage</Button></div></Card></div>;
}

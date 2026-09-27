import { useEffect, useState } from "react";
import { get } from "./api";

// Keep in sync with node-backend/src/features/billing/plans.ts (rates and Premium-only APIs).
export type PlanKey = "free" | "standard" | "premium";

/** Sections every plan keeps: settings, billing and status must always be reachable. */
const ALWAYS = ["ledgerly-core:Organization", "ledgerly-core:System status", "billing:Billing"];
const FREE = ["ledgerly-core:Dashboards", "school-management:School", "exams:Examinations"];
const STANDARD = [
  "attendance:Attendance", "academics:Academics", "communications:Messages & Notifications", "tasks-work:Tasks & Work",
  "contacts:Contacts", "file-manager:Documents", "human-resources:Human Resources", "payroll-payments:Payroll & Payments", "books:Books",
  "ledgerly-core:Accounting", "ledgerly-core:Sales & Purchasing", "ledgerly-core:Operations", "ledgerly-core:Banking & Inventory",
  "ledgerly-core:Tax", "ledgerly-core:Planning & Reporting",
];
/** Modules only Premium includes (their APIs are refused server-side on lower plans). */
export const PREMIUM_MODULES = ["ledgerly-ai", "printerly", "security-camera", "agentic-employees"];

export type Plan = { key: PlanKey; name: string; rateUgx: number; tagline: string; highlight?: boolean; features: string[] };
export const PLANS: Plan[] = [
  { key: "free", name: "Free", rateUgx: 0, tagline: "Run the school office at no cost.", features: [
    "Automatic dashboard & statistics", "Students, admissions & staff records", "Fees, billing & receipts", "Examinations, marks & report cards", "Unlimited users",
  ] },
  { key: "standard", name: "Standard", rateUgx: 2000, highlight: true, tagline: "Everything a growing school needs.", features: [
    "Everything in Free", "Attendance with Android kiosks", "Academics: schemes, timetables & supervision", "SMS & WhatsApp messages to parents",
    "Full accounting, banking & inventory", "HR & payroll", "Tasks, documents & library books",
  ] },
  { key: "premium", name: "Premium", rateUgx: 4000, tagline: "The complete, AI-assisted campus.", features: [
    "Everything in Standard", "Ledgerly AI assistant & automations", "Printerly print & scan management", "Security camera monitoring", "Priority support",
  ] },
];

export const planName = (key: PlanKey) => PLANS.find(p => p.key === key)?.name ?? "Free";

/** Is a sidebar section (group key) available on this plan? */
export function sectionInPlan(sectionKey: string | undefined, plan: PlanKey) {
  if (!sectionKey || plan === "premium" || ALWAYS.includes(sectionKey) || FREE.includes(sectionKey)) return true;
  if (plan === "standard") return STANDARD.includes(sectionKey);
  return false;
}
/** Lowest plan that includes a section, for "upgrade to …" prompts. */
export const requiredPlan = (sectionKey: string): PlanKey => sectionInPlan(sectionKey, "free") ? "free" : sectionInPlan(sectionKey, "standard") ? "standard" : "premium";
export const moduleInPlan = (moduleKey: string | undefined, plan: PlanKey) => plan === "premium" || !moduleKey || !PREMIUM_MODULES.includes(moduleKey);

export type Subscription = { plan: PlanKey; planName: string; status: "active" | "suspended"; isPlatformAdmin: boolean };
export const BILLING_CHANGED = "ledgerly:billing-changed";

export function useSubscription(organizationId?: string) {
  const [sub, setSub] = useState<Subscription | undefined>(undefined);
  useEffect(() => {
    if (!organizationId) return;
    // If billing can't be read, fail open to the plan we can't verify rather than locking a school out.
    const load = () => get<Subscription>("/billing/subscription").then(setSub).catch(() => setSub({ plan: "premium", planName: "Premium", status: "active", isPlatformAdmin: false }));
    void load();
    addEventListener(BILLING_CHANGED, load);
    return () => removeEventListener(BILLING_CHANGED, load);
  }, [organizationId]);
  return sub;
}

export const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString()}`;

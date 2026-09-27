// Keep in sync with web/plans.ts (the web client's copy used by the landing page and sidebar).
export type PlanKey = "free" | "standard" | "premium";
export const PLAN_RATES: Record<PlanKey, number> = { free: 0, standard: 2000, premium: 4000 };
export const PLAN_NAMES: Record<PlanKey, string> = { free: "Free", standard: "Standard", premium: "Premium" };
export const isPlanKey = (v: unknown): v is PlanKey => v === "free" || v === "standard" || v === "premium";

/** API prefixes that only the Premium plan may call (enforced server-side). */
export const PREMIUM_API_PREFIXES = ["/api/v1/ledgerly-ai", "/api/v1/printerly", "/api/v1/nvr"];

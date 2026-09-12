import { coreIdentityFeature } from "./core-identity/index.js";
import { financeCoreFeature } from "./finance-core/index.js";
import { fiscalPeriodsFeature } from "./fiscal-periods/index.js";
import { contactsFeature } from "./contacts/index.js";
import { documentsFeature } from "./documents/index.js";
import { paymentsFeature } from "./payments/index.js";
import { bankingFeature } from "./banking/index.js";
import { budgetsFeature } from "./budgets/index.js";
import { inventoryFeature } from "./inventory/index.js";
import { fixedAssetsFeature } from "./fixed-assets/index.js";
import { dimensionsProjectsFeature } from "./dimensions-projects/index.js";
import { reportsFeature } from "./reports/index.js";
import type { BackendFeature } from "./types.js";

/** Independent Node implementations only. Never import the Cloudflare backend here. */
export const features: BackendFeature[] = [coreIdentityFeature, fiscalPeriodsFeature, financeCoreFeature, contactsFeature, documentsFeature, paymentsFeature, bankingFeature, budgetsFeature, inventoryFeature, fixedAssetsFeature, dimensionsProjectsFeature, reportsFeature];

import { coreIdentityFeature } from "./core-identity/index.js";
import { financeCoreFeature } from "./finance-core/index.js";
import type { BackendFeature } from "./types.js";

/** Independent Node implementations only. Never import the Cloudflare backend here. */
export const features: BackendFeature[] = [coreIdentityFeature, financeCoreFeature];

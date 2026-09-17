// Compatibility surface for the agentic-employees backend, which was originally
// written against the Cloudflare Worker's src/lib/{errors,ids,auth} and src/types.
// This file lets those files be reused here with only import-path rewrites.
export { AppError } from "../../http/errors.js";
export { createId, requireScope } from "../core-identity/security.js";
export type { AuthPrincipal } from "../../http/types.js";

export type Env = Record<string, any>;
export type AppVariables = { principal: import("../../http/types.js").AuthPrincipal };
export type AgentDocumentFormat = "pdf" | "docx" | "xlsx" | "pptx";

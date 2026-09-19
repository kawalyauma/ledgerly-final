import type { Runtime } from "../../runtime.js";
import { LedgerlyAiFoundationService } from "./service.js";

const services = new WeakMap<Runtime, LedgerlyAiFoundationService>();

export function getLedgerlyAiFoundationService(runtime: Runtime) {
  const existing = services.get(runtime);
  if (existing) return existing;
  const service = new LedgerlyAiFoundationService(runtime);
  services.set(runtime, service);
  void service.start().catch(() => undefined);
  return service;
}

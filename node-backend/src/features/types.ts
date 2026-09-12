import type { JobRegistry } from "../jobs/registry.js";
import type { NodeApp } from "../http/types.js";
import type { Runtime } from "../runtime.js";
import type { ScheduledJobDefinition } from "../scheduler/types.js";

export type BackendFeature = {
  key: string;
  version: string;
  mount?: (app: NodeApp, runtime: Runtime) => void;
  registerJobs?: (registry: JobRegistry) => void;
  schedules?: ScheduledJobDefinition[];
};

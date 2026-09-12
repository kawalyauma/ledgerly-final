import type { Hono } from "hono";
import type { JobRegistry } from "../jobs/registry.js";
import type { Runtime } from "../runtime.js";
import type { ScheduledJobDefinition } from "../scheduler/types.js";

export type BackendFeature = {
  key: string;
  version: string;
  mount?: (app: Hono, runtime: Runtime) => void;
  registerJobs?: (registry: JobRegistry) => void;
  schedules?: ScheduledJobDefinition[];
};

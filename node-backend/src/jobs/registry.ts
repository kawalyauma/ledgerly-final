import type { Runtime } from "../runtime.js";
import type { ClaimedJob } from "../queue/postgres-queue.js";

// Workers acknowledge jobs after the returned promise settles; handler return values
// are intentionally ignored. Allow handlers to return diagnostics without weakening
// queue success/failure semantics.
export type JobHandler = (job: ClaimedJob, runtime: Runtime) => Promise<unknown>;

export class JobRegistry {
  private readonly handlers = new Map<string, JobHandler>();

  register(kind: string, handler: JobHandler): void {
    if (this.handlers.has(kind)) throw new Error(`Job handler already registered: ${kind}`);
    this.handlers.set(kind, handler);
  }

  get(kind: string): JobHandler | undefined { return this.handlers.get(kind); }
  keys(): string[] { return [...this.handlers.keys()].sort(); }
}

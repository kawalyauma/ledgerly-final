import { randomUUID } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { features } from "../features/index.js";
import { JobRegistry } from "../jobs/registry.js";
import { createRuntime } from "../runtime.js";
import { getLedgerlyAiFoundationService } from "../features/ledgerly-ai/runtime-service.js";

// See src/server.ts: this host's dual-stack DNS resolution is unreliable for
// some AI provider hosts (intermittent getaddrinfo EAI_AGAIN).
setDefaultResultOrder("ipv4first");

const runtime = await createRuntime();
const registry = new JobRegistry();
for (const feature of features) feature.registerJobs?.(registry);
const workerId = `${process.pid}:${randomUUID()}`;
let stopping = false;

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

runtime.logger.info({ workerId, handlers: registry.keys() }, "Queue worker started");

while (!stopping) {
  try {
    const recovered = await runtime.queue.recoverStale(runtime.config.QUEUE_STALE_SECONDS);
    if (recovered) runtime.logger.warn({ recovered }, "Recovered stale jobs");
    const jobs = await runtime.queue.claim(runtime.config.QUEUE_BATCH_SIZE, workerId);
    if (!jobs.length) {
      await new Promise((resolve) => setTimeout(resolve, runtime.config.QUEUE_POLL_MS));
      continue;
    }
    for (const job of jobs) {
      const handler = registry.get(job.kind);
      try {
        if (!handler) throw new Error(`No handler registered for job kind ${job.kind}`);
        await handler(job, runtime);
        await runtime.queue.ack(job.id);
      } catch (error) {
        runtime.logger.error({ err: error, jobId: job.id, kind: job.kind }, "Job failed");
        await runtime.queue.fail(job, error);
        if (!job.kind.startsWith("ledgerly-ai.incident.")) {
          const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
            ? job.payload as Record<string, unknown>
            : {};
          const organizationId = typeof payload.organizationId === "string"
            ? payload.organizationId
            : typeof payload.orgId === "string" ? payload.orgId : null;
          void getLedgerlyAiFoundationService(runtime).incidents.signal({
            organizationId,
            source: "queue",
            signalType: "queue",
            message: error instanceof Error ? error.message : String(error),
            title: `Queue job failed: ${job.kind}`,
            code: "QUEUE_JOB_FAILED",
            moduleKey: job.kind.split(".")[0] || "queue",
            context: {
              jobId: job.id,
              queue: job.queue,
              jobKind: job.kind,
              attempts: job.attempts,
              maxAttempts: job.maxAttempts,
            },
          }).catch((incidentError) => {
            runtime.logger.warn(
              { err: incidentError instanceof Error ? incidentError.message : String(incidentError), jobId: job.id },
              "Ledgerly AI queue incident capture failed",
            );
          });
        }
      }
    }
  } catch (error) {
    runtime.logger.error({ err: error }, "Queue worker loop failed");
    await new Promise((resolve) => setTimeout(resolve, runtime.config.QUEUE_POLL_MS));
  }
}

runtime.logger.info("Queue worker stopped");
await runtime.close();

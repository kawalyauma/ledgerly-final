import type { ClaimedJob } from "../../../queue/postgres-queue.js";
import type { Runtime } from "../../../runtime.js";
import { getLedgerlyAiFoundationService } from "../runtime-service.js";

export async function scanCustomAgentTriggers(_job:ClaimedJob,runtime:Runtime){
  const service=getLedgerlyAiFoundationService(runtime);
  await service.start();
  return service.customRuntime.scanTriggers();
}

export async function executeCustomAgentRun(job:ClaimedJob,runtime:Runtime){
  const payload=job.payload&&typeof job.payload==="object"&&!Array.isArray(job.payload)
    ? job.payload as Record<string,unknown>
    : {};
  const runId=typeof payload.runId==="string"?payload.runId.trim():"";
  if(!runId)throw new Error("Custom-agent queue job is missing runId.");
  const service=getLedgerlyAiFoundationService(runtime);
  await service.start();
  return service.customRuntime.executeRun(runId);
}

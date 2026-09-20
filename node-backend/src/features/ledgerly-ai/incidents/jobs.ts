import type { ClaimedJob } from "../../../queue/postgres-queue.js";
import type { Runtime } from "../../../runtime.js";
import { getLedgerlyAiFoundationService } from "../runtime-service.js";

export async function processLedgerlyAiIncident(job:ClaimedJob,runtime:Runtime){
  const payload=job.payload&&typeof job.payload==="object"&&!Array.isArray(job.payload)
    ? job.payload as Record<string,unknown>
    : {};
  const incidentId=typeof payload.incidentId==="string"?payload.incidentId.trim():"";
  if(!incidentId)throw new Error("Incident processing job is missing incidentId.");
  const service=getLedgerlyAiFoundationService(runtime);
  await service.start();
  return service.incidents.processIncident(incidentId);
}

export async function recoverLedgerlyAiIncidents(_job:ClaimedJob,runtime:Runtime){
  const service=getLedgerlyAiFoundationService(runtime);
  await service.start();
  return service.incidents.recoverStalledWorkflows();
}

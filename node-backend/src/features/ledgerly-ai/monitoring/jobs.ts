import type { ClaimedJob } from "../../../queue/postgres-queue.js";
import type { Runtime } from "../../../runtime.js";
import { getLedgerlyAiFoundationService } from "../runtime-service.js";

export async function scanLedgerlyAiMonitoring(_job:ClaimedJob,runtime:Runtime){
  const service=getLedgerlyAiFoundationService(runtime);
  await service.start();
  return service.monitoring.scan();
}
export async function generateLedgerlyAiDailyHealth(_job:ClaimedJob,runtime:Runtime){
  const service=getLedgerlyAiFoundationService(runtime);
  await service.start();
  return service.monitoring.generateSummary("daily");
}
export async function generateLedgerlyAiWeeklyHealth(_job:ClaimedJob,runtime:Runtime){
  const service=getLedgerlyAiFoundationService(runtime);
  await service.start();
  return service.monitoring.generateSummary("weekly");
}

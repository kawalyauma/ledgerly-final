import type { ClaimedJob } from "../../../queue/postgres-queue.js";
import type { Runtime } from "../../../runtime.js";
import { getLedgerlyAiFoundationService } from "../runtime-service.js";

export async function syncLedgerlyAiGitCi(_job:ClaimedJob,runtime:Runtime){
  const service=getLedgerlyAiFoundationService(runtime);
  await service.start();
  return service.git.syncOpenPullRequests();
}

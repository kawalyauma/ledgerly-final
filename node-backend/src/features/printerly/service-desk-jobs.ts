import type { ClaimedJob } from '../../queue/postgres-queue.js';
import type { Runtime } from '../../runtime.js';
import { sweepPrinterlyServiceDesk } from './service-desk.js';

export async function runPrinterlyServiceDeskSweep(_job: ClaimedJob, runtime: Runtime) {
  await sweepPrinterlyServiceDesk(runtime);
}

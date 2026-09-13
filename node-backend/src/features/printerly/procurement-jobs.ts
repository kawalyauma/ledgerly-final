import type { ClaimedJob } from '../../queue/postgres-queue.js';
import type { Runtime } from '../../runtime.js';
import { runPrinterlyAutoReplenishment } from './procurement.js';

export async function sweepPrinterlyProcurement(_job:ClaimedJob,runtime:Runtime){await runPrinterlyAutoReplenishment(runtime);}

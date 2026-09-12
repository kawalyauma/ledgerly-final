import { randomUUID } from "node:crypto";
import { loadNodeConfig } from "./config";
import { processQueueOnce } from "./queue";
import { createNodeRuntime } from "./runtime";

const config = loadNodeConfig();
const runtime = createNodeRuntime(config);
const workerId = `${process.pid}-${randomUUID()}`;
let stopped = false;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function loop(): Promise<void> {
  while (!stopped) {
    try { const processed = await processQueueOnce(runtime.env, runtime.db, config.QUEUE_BATCH_SIZE, workerId); if (processed === 0) await sleep(config.QUEUE_POLL_MS); }
    catch (error) { console.error(JSON.stringify({ level: "error", message: "Queue worker iteration failed", error: error instanceof Error ? error.message : String(error) })); await sleep(Math.max(config.QUEUE_POLL_MS, 1000)); }
  }
}
async function shutdown(): Promise<void> { stopped = true; await runtime.db.close(); process.exit(0); }
process.on("SIGTERM", () => void shutdown()); process.on("SIGINT", () => void shutdown()); void loop();

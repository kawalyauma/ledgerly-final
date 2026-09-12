import worker from "../index";
import { loadNodeConfig } from "./config";
import { createNodeRuntime } from "./runtime";

const config = loadNodeConfig();
const runtime = createNodeRuntime(config);
let stopped = false;
function dueCrons(now: Date): string[] { const minute = now.getUTCMinutes(); const hour = now.getUTCHours(); const due = ["* * * * *"]; if (minute % 5 === 0) due.push("*/5 * * * *"); if (minute === 0) due.push("0 * * * *"); if (minute === 0 && hour === 5) due.push("0 5 * * *"); return due; }
async function claim(cron: string, runKey: string): Promise<boolean> { const result = await runtime.db.pool.query("INSERT INTO selfhost_scheduled_runs (cron, run_key) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING cron", [cron, runKey]); return result.rowCount === 1; }
async function runMinute(now = new Date()): Promise<void> {
  const runKey = now.toISOString().slice(0, 16);
  for (const cron of dueCrons(now)) {
    if (!(await claim(cron, runKey))) continue;
    const controller = { cron, scheduledTime: now.getTime(), noRetry() {} } as ScheduledController;
    try { await worker.scheduled(controller, runtime.env); await runtime.db.pool.query("UPDATE selfhost_scheduled_runs SET finished_at=CURRENT_TIMESTAMP, status='completed' WHERE cron=$1 AND run_key=$2", [cron, runKey]); }
    catch (error) { await runtime.db.pool.query("UPDATE selfhost_scheduled_runs SET finished_at=CURRENT_TIMESTAMP, status='failed', error=$3 WHERE cron=$1 AND run_key=$2", [cron, runKey, error instanceof Error ? error.message : String(error)]); console.error(JSON.stringify({ level: "error", message: "Scheduled handler failed", cron, error: error instanceof Error ? error.message : String(error) })); }
  }
  await runtime.db.pool.query("DELETE FROM selfhost_scheduled_runs WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'");
}
async function loop(): Promise<void> { while (!stopped) { await runMinute(new Date()); const delay = 60_000 - (Date.now() % 60_000) + 50; await new Promise((resolve) => setTimeout(resolve, delay)); } }
async function shutdown(): Promise<void> { stopped = true; await runtime.db.close(); process.exit(0); }
process.on("SIGTERM", () => void shutdown()); process.on("SIGINT", () => void shutdown()); void loop();

import { setDefaultResultOrder } from "node:dns";
import cron from "node-cron";
import { features } from "../features/index.js";
import { createRuntime } from "../runtime.js";

// See src/server.ts: this host's dual-stack DNS resolution is unreliable for
// some AI provider hosts (intermittent getaddrinfo EAI_AGAIN).
setDefaultResultOrder("ipv4first");

const runtime = await createRuntime();
const definitions = features.flatMap((feature) => feature.schedules ?? []);
const tasks = definitions.map((definition) => cron.schedule(definition.cron, async () => {
  const client = await runtime.db.connect();
  try {
    const lock = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS locked", [definition.name]);
    if (!lock.rows[0]?.locked) return;
    try {
      await runtime.queue.publish(definition.kind, definition.payload?.() ?? {}, {
        queue: definition.queue,
        maxAttempts: definition.maxAttempts,
      });
      runtime.logger.info({ schedule: definition.name, kind: definition.kind }, "Scheduled durable job");
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [definition.name]);
    }
  } catch (error) {
    runtime.logger.error({ err: error, schedule: definition.name }, "Scheduled job trigger failed");
  } finally {
    client.release();
  }
}, { timezone: runtime.config.SCHEDULER_TIMEZONE }));

runtime.logger.info({ schedules: definitions.map((item) => item.name) }, "Scheduler started");
const keepAlive = setInterval(() => undefined, 60_000);

async function shutdown(signal: string) {
  runtime.logger.info({ signal }, "Shutting down scheduler");
  clearInterval(keepAlive);
  for (const task of tasks) task.stop();
  await runtime.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

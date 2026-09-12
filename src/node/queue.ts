import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Env } from "../types";
import worker from "../index";
import { PostgresD1Database } from "./postgres-d1";

type SelfHostedQueueOptions = { contentType?: "text" | "bytes" | "json" | "v8"; delaySeconds?: number };
type SelfHostedQueueRequest<T> = SelfHostedQueueOptions & { body: T };

export class PostgresQueue<T> {
  private readonly db: PostgresD1Database;
  readonly queueName: string;
  private readonly maxAttempts: number;
  constructor(db: PostgresD1Database, queueName: string, maxAttempts = 8) {
    this.db = db;
    this.queueName = queueName;
    this.maxAttempts = maxAttempts;
  }
  async send(body: T, options?: SelfHostedQueueOptions): Promise<void> {
    await this.db.prepare(`INSERT INTO selfhost_jobs
      (id, queue_name, payload, content_type, status, attempts, max_attempts, available_at)
      VALUES (?, ?, ?::jsonb, ?, 'queued', 0, ?, CURRENT_TIMESTAMP + (? * INTERVAL '1 second'))`)
      .bind(randomUUID(), this.queueName, JSON.stringify(body), options?.contentType ?? "json", this.maxAttempts, options?.delaySeconds ?? 0).run();
  }
  async sendBatch(messages: Iterable<SelfHostedQueueRequest<T>>): Promise<void> { for (const message of messages) await this.send(message.body, message); }
}

type LeasedJob = { id: string; queue_name: string; payload: unknown; attempts: number; max_attempts: number; created_at: Date };
type RetryState = { retry: boolean; delaySeconds?: number };

async function leaseJobs(pool: Pool, limit: number, workerId: string): Promise<LeasedJob[]> {
  const result = await pool.query<LeasedJob>(`WITH picked AS (
      SELECT id FROM selfhost_jobs WHERE status = 'queued' AND available_at <= CURRENT_TIMESTAMP
      ORDER BY available_at, created_at FOR UPDATE SKIP LOCKED LIMIT $1
    ) UPDATE selfhost_jobs AS jobs
    SET status = 'running', attempts = jobs.attempts + 1, locked_at = CURRENT_TIMESTAMP, locked_by = $2, updated_at = CURRENT_TIMESTAMP
    FROM picked WHERE jobs.id = picked.id
    RETURNING jobs.id, jobs.queue_name, jobs.payload, jobs.attempts, jobs.max_attempts, jobs.created_at`, [limit, workerId]);
  return result.rows;
}

async function settleJob(pool: Pool, job: LeasedJob, state: RetryState, error?: unknown): Promise<void> {
  if (!state.retry && !error) { await pool.query("UPDATE selfhost_jobs SET status='completed', locked_at=NULL, locked_by=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=$1", [job.id]); return; }
  const finalAttempt = job.attempts >= job.max_attempts;
  const delay = state.delaySeconds ?? Math.min(300, 2 ** Math.min(job.attempts, 8));
  await pool.query(`UPDATE selfhost_jobs SET status=$2,
      available_at=CASE WHEN $2='queued' THEN CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second') ELSE available_at END,
      locked_at=NULL, locked_by=NULL, last_error=$4, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
    [job.id, finalAttempt ? "dead" : "queued", delay, error instanceof Error ? error.message : error ? String(error) : null]);
}

async function dispatchQueue(env: Env, pool: Pool, queueName: string, jobs: LeasedJob[]): Promise<void> {
  const states = new Map<string, RetryState>(); jobs.forEach((job) => states.set(job.id, { retry: false }));
  const messages = jobs.map((job) => ({ id: job.id, timestamp: new Date(job.created_at), body: job.payload, attempts: job.attempts,
    ack: () => states.set(job.id, { retry: false }), retry: (options?: { delaySeconds?: number }) => states.set(job.id, { retry: true, delaySeconds: options?.delaySeconds }) }));
  const batch = { queue: queueName, messages,
    ackAll: () => jobs.forEach((job) => states.set(job.id, { retry: false })),
    retryAll: (options?: { delaySeconds?: number }) => jobs.forEach((job) => states.set(job.id, { retry: true, delaySeconds: options?.delaySeconds })) } as unknown as MessageBatch<unknown>;
  try {
    await worker.queue(batch as never, env);
    await Promise.all(jobs.map((job) => settleJob(pool, job, states.get(job.id) ?? { retry: false })));
  } catch (error) { await Promise.all(jobs.map((job) => settleJob(pool, job, { retry: true }, error))); }
}

export async function processQueueOnce(env: Env, db: PostgresD1Database, batchSize: number, workerId: string): Promise<number> {
  const jobs = await leaseJobs(db.pool, batchSize, workerId);
  const grouped = new Map<string, LeasedJob[]>();
  for (const job of jobs) grouped.set(job.queue_name, [...(grouped.get(job.queue_name) ?? []), job]);
  for (const [queueName, group] of grouped) await dispatchQueue(env, db.pool, queueName, group);
  return jobs.length;
}

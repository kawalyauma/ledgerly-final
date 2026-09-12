import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export type ClaimedJob = {
  id: string;
  queue: string;
  kind: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
};

export class PostgresQueue {
  constructor(private readonly pool: Pool) {}

  async publish(kind: string, payload: unknown, options?: { queue?: string; delaySeconds?: number; maxAttempts?: number }): Promise<string> {
    const id = randomUUID();
    await this.pool.query(`INSERT INTO backend_jobs
      (id, queue, kind, payload, status, attempts, max_attempts, available_at)
      VALUES ($1, $2, $3, $4::jsonb, 'queued', 0, $5, CURRENT_TIMESTAMP + ($6 * INTERVAL '1 second'))`,
      [id, options?.queue ?? "default", kind, JSON.stringify(payload ?? null), options?.maxAttempts ?? 8, options?.delaySeconds ?? 0]);
    return id;
  }

  async claim(limit: number, workerId: string): Promise<ClaimedJob[]> {
    const result = await this.pool.query(`WITH picked AS (
        SELECT id FROM backend_jobs
        WHERE status='queued' AND available_at<=CURRENT_TIMESTAMP
        ORDER BY available_at, created_at
        FOR UPDATE SKIP LOCKED LIMIT $1
      )
      UPDATE backend_jobs AS jobs
      SET status='running', attempts=jobs.attempts+1, locked_at=CURRENT_TIMESTAMP, locked_by=$2, updated_at=CURRENT_TIMESTAMP
      FROM picked WHERE jobs.id=picked.id
      RETURNING jobs.id, jobs.queue, jobs.kind, jobs.payload, jobs.attempts, jobs.max_attempts AS "maxAttempts"`, [limit, workerId]);
    return result.rows as ClaimedJob[];
  }

  async ack(id: string): Promise<void> {
    await this.pool.query("UPDATE backend_jobs SET status='completed', locked_at=NULL, locked_by=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=$1", [id]);
  }

  async fail(job: ClaimedJob, error: unknown): Promise<void> {
    const dead = job.attempts >= job.maxAttempts;
    const delay = Math.min(300, 2 ** Math.min(job.attempts, 8));
    await this.pool.query(`UPDATE backend_jobs
      SET status=$2, available_at=CASE WHEN $2='queued' THEN CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second') ELSE available_at END,
          last_error=$4, locked_at=NULL, locked_by=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE id=$1`, [job.id, dead ? "dead" : "queued", delay, error instanceof Error ? error.message : String(error)]);
  }

  async recoverStale(staleSeconds: number): Promise<number> {
    const result = await this.pool.query(`UPDATE backend_jobs SET status='queued', locked_at=NULL, locked_by=NULL, updated_at=CURRENT_TIMESTAMP
      WHERE status='running' AND locked_at < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 second')`, [staleSeconds]);
    return result.rowCount ?? 0;
  }
}

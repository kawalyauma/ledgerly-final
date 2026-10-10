import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";
import { getLedgerlyAiFoundationService } from "../ledgerly-ai/runtime-service.js";

export type EngineProvider = "codex" | "claude-code";
export type EngineState = "running" | "paused" | "stopped";
export type TaskKind = "scheme.source" | "scheme.outline" | "lesson.write" | "lesson.plan" | "page.analyze" | "student.summary" | "figure.generate";
/** Steps that do not call the AI (and so do not count towards the daily limit). */
const LOCAL_KINDS = new Set<TaskKind>(["scheme.source"]);

export type EngineSettings = {
  provider: EngineProvider; visionProvider: "codex"; state: EngineState; dailyTaskLimit: number; maxPromptChars: number;
  imageGeneration: boolean; dailyImageLimit: number;
};

export type ClaimedTask = {
  id: string; organizationId: string; kind: TaskKind; subjectRef: string; attempts: number; maxAttempts: number; requestedBy: string | null;
};

export type TaskContext = {
  runtime: Runtime;
  task: ClaimedTask;
  settings: EngineSettings;
  /** Runs one bounded AI step and returns the parsed JSON object it produced. */
  ai(input: { prompt: string; images?: Array<{ name: string; bytes: Uint8Array }>; vision?: boolean }): Promise<Record<string, unknown>>;
  /** A Codex step that may create files (e.g. a generated image) in /outputs; returns its reply text and the files. */
  aiWithFiles(input: { prompt: string; images?: Array<{ name: string; bytes: Uint8Array }> }): Promise<{ text: string; files: Array<{ name: string; bytes: Uint8Array }> }>;
  enqueue(kind: TaskKind, subjectRef: string, options?: { priority?: number }): Promise<void>;
};

type Handler = (ctx: TaskContext) => Promise<Record<string, unknown> | void>;
const handlers = new Map<TaskKind, Handler>();
export function registerTaskHandler(kind: TaskKind, handler: Handler) { handlers.set(kind, handler); }

export async function getSettings(runtime: Runtime, organizationId: string): Promise<EngineSettings> {
  const row = await runtime.db.query<EngineSettings>(
    `SELECT provider,vision_provider AS "visionProvider",state,daily_task_limit AS "dailyTaskLimit",max_prompt_chars AS "maxPromptChars",
            image_generation AS "imageGeneration",daily_image_limit AS "dailyImageLimit"
       FROM lrn_engine_settings WHERE organization_id=$1`, [organizationId]);
  return row.rows[0] ?? { provider: "codex", visionProvider: "codex", state: "running", dailyTaskLimit: 200, maxPromptChars: 40000, imageGeneration: true, dailyImageLimit: 40 };
}

export async function updateSettings(runtime: Runtime, organizationId: string, userId: string, patch: Partial<EngineSettings>) {
  const current = await getSettings(runtime, organizationId);
  const next = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as EngineSettings;
  await runtime.db.query(
    `INSERT INTO lrn_engine_settings(organization_id,provider,vision_provider,state,daily_task_limit,max_prompt_chars,image_generation,daily_image_limit,updated_by,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)
     ON CONFLICT(organization_id) DO UPDATE SET provider=EXCLUDED.provider,vision_provider=EXCLUDED.vision_provider,state=EXCLUDED.state,
       daily_task_limit=EXCLUDED.daily_task_limit,max_prompt_chars=EXCLUDED.max_prompt_chars,image_generation=EXCLUDED.image_generation,
       daily_image_limit=EXCLUDED.daily_image_limit,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP`,
    [organizationId, next.provider, next.visionProvider, next.state, next.dailyTaskLimit, next.maxPromptChars, next.imageGeneration, next.dailyImageLimit, userId]);
  if (next.state === "stopped") {
    // Stop also interrupts the step in progress; queued steps stay queued and resume when the engine is started again.
    const running = await runtime.db.query<{ id: string }>(`SELECT id FROM lrn_ai_tasks WHERE organization_id=$1 AND status='running'`, [organizationId]);
    for (const row of running.rows) getLedgerlyAiFoundationService(runtime).providers.cancel(row.id);
  }
  return next;
}

export async function enqueueTask(runtime: Runtime, organizationId: string, kind: TaskKind, subjectRef: string, options: { priority?: number; requestedBy?: string | null; delaySeconds?: number } = {}) {
  await runtime.db.query(
    `INSERT INTO lrn_ai_tasks(id,organization_id,kind,subject_ref,priority,requested_by,available_at)
     VALUES($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP + ($7 * INTERVAL '1 second'))
     ON CONFLICT (organization_id,kind,subject_ref) WHERE status IN ('queued','running') DO NOTHING`,
    [createId("ltsk"), organizationId, kind, subjectRef, options.priority ?? 100, options.requestedBy ?? null, options.delaySeconds ?? 0]);
}

/** Pulls the first JSON object out of a model reply (bare, or inside a ```json fence). */
export function parseJsonReply(text: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidates = [fenced, text].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const start = candidate.indexOf("{"), end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      const value = JSON.parse(candidate.slice(start, end + 1));
      if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* try the next candidate */ }
  }
  throw new Error("The AI reply did not contain a valid JSON object.");
}

export const GROUNDING_RULES = [
  "You are the curriculum engine of Ledgerly AI for a Ugandan school.",
  "Work ONLY from the passages, page images and records given in this prompt. Do not use outside knowledge, do not invent facts, topics, questions, answers or names.",
  "If the material does not cover something, leave it out or set the field to null and say so in \"gaps\". Never fill gaps from memory.",
  "Do not run commands, open files or browse. Everything you need is in this prompt.",
  "Reply with ONE JSON object only, exactly matching the requested shape. No prose before or after it.",
].join("\n");

const LEASE_MINUTES = 20;

async function claim(runtime: Runtime): Promise<ClaimedTask | null> {
  // Recover steps whose worker died, then take the highest-priority step of a school whose engine is running
  // and still under its daily AI step limit.
  await runtime.db.query(
    `UPDATE lrn_ai_tasks SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,
            error=COALESCE(error,'The step was interrupted and has been requeued.'),lease_until=NULL
      WHERE status='running' AND lease_until < CURRENT_TIMESTAMP`);
  const row = await runtime.db.query<ClaimedTask>(
    `UPDATE lrn_ai_tasks t SET status='running',attempts=t.attempts+1,started_at=CURRENT_TIMESTAMP,
            lease_until=CURRENT_TIMESTAMP + INTERVAL '${LEASE_MINUTES} minutes',error=NULL
      WHERE t.id=(
        SELECT q.id FROM lrn_ai_tasks q
          LEFT JOIN lrn_engine_settings s ON s.organization_id=q.organization_id
         WHERE q.status='queued' AND q.available_at<=CURRENT_TIMESTAMP AND COALESCE(s.state,'running')='running'
           AND (q.kind = ANY($1::text[]) OR (
             SELECT count(*) FROM lrn_ai_tasks d WHERE d.organization_id=q.organization_id AND d.provider IS NOT NULL
                AND d.started_at >= date_trunc('day', CURRENT_TIMESTAMP)) < COALESCE(s.daily_task_limit,200))
         ORDER BY q.priority, q.created_at FOR UPDATE OF q SKIP LOCKED LIMIT 1)
      RETURNING t.id,t.organization_id AS "organizationId",t.kind,t.subject_ref AS "subjectRef",t.attempts,
                t.max_attempts AS "maxAttempts",t.requested_by AS "requestedBy"`, [[...LOCAL_KINDS]]);
  return row.rows[0] ?? null;
}

async function runTask(runtime: Runtime, task: ClaimedTask) {
  const handler = handlers.get(task.kind);
  const settings = await getSettings(runtime, task.organizationId);
  const ai = getLedgerlyAiFoundationService(runtime);
  const meter = { provider: null as string | null, promptChars: 0, durationMs: 0, usage: [] as unknown[] };
  // Keep the lease alive and watch for Stop or a cancelled step while the AI works, from any API instance.
  const watcher = setInterval(() => {
    void runtime.db.query<{ cancel: boolean }>(
      `UPDATE lrn_ai_tasks t SET lease_until=CASE WHEN t.status='running' THEN CURRENT_TIMESTAMP + INTERVAL '${LEASE_MINUTES} minutes' ELSE t.lease_until END
         FROM (SELECT $1::text AS id) x LEFT JOIN lrn_engine_settings s ON s.organization_id=$2
        WHERE t.id=x.id
        RETURNING (t.status='cancelled' OR COALESCE(s.state,'running')='stopped') AS cancel`, [task.id, task.organizationId])
      .then(r => { if (r.rows[0]?.cancel) ai.providers.cancel(task.id); })
      .catch(() => undefined);
  }, 10_000);
  const ctx: TaskContext = {
    runtime, task, settings,
    async ai(input) {
      const provider: EngineProvider = input.images?.length ? settings.visionProvider : settings.provider;
      const root = path.join(ai.config.LEDGERLY_AI_WORK_ROOT, "learning", task.id);
      const attachmentRoot = path.join(root, "attachments");
      await mkdir(attachmentRoot, { recursive: true, mode: 0o700 });
      const imagePaths: string[] = [];
      for (const [index, image] of (input.images ?? []).entries()) {
        const target = path.join(attachmentRoot, `${index + 1}-${image.name.replace(/[^a-zA-Z0-9._-]+/g, "-")}`);
        await writeFile(target, image.bytes, { mode: 0o600 });
        imagePaths.push(target);
      }
      const prompt = `${GROUNDING_RULES}\n\n${input.prompt}`.slice(0, settings.maxPromptChars + 4000);
      try {
        const result = await ai.providers.execute({
          id: task.id, organizationId: task.organizationId, userId: task.requestedBy ?? "system:learning-engine",
          correlationId: `lrn:${task.id}`, prompt, taskKind: "analysis", sandbox: "read-only",
          workspacePath: path.join(root, "workspace"), attachmentRoot, imagePaths,
          providerOverride: provider, timeoutMs: 15 * 60_000,
        });
        meter.provider = result.provider;
        meter.promptChars += prompt.length;
        meter.durationMs += result.durationMs;
        meter.usage.push(result.usage ?? null);
        return parseJsonReply(result.text);
      } finally {
        await rm(root, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    async aiWithFiles(input) {
      const root = path.join(ai.config.LEDGERLY_AI_WORK_ROOT, "learning", `${task.id}-f${meter.usage.length}`);
      const attachmentRoot = path.join(root, "attachments"), outputRoot = path.join(root, "outputs");
      await Promise.all([mkdir(attachmentRoot, { recursive: true, mode: 0o777 }), mkdir(outputRoot, { recursive: true, mode: 0o777 })]);
      const imagePaths: string[] = [];
      for (const [index, image] of (input.images ?? []).entries()) {
        const target = path.join(attachmentRoot, `${index + 1}-${image.name.replace(/[^a-zA-Z0-9._-]+/g, "-")}`);
        await writeFile(target, image.bytes, { mode: 0o644 });
        imagePaths.push(target);
      }
      try {
        const result = await ai.providers.execute({
          id: task.id, organizationId: task.organizationId, userId: task.requestedBy ?? "system:learning-engine",
          correlationId: `lrn:${task.id}`, prompt: input.prompt, taskKind: "analysis", sandbox: "read-only",
          workspacePath: path.join(root, "workspace"), attachmentRoot, outputRoot, imagePaths,
          providerOverride: "codex", timeoutMs: 15 * 60_000,
        });
        meter.provider = result.provider;
        meter.promptChars += input.prompt.length;
        meter.durationMs += result.durationMs;
        meter.usage.push(result.usage ?? null);
        const files: Array<{ name: string; bytes: Uint8Array }> = [];
        for (const name of await readdir(outputRoot).catch(() => [] as string[])) {
          const full = path.join(outputRoot, name);
          const info = await stat(full);
          if (info.isFile() && info.size > 0 && info.size < 25 * 1024 * 1024) files.push({ name, bytes: new Uint8Array(await readFile(full)) });
        }
        return { text: result.text, files };
      } finally {
        await rm(root, { recursive: true, force: true }).catch(() => undefined);
      }
    },
    async enqueue(kind, subjectRef, options) {
      await enqueueTask(runtime, task.organizationId, kind, subjectRef, { priority: options?.priority, requestedBy: task.requestedBy });
    },
  };
  try {
    if (!handler) throw new Error(`No learning engine handler for ${task.kind}`);
    const result = await handler(ctx);
    await runtime.db.query(
      `UPDATE lrn_ai_tasks SET status='succeeded',finished_at=CURRENT_TIMESTAMP,lease_until=NULL,provider=$2,prompt_chars=$3,duration_ms=$4,usage=$5::jsonb,result=$6::jsonb
        WHERE id=$1 AND status='running'`,
      [task.id, meter.provider, meter.promptChars || null, meter.durationMs || null, JSON.stringify(meter.usage), JSON.stringify(result ?? {})]);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 4000);
    const state = await runtime.db.query<{ status: string; stopped: boolean }>(
      `SELECT t.status,COALESCE(s.state,'running')='stopped' AS stopped FROM lrn_ai_tasks t
         LEFT JOIN lrn_engine_settings s ON s.organization_id=t.organization_id WHERE t.id=$1`, [task.id]);
    const interrupted = state.rows[0]?.status === "cancelled" || state.rows[0]?.stopped;
    // A stopped engine returns the step to the queue untouched; real failures retry with backoff, then fail.
    await runtime.db.query(
      `UPDATE lrn_ai_tasks SET status=CASE WHEN status='cancelled' THEN 'cancelled' WHEN $3 THEN 'queued' WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,
              attempts=CASE WHEN $3 AND status<>'cancelled' THEN GREATEST(attempts-1,0) ELSE attempts END,
              available_at=CURRENT_TIMESTAMP + (CASE WHEN $3 THEN 0 ELSE LEAST(600, 30 * attempts * attempts) END * INTERVAL '1 second'),
              lease_until=NULL,finished_at=CURRENT_TIMESTAMP,error=$2,provider=COALESCE($4,provider),prompt_chars=$5,duration_ms=$6
        WHERE id=$1`,
      [task.id, interrupted ? "Stopped by the engine switch." : message, Boolean(interrupted), meter.provider, meter.promptChars || null, meter.durationMs || null]);
    const final = await runtime.db.query<{ status: string }>("SELECT status FROM lrn_ai_tasks WHERE id=$1", [task.id]);
    if (final.rows[0]?.status === "failed") await failureHooks.get(task.kind)?.(runtime, task, message).catch(() => undefined);
    runtime.logger.warn({ taskId: task.id, kind: task.kind, err: message, interrupted }, "Learning engine step did not complete");
  } finally {
    clearInterval(watcher);
  }
}

type FailureHook = (runtime: Runtime, task: ClaimedTask, message: string) => Promise<void>;
const failureHooks = new Map<TaskKind, FailureHook>();
/** Called once a step has used up its retries, so the scheme, lesson or page can show the failure. */
export function onTaskFailed(kind: TaskKind, hook: FailureHook) { failureHooks.set(kind, hook); }

const started = new WeakSet<Runtime>();
/** Starts the engine loop in this process. Steps run one at a time per process; leases make several processes safe. */
export function startEngine(runtime: Runtime, concurrency = 2) {
  if (started.has(runtime)) return;
  started.add(runtime);
  let active = 0;
  const tick = async () => {
    while (active < concurrency) {
      const task = await claim(runtime).catch(error => { runtime.logger.error({ err: error }, "Learning engine claim failed"); return null; });
      if (!task) return;
      active += 1;
      void runTask(runtime, task).finally(() => { active -= 1; });
    }
  };
  const timer = setInterval(() => { void tick(); }, 5_000);
  timer.unref?.();
}

/**
 * Parses an AI reply against a schema, trimming over-long strings and lists instead of rejecting the whole step
 * (a lesson should not fail because one label ran a few characters long). Other problems still fail.
 */
export function parseLenient<T extends import("zod").ZodTypeAny>(schema: T, value: unknown): import("zod").infer<T> {
  let current = structuredClone(value);
  for (let round = 0; round < 25; round += 1) {
    const result = schema.safeParse(current);
    if (result.success) return result.data;
    let fixed = false;
    for (const issue of result.error.issues as Array<{ code: string; path: PropertyKey[]; maximum?: number | bigint }>) {
      if (issue.code !== "too_big" || issue.maximum === undefined || !issue.path.length) continue;
      let parent: any = current;
      for (const key of issue.path.slice(0, -1)) parent = parent?.[key as never];
      const key = issue.path.at(-1) as never;
      const target = parent?.[key];
      const max = Number(issue.maximum);
      if (typeof target === "string") { parent[key] = target.slice(0, max); fixed = true; }
      else if (Array.isArray(target)) { parent[key] = target.slice(0, max); fixed = true; }
      else if (typeof target === "number") { parent[key] = max; fixed = true; }
    }
    if (!fixed) throw result.error;
  }
  return schema.parse(current);
}

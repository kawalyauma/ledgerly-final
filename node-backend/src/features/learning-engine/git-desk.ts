import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Runtime } from "../../runtime.js";
import { classDepthBrief, loadScheme, schemeSources, type SchemeRow } from "./schemes.js";
import { failQueuedTask, type GitJobMeta } from "./engine.js";

// The git desk publishes "git" provider calls as jobs in the Ledgerly Resources Bank repo, with a resource pack per
// scheme, and imports the agents' answers back. The repo's README is the contract; tools/check.py is the agents' side
// of the same checks done here. Git is the only link: either side can be offline.

const run = promisify(execFile);
// Push access: a deploy key (preferred: the private key never leaves the server) or a token.
const SSH_KEY = process.env.LRN_GITDESK_SSH_KEY ?? "";
const REPO = process.env.LRN_GITDESK_REPO ?? (SSH_KEY ? "git@github.com:kawalyauma/ledgerly-resources-bank.git" : "https://github.com/kawalyauma/ledgerly-resources-bank.git");
const BRANCH = process.env.LRN_GITDESK_BRANCH ?? "main";
const TOKEN = process.env.LRN_GITDESK_TOKEN ?? "";
const INTERVAL_MS = Math.max(30, Number(process.env.LRN_GITDESK_INTERVAL_SECONDS ?? 120)) * 1000;
const MAX_ATTEMPTS = 3;
const LOCK = 731_051; // pg advisory lock: one sync at a time across API instances

type Call = {
  taskId: string; callIndex: number; organizationId: string; kind: string; subjectRef: string; prompt: string; reply: string | null;
  error: string | null; job: GitJobMeta | null; attempt: number; exportedAttempt: number | null; agent: string | null;
  problems: string[] | null; taskStatus: string; createdAt: string;
};
type Status = { enabled: boolean; lastSyncAt: string | null; lastError: string | null; lastResult: Record<string, number> | null };
const CONFIGURED = Boolean(TOKEN || SSH_KEY);
const status: Status = { enabled: CONFIGURED, lastSyncAt: null, lastError: null, lastResult: null };

export const jobIdOf = (c: { taskId: string; callIndex: number }) => `${c.taskId}-${c.callIndex}`;
const slug = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const sha = (v: string) => createHash("sha1").update(v).digest("hex");
const schoolCode = (organizationId: string) => `sch-${sha(organizationId).slice(0, 6)}`;
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
function classLevel(className: string) {
  const m = /\b(?:p|primary)\s*\.?\s*(\d|one|two|three|four|five|six|seven)\b/i.exec(className);
  if (!m) return null;
  return WORDS[m[1]!.toLowerCase()] ?? Number(m[1]);
}
function termLabel(scheme: SchemeRow) {
  const year = /\b(20\d\d)\b/.exec(`${scheme.termName} ${scheme.className}`)?.[1] ?? String(new Date().getFullYear());
  const term = /\b(\d)\b/.exec(scheme.termName.replace(/20\d\d/g, ""))?.[1] ?? "x";
  return `${year}-T${term}`;
}
function classCode(className: string) {
  const level = classLevel(className);
  return level ? `P${level}` : slug(className.replace(/\b20\d\d\b/g, "")).toUpperCase();
}
export function packPath(scheme: SchemeRow) {
  return path.posix.join("library", schoolCode(scheme.organizationId), termLabel(scheme), classCode(scheme.className), slug(scheme.subjectName));
}

// ------------------------------------------------------------------ git

async function git(dir: string, args: string[], allowFail = false) {
  const auth = TOKEN ? ["-c", `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${TOKEN}`).toString("base64")}`] : [];
  try {
    const env = SSH_KEY ? { ...process.env, GIT_SSH_COMMAND: `ssh -i ${SSH_KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${path.join(path.dirname(SSH_KEY), "known_hosts")}` } : process.env;
    const r = await run("git", [...auth, "-c", "user.name=Ledgerly", "-c", "user.email=ledgerly-bot@notesug.com", ...args], { cwd: dir, env, maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60_000 });
    return r.stdout.trim();
  } catch (error) {
    if (allowFail) return null;
    const e = error as { stderr?: string; message: string };
    throw new Error(`git ${args[0]} failed: ${(e.stderr || e.message).replace(TOKEN || "\u0000", "***").slice(0, 600)}`);
  }
}

async function workDir(runtime: Runtime) {
  return process.env.LRN_GITDESK_DIR ?? path.join(runtime.config.STORAGE_LOCAL_ROOT, "gitdesk", "ledgerly-resources-bank");
}

/** A clean checkout of origin/BRANCH: everything Ledgerly writes is regenerated from the database, so local leftovers can go. */
async function freshCheckout(dir: string) {
  const exists = await stat(path.join(dir, ".git")).then(() => true, () => false);
  if (!exists) {
    await mkdir(path.dirname(dir), { recursive: true });
    await rm(dir, { recursive: true, force: true });
    await git(path.dirname(dir), ["clone", "--branch", BRANCH, REPO, dir]);
    return;
  }
  await git(dir, ["fetch", "--prune", "origin", BRANCH]);
  await git(dir, ["reset", "--hard", `origin/${BRANCH}`]);
  await git(dir, ["clean", "-fdq"]);
}

/** Commits everything and pushes; on a race with an agent's push it rebases (the two sides never touch the same files). */
async function commitAndPush(dir: string, message: string) {
  await git(dir, ["add", "-A"]);
  if (!(await git(dir, ["status", "--porcelain"]))) return false;
  await git(dir, ["commit", "-q", "-m", message]);
  for (let i = 0; i < 4; i += 1) {
    if (await git(dir, ["push", "-q", "origin", `HEAD:${BRANCH}`], true) !== null) return true;
    await git(dir, ["pull", "-q", "--rebase", "origin", BRANCH]);
  }
  throw new Error("Could not push to the resources bank after 4 tries");
}

// ------------------------------------------------------------------ text helpers shared with tools/check.py

/** Same normalisation as tools/check.py: case, accents, spacing and punctuation don't matter; simple LaTeX is flattened. */
export function flattenLatex(text: string) {
  return text.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "$1/$2").replace(/\\times|\\cdot/g, "x").replace(/\\div/g, "/").replace(/\$/g, "");
}
const squash = (v: string) => flattenLatex(v).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
const SOURCE_COMMENT = /<!--\s*source:\s*(\S+)\s+"([^"]+)"\s*-->/g;

export function passageBlock(p: { id: string; seq: number; content: string }) {
  return `<!-- passage ${p.id} part ${p.seq + 1} -->\n${p.content.trim()}\n<!-- /passage -->`;
}

// ------------------------------------------------------------------ packs

const PACK_RULES = [
  "## House rules",
  "- **Assemble, never invent.** Notes, examples, activities, answers and classroom activities all come from `sources/`.",
  "- Use the variety of sources: different notes, workbooks, drafts, teacher guides and past papers.",
  "- **Notes are in point form** (see AGENT.md, Chalkboard notes): '- ' points of 3–15 words under ### headings such as Examples of…, Reasons why…, Problems faced by…, Possible solutions…; a closing `### Note`. No paragraphs, no padding.",
  "- Activity = exercise (the same thing).",
  "- Examples (worked examples) only in Mathematics, English and Reading.",
  "- One lesson = one 40-minute period. Lessons of kind `practice` are **Part B** lessons that continue the previous subtopic with new sourced activities (and examples where allowed).",
  "- Maths in LaTeX; column sums and long division as coded figures.",
].join("\n");

async function writePack(runtime: Runtime, dir: string, scheme: SchemeRow) {
  const rel = packPath(scheme);
  const sources = await schemeSources(runtime, scheme.id);
  const chunks = await runtime.db.query<{ id: string; sourceId: string; seq: number; content: string }>(
    `SELECT id,source_id AS "sourceId",seq,content FROM lrn_source_chunks WHERE source_id=ANY($1::text[]) AND organization_id=$2 ORDER BY source_id,seq`,
    [sources.map(s => s.id), scheme.organizationId]);
  const lessons = await runtime.db.query<{ id: string; seq: number; week: number | null; title: string; subtopic: string | null; kind: string; status: string; notes: string | null; unit: string }>(
    `SELECT l.id,l.seq,l.week,l.title,l.subtopic,l.lesson_kind AS kind,l.status,l.notes_markdown AS notes,u.title AS unit
       FROM lrn_lessons l JOIN lrn_units u ON u.id=l.unit_id WHERE l.scheme_id=$1 ORDER BY l.seq`, [scheme.id]);
  const fingerprint = sha(JSON.stringify([sources.map(s => [s.id, s.role]), chunks.rows.length, lessons.rows.map(l => [l.id, l.status, l.title, l.notes?.length ?? 0])]));
  const known = await runtime.db.query<{ fingerprint: string }>(`SELECT fingerprint FROM lrn_git_packs WHERE scheme_id=$1`, [scheme.id]);
  const exists = await stat(path.join(dir, rel, "GUIDE.md")).then(() => true, () => false);
  if (known.rows[0]?.fingerprint === fingerprint && exists) return { rel, changed: false, fingerprint };

  const root = path.join(dir, rel);
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, "sources"), { recursive: true });
  await mkdir(path.join(root, "lessons"), { recursive: true });
  const level = classLevel(scheme.className);
  await writeFile(path.join(root, "GUIDE.md"), [
    `# ${scheme.subjectName} · ${scheme.className} · ${scheme.termName}`, "",
    `- Class level: ${level ? `P${level}` : scheme.className}`,
    `- Weeks: ${scheme.weeks}`, `- Periods per week: ${scheme.periodsPerWeek}`, "- Lesson length: 40 minutes (one period)",
    `- Examples allowed: ${/math|english|reading|literacy|phonics/i.test(scheme.subjectName) ? "yes" : "no (not Mathematics, English or Reading)"}`,
    `- Class depth: ${classDepthBrief(scheme.className)}`, "", PACK_RULES, "",
    "## Files", "- `sources/INDEX.md`: every source, its role and passage count", "- `sources/<id>.md`: the passages (cite them by passage id)",
    "- `scheme.json` / `scheme.md`: the accepted outline (once written)", "- `lessons/`: lessons already written, so later weeks build on them", "",
  ].join("\n"));
  const bySource = new Map<string, typeof chunks.rows>();
  for (const c of chunks.rows) bySource.set(c.sourceId, [...(bySource.get(c.sourceId) ?? []), c]);
  const index = ["# Sources", "", "| id | title | role | provider | passages |", "|---|---|---|---|---|"];
  for (const s of sources) {
    const list = bySource.get(s.id) ?? [];
    index.push(`| ${s.id} | ${s.title.replace(/\|/g, "/")} | ${s.role} | ${s.provider} | ${list.length} |`);
    await writeFile(path.join(root, "sources", `${s.id}.md`),
      [`# ${s.title}`, "", `Role: ${s.role} · Provider: ${s.provider} · Source id: ${s.id}`, "", ...list.map(passageBlock), ""].join("\n\n"));
  }
  await writeFile(path.join(root, "sources", "INDEX.md"), `${index.join("\n")}\n`);
  if (lessons.rows.length) {
    const units = await runtime.db.query<{ title: string; theme: string | null; weekFrom: number | null; weekTo: number | null }>(
      `SELECT title,theme,week_from AS "weekFrom",week_to AS "weekTo" FROM lrn_units WHERE scheme_id=$1 ORDER BY seq`, [scheme.id]);
    await writeFile(path.join(root, "scheme.json"), json({ units: units.rows, lessons: lessons.rows.map(({ notes: _n, ...l }) => l) }));
    await writeFile(path.join(root, "scheme.md"), ["# Scheme outline", "", "| # | week | kind | unit | lesson | status |", "|---|---|---|---|---|---|",
      ...lessons.rows.map(l => `| ${l.seq} | ${l.week ?? ""} | ${l.kind === "practice" ? "Part B" : l.kind} | ${l.unit.replace(/\|/g, "/")} | ${`${l.title}${l.subtopic ? ` — ${l.subtopic}` : ""}`.replace(/\|/g, "/")} | ${l.status} |`), ""].join("\n"));
    for (const l of lessons.rows.filter(x => ["written", "reviewed"].includes(x.status) && x.notes))
      await writeFile(path.join(root, "lessons", `${String(l.seq).padStart(3, "0")}-${l.id}.md`), `<!-- week ${l.week} · ${l.status} -->\n${l.notes}\n`);
  }
  return { rel, changed: true, fingerprint };
}

// ------------------------------------------------------------------ export

const ANSWER_NOTE = [
  "---",
  "",
  "## Answer format (Ledgerly Resources Bank)",
  "",
  "Ignore the 'Reply with ONE JSON object' and 'Reply shape' lines above: answer as a FOLDER in `jobs/outbox/<job>/`,",
  "exactly as `AGENT.md` and `README.md` describe (notes `.md`, plan and activities `.json`, `figures/`, `meta.json`),",
  "then run `python3 tools/check.py <job>`. The field meanings above still apply. Nothing may be invented: every",
  "note section, example, activity and classroom activity cites a passage with an exact quote.",
].join("\n");

async function loadCalls(runtime: Runtime, where: string) {
  return (await runtime.db.query<Call>(
    `SELECT m.task_id AS "taskId",m.call_index AS "callIndex",m.organization_id AS "organizationId",m.kind,m.subject_ref AS "subjectRef",m.prompt,m.reply,m.error,
            m.job,m.attempt,m.exported_attempt AS "exportedAttempt",m.agent,m.problems,t.status AS "taskStatus",m.created_at AS "createdAt"
       FROM lrn_manual_calls m JOIN lrn_ai_tasks t ON t.id=m.task_id
      WHERE m.channel='git' AND m.closed_at IS NULL AND ${where} ORDER BY m.created_at`)).rows;
}

async function jobPassages(runtime: Runtime, call: Call) {
  const ids = [...call.prompt.matchAll(/<passage id="([^"]+)"/g)].map(m => m[1]!);
  if (call.kind === "lesson.plan") {
    const r = await runtime.db.query<{ ids: string[] }>(`SELECT source_chunk_ids AS ids FROM lrn_lessons WHERE id=$1`, [call.subjectRef]);
    ids.push(...(r.rows[0]?.ids ?? []));
  }
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  return (await runtime.db.query<{ id: string; seq: number; content: string }>(
    `SELECT id,seq,content FROM lrn_source_chunks WHERE id=ANY($1::text[]) AND organization_id=$2 ORDER BY array_position($1::text[], id)`, [unique, call.organizationId])).rows;
}

async function exportCall(runtime: Runtime, dir: string, call: Call, packs: Map<string, string>) {
  const meta = call.job ?? { schemeId: call.subjectRef };
  const scheme = await loadScheme(runtime, call.organizationId, meta.schemeId);
  let pack = packs.get(scheme.id);
  if (!pack) {
    const written = await writePack(runtime, dir, scheme);
    pack = written.rel;
    packs.set(scheme.id, pack);
    if (written.changed) await runtime.db.query(
      `INSERT INTO lrn_git_packs(scheme_id,organization_id,path,fingerprint) VALUES($1,$2,$3,$4)
       ON CONFLICT(scheme_id) DO UPDATE SET path=EXCLUDED.path,fingerprint=EXCLUDED.fingerprint,exported_at=CURRENT_TIMESTAMP`, [scheme.id, scheme.organizationId, pack, written.fingerprint]);
  }
  const id = jobIdOf(call);
  const root = path.join(dir, "jobs", "inbox", id);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const passages = await jobPassages(runtime, call);
  const job = {
    job: id, task: call.taskId, call: call.callIndex, kind: call.kind, status: "open", attempt: call.attempt, priority: await taskPriority(runtime, call.taskId),
    school: schoolCode(scheme.organizationId), class: classCode(scheme.className), classLevel: classLevel(scheme.className), subject: scheme.subjectName,
    term: termLabel(scheme), week: meta.week ?? null, weeks: meta.weeks ?? scheme.weeks, periodsPerWeek: meta.periodsPerWeek ?? scheme.periodsPerWeek,
    lessons: meta.lessons ?? [], repair: meta.repairOf !== undefined, pack, passages: passages.map(p => p.id), created: new Date(call.createdAt).toISOString(),
  };
  await writeFile(path.join(root, "job.json"), json(job));
  await writeFile(path.join(root, "prompt.md"), `# Job ${id}\n\n${call.prompt}\n\n${ANSWER_NOTE}\n`);
  await writeFile(path.join(root, "passages.md"), `# Passages quoted in this job's prompt\n\n${passages.map(passageBlock).join("\n\n")}\n`);
  if (call.attempt > 1 && call.problems?.length) await writeFeedback(dir, id, call.attempt - 1, call.problems);
}

async function taskPriority(runtime: Runtime, taskId: string) {
  return (await runtime.db.query<{ priority: number }>(`SELECT priority FROM lrn_ai_tasks WHERE id=$1`, [taskId])).rows[0]?.priority ?? 50;
}

async function writeFeedback(dir: string, id: string, attempt: number, problems: string[]) {
  await mkdir(path.join(dir, "jobs", "feedback"), { recursive: true });
  await writeFile(path.join(dir, "jobs", "feedback", `${id}.md`), [
    `# Feedback on ${id} (attempt ${attempt})`, "",
    "Ledgerly rejected this answer. Fix exactly these problems, set `attempt` in meta.json to the job's new attempt, run tools/check.py and push again:", "",
    ...problems.map(p => `- ${p}`), "",
  ].join("\n"));
}

/** The files a complete answer needs (see the repo's README/AGENT.md), and which of them the folder lacks. */
async function missingAnswerFiles(call: Call, answerDir: string) {
  const lessons = call.job?.lessons ?? [];
  const need = call.kind === "scheme.outline" ? ["scheme.json"]
    : call.kind === "lesson.plan" ? lessons.slice(0, 1).map(l => `${l.id}.plan.json`)
    : lessons.flatMap(l => [`${l.id}.notes.md`, `${l.id}.plan.json`, `${l.id}.activities.json`]);
  const have = new Set(await readdir(answerDir).catch(() => [] as string[]));
  return [...need, "meta.json"].filter(f => !have.has(f));
}

async function writeIncomplete(dir: string, call: Call, answerDir: string) {
  const id = jobIdOf(call), missing = await missingAnswerFiles(call, answerDir);
  const file = path.join(dir, "jobs", "feedback", `${id}.md`);
  const body = [
    `# ${id} is NOT DONE (attempt ${call.attempt})`, "",
    "The answer folder is an unfinished draft, so Ledgerly has not imported it. Do not report this job as complete.",
    "Add the missing files, run `python3 tools/check.py " + id + "` until it prints PASS, then push. Missing:", "",
    ...missing.map(f => `- jobs/outbox/${id}/${f}`), "",
  ].join("\n");
  if ((await readFile(file, "utf8").catch(() => "")) === body) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
  return true;
}

async function setJobStatus(dir: string, id: string, patch: Record<string, unknown>) {
  const file = path.join(dir, "jobs", "inbox", id, "job.json");
  const current = JSON.parse(await readFile(file, "utf8").catch(() => "null"));
  if (current) await writeFile(file, json({ ...current, ...patch }));
}

// ------------------------------------------------------------------ import (folder → the reply shape the handlers parse)

type Cite = { source: string; quote: string };
const readJson = async <T>(file: string): Promise<T | null> => JSON.parse(await readFile(file, "utf8").catch(() => "null")) as T | null;

async function passageTexts(runtime: Runtime, call: Call) {
  const schemeId = call.job?.schemeId ?? call.subjectRef;
  const rows = await runtime.db.query<{ id: string; content: string }>(
    `SELECT c.id,c.content FROM lrn_source_chunks c JOIN lrn_scheme_sources ss ON ss.source_id=c.source_id WHERE ss.scheme_id=$1 AND c.organization_id=$2`,
    [schemeId, call.organizationId]);
  return new Map(rows.rows.map(r => [r.id, squash(r.content)]));
}

function verifyCite(cite: Cite | undefined, where: string, texts: Map<string, string>, problems: string[]) {
  if (!cite?.source) { problems.push(`${where}: no source`); return null; }
  const text = texts.get(cite.source);
  if (!text) { problems.push(`${where}: '${cite.source}' is not a passage of this scheme's resources`); return null; }
  const q = squash(cite.quote ?? "");
  if (q.length < 6 || !text.includes(q)) { problems.push(`${where}: quote not found in ${cite.source} (invented?): "${(cite.quote ?? "").slice(0, 80)}"`); return null; }
  return cite.source;
}

function planToEngine(plan: Record<string, unknown>) {
  const steps = (plan.steps as Array<Record<string, unknown>> | undefined ?? []).map(({ source: _s, ...step }) => step);
  return { ...plan, steps };
}

async function convertAnswer(runtime: Runtime, call: Call, answerDir: string): Promise<{ reply?: Record<string, unknown>; problems: string[]; agent: string }> {
  const problems: string[] = [];
  const meta = await readJson<{ attempt?: number; agent?: string; model?: string; gaps?: Record<string, string[]> }>(path.join(answerDir, "meta.json"));
  const agent = `${meta?.agent ?? "unknown"}${meta?.model ? `/${meta.model}` : ""}`.slice(0, 120);
  if (!meta) return { problems: ["meta.json is missing or not valid JSON"], agent };
  const texts = await passageTexts(runtime, call);
  if (call.kind === "scheme.outline") {
    const scheme = await readJson<{ title?: string; summary?: string; gaps?: string[]; units?: Array<Record<string, unknown> & { sources?: Cite[]; lessons?: Array<Record<string, unknown> & { sources?: Cite[] }> }> }>(path.join(answerDir, "scheme.json"));
    if (!scheme?.units?.length) return { problems: ["scheme.json is missing, invalid or has no units"], agent };
    const units = scheme.units.map((u, i) => ({
      title: u.title, theme: u.theme ?? null, weekFrom: u.weekFrom ?? null, weekTo: u.weekTo ?? null, competences: u.competences ?? null,
      sourcePassageIds: (u.sources ?? []).map((c, k) => verifyCite(c, `scheme.json units[${i}].sources[${k}]`, texts, problems)).filter(Boolean),
      lessons: (u.lessons ?? []).map((l, j) => ({
        title: l.title, subtopic: l.subtopic ?? null, week: l.week ?? null, periods: 1, kind: l.kind ?? "teach", objectives: l.objectives ?? [],
        sourcePassageIds: (l.sources ?? []).map((c, k) => verifyCite(c, `scheme.json units[${i}].lessons[${j}].sources[${k}]`, texts, problems)).filter(Boolean),
      })),
    }));
    return { reply: { title: scheme.title ?? null, summary: scheme.summary ?? null, units, gaps: [...(scheme.gaps ?? []), ...(meta.gaps?.scheme ?? [])] }, problems, agent };
  }
  const lessons = call.job?.lessons ?? [];
  if (!lessons.length) return { problems: ["this job has no lessons listed (job metadata missing)"], agent };
  if (call.kind === "lesson.plan") {
    const plan = await readJson<Record<string, unknown>>(path.join(answerDir, `${lessons[0]!.id}.plan.json`));
    if (!plan) return { problems: [`${lessons[0]!.id}.plan.json is missing or not valid JSON`], agent };
    return { reply: { lessonPlan: planToEngine(plan) }, problems, agent };
  }
  // lesson.write
  const figures = new Map<string, Record<string, unknown>>();
  const figDir = path.join(answerDir, "figures");
  for (const name of await readdir(figDir).catch(() => [] as string[])) {
    if (!name.endsWith(".json")) continue;
    const fig = await readJson<Record<string, unknown>>(path.join(figDir, name));
    if (!fig?.key) { problems.push(`figures/${name} is not valid`); continue; }
    if (fig.method === "svg") fig.svg = await readFile(path.join(figDir, `${fig.key}.svg`), "utf8").catch(() => null);
    figures.set(String(fig.key), fig);
  }
  const out: Array<Record<string, unknown>> = [];
  for (const l of lessons) {
    const base = path.join(answerDir, l.id);
    const notesRaw = await readFile(`${base}.notes.md`, "utf8").catch(() => null);
    const plan = await readJson<Record<string, unknown> & { methods?: string[]; materials?: string[]; lifeSkills?: string[]; assessment?: string; steps?: Array<Record<string, unknown>> }>(`${base}.plan.json`);
    const acts = await readJson<Array<Record<string, unknown> & { source?: Cite }>>(`${base}.activities.json`);
    if (notesRaw === null) { problems.push(`${l.id}.notes.md is missing`); continue; }
    if (!plan) problems.push(`${l.id}.plan.json is missing or not valid JSON`);
    if (!Array.isArray(acts)) { problems.push(`${l.id}.activities.json is missing or not a JSON array`); continue; }
    const used = new Set<string>();
    for (const m of notesRaw.matchAll(SOURCE_COMMENT)) {
      const id = verifyCite({ source: m[1]!, quote: m[2]! }, `${l.id}.notes.md`, texts, problems);
      if (id) used.add(id);
    }
    const notes = notesRaw.replace(/[ \t]*<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n").trim();
    const activities = acts.map((a, i) => {
      const id = verifyCite(a.source, `${l.id}.activities.json[${i}]`, texts, problems);
      if (id) used.add(id);
      return {
        question: a.question, answer: a.answer ?? null, options: a.options ?? null, kind: a.kind ?? null, concept: a.concept ?? null, skill: a.skill ?? null,
        cognitiveLevel: a.cognitiveLevel ?? null, difficulty: a.difficulty ?? null, origin: "source",
        sourcePassageId: id, sourceQuote: a.source?.quote ? flattenLatex(a.source.quote) : null,
      };
    });
    const diagrams = [...figures.values()].filter(f => f.lesson === l.id).map(f => {
      const id = verifyCite(f.source as Cite | undefined, `figures/${f.key}.json`, texts, problems);
      return { key: f.key, title: f.title, caption: f.caption ?? null, method: f.method, concept: f.concept ?? null, parts: f.parts ?? [], coded: f.coded ?? null, svg: f.svg ?? null, sourcePassageId: id };
    });
    const steps = plan?.steps ?? [];
    out.push({
      lessonId: l.id, notes, sourcePassageIds: [...used],
      methods: plan?.methods?.join(", ") ?? null, materials: plan?.materials?.join(", ") || null, lifeSkills: plan?.lifeSkills?.join(", ") || null,
      assessment: plan?.assessment ?? null,
      teachingGuide: steps.map(s => `${s.stage} (${s.minutes} min). Teacher: ${s.teacherActivity} Learners: ${s.learnerActivity}`).join("\n") || null,
      lessonPlan: plan ? planToEngine(plan) : null, diagrams, activities, gaps: meta.gaps?.[l.id] ?? [],
    });
  }
  return { reply: { lessons: out }, problems, agent };
}

// ------------------------------------------------------------------ one sync

async function reopen(runtime: Runtime, dir: string, call: Call, problems: string[]) {
  const id = jobIdOf(call);
  const next = call.attempt + 1;
  await writeFeedback(dir, id, call.attempt, problems);
  if (next > MAX_ATTEMPTS) {
    await runtime.db.query(`UPDATE lrn_manual_calls SET problems=$3::jsonb,closed_at=CURRENT_TIMESTAMP,agent=NULL WHERE task_id=$1 AND call_index=$2`, [call.taskId, call.callIndex, JSON.stringify(problems)]);
    await failQueuedTask(runtime, call.taskId, `The resources bank job ${id} was rejected ${MAX_ATTEMPTS} times: ${problems.slice(0, 5).join("; ")}`);
    await setJobStatus(dir, id, { status: "failed", attempt: call.attempt });
    return "failed";
  }
  await runtime.db.query(`UPDATE lrn_manual_calls SET attempt=$3,problems=$4::jsonb,agent=NULL,reply=NULL WHERE task_id=$1 AND call_index=$2`,
    [call.taskId, call.callIndex, next, JSON.stringify(problems)]);
  await setJobStatus(dir, id, { status: "open", attempt: next });
  return "reopened";
}

async function syncOnce(runtime: Runtime) {
  const dir = await workDir(runtime);
  await freshCheckout(dir);
  const counts = { exported: 0, imported: 0, rejected: 0, failed: 0, done: 0, cancelled: 0, packs: 0, incomplete: 0 };
  const after: Array<() => Promise<unknown>> = [];

  // 1. Answers waiting in the outbox for the current attempt.
  const waiting = new Map((await loadCalls(runtime, "m.reply IS NULL AND m.agent IS NULL")).map(c => [jobIdOf(c), c]));
  for (const id of await readdir(path.join(dir, "jobs", "outbox")).catch(() => [] as string[])) {
    const call = waiting.get(id);
    if (!call || call.taskStatus !== "queued") continue;
    const answerDir = path.join(dir, "jobs", "outbox", id);
    const meta = await readJson<{ attempt?: number }>(path.join(answerDir, "meta.json"));
    // A folder without meta.json is an unfinished draft: say exactly what is missing, so nobody mistakes it for done.
    if (!meta) { if (await writeIncomplete(dir, call, answerDir)) counts.incomplete += 1; continue; }
    if (meta.attempt !== call.attempt) continue; // an old answer: the agent hasn't redone it yet
    const { reply, problems, agent } = await convertAnswer(runtime, call, answerDir);
    if (!reply || problems.length) {
      const r = await reopen(runtime, dir, call, problems.length ? problems.slice(0, 40) : ["the answer could not be read"]);
      if (r === "failed") counts.failed += 1; else counts.rejected += 1;
      continue;
    }
    await runtime.db.query(`UPDATE lrn_manual_calls SET reply=$3,error=NULL,answered_at=CURRENT_TIMESTAMP,agent=$4 WHERE task_id=$1 AND call_index=$2`,
      [call.taskId, call.callIndex, JSON.stringify(reply), agent]);
    await runtime.db.query(`UPDATE lrn_ai_tasks SET available_at=CURRENT_TIMESTAMP WHERE id=$1 AND status='queued'`, [call.taskId]);
    await setJobStatus(dir, id, { status: "answered", answeredBy: agent });
    counts.imported += 1;
  }

  // 2. Answers the engine itself rejected (its parser or a handler error cleared the reply).
  for (const call of await loadCalls(runtime, "m.reply IS NULL AND m.agent IS NOT NULL AND m.error IS NOT NULL")) {
    const r = await reopen(runtime, dir, call, call.problems?.length ? call.problems : [call.error ?? "rejected by Ledgerly"]);
    if (r === "failed") counts.failed += 1; else counts.rejected += 1;
  }

  // 3. Finished steps: archive the job with its answer, refresh the pack (its lessons/ folder grows).
  const packs = new Map<string, string>();
  for (const call of await loadCalls(runtime, "(m.reply IS NOT NULL OR t.status IN ('succeeded','failed','cancelled'))")) {
    if (call.taskStatus === "queued" || call.taskStatus === "running") continue;
    const id = jobIdOf(call);
    const inbox = path.join(dir, "jobs", "inbox", id);
    if (call.taskStatus === "succeeded" && call.reply) {
      const done = path.join(dir, "jobs", "done", id);
      await rm(done, { recursive: true, force: true });
      await mkdir(done, { recursive: true });
      await cp(path.join(inbox, "job.json"), path.join(done, "job.json")).catch(() => undefined);
      await cp(path.join(dir, "jobs", "outbox", id), path.join(done, "answer"), { recursive: true }).catch(() => undefined);
      await rm(path.join(dir, "jobs", "outbox", id), { recursive: true, force: true });
      counts.done += 1;
    } else counts.cancelled += 1;
    await rm(inbox, { recursive: true, force: true });
    await rm(path.join(dir, "jobs", "claims", `${id}.json`), { force: true });
    if (call.taskStatus === "succeeded") await rm(path.join(dir, "jobs", "feedback", `${id}.md`), { force: true });
    after.push(() => runtime.db.query(`UPDATE lrn_manual_calls SET closed_at=CURRENT_TIMESTAMP WHERE task_id=$1 AND call_index=$2`, [call.taskId, call.callIndex]));
    if (call.job?.schemeId && !packs.has(call.job.schemeId)) {
      const scheme = await loadScheme(runtime, call.organizationId, call.job.schemeId).catch(() => null);
      if (scheme) {
        const w = await writePack(runtime, dir, scheme);
        packs.set(scheme.id, w.rel);
        if (w.changed) { counts.packs += 1; after.push(() => runtime.db.query(
          `INSERT INTO lrn_git_packs(scheme_id,organization_id,path,fingerprint) VALUES($1,$2,$3,$4)
           ON CONFLICT(scheme_id) DO UPDATE SET path=EXCLUDED.path,fingerprint=EXCLUDED.fingerprint,exported_at=CURRENT_TIMESTAMP`, [scheme.id, scheme.organizationId, w.rel, w.fingerprint])); }
      }
    }
  }

  // 4. New jobs, and reopened ones (a new attempt).
  for (const call of await loadCalls(runtime, "m.reply IS NULL AND (m.exported_attempt IS NULL OR m.exported_attempt < m.attempt)")) {
    if (call.taskStatus !== "queued") continue;
    await exportCall(runtime, dir, call, packs);
    after.push(() => runtime.db.query(`UPDATE lrn_manual_calls SET exported_attempt=$3,exported_at=CURRENT_TIMESTAMP WHERE task_id=$1 AND call_index=$2`,
      [call.taskId, call.callIndex, call.attempt]));
    counts.exported += 1;
  }

  const summary = Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ");
  await commitAndPush(dir, `ledgerly: ${summary || "sync"}`);
  // Only after the push: if it failed, the next run redoes this work from the database.
  for (const step of after) await step();
  return counts;
}

export async function syncGitDesk(runtime: Runtime) {
  if (!CONFIGURED) throw new Error("Neither LRN_GITDESK_SSH_KEY nor LRN_GITDESK_TOKEN is set, so the git desk cannot push to the resources bank.");
  const client = await runtime.db.connect();
  try {
    const locked = (await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK])).rows[0]?.ok;
    if (!locked) return { skipped: "another sync is running" };
    try {
      const result = await syncOnce(runtime);
      status.lastSyncAt = new Date().toISOString(); status.lastError = null; status.lastResult = result;
      return result;
    } catch (error) {
      status.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      status.lastSyncAt = new Date().toISOString();
      throw error;
    } finally {
      await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK]);
    }
  } finally {
    client.release();
  }
}

export async function gitDeskStatus(runtime: Runtime, organizationId: string) {
  const counts = await runtime.db.query<{ state: string; n: number }>(
    `SELECT CASE WHEN m.closed_at IS NOT NULL THEN 'closed' WHEN m.reply IS NOT NULL THEN 'answered'
                 WHEN m.exported_attempt IS NULL OR m.exported_attempt < m.attempt THEN 'to_publish'
                 WHEN m.attempt > 1 THEN 'reopened' ELSE 'open' END AS state, count(*)::int AS n
       FROM lrn_manual_calls m WHERE m.channel='git' AND m.organization_id=$1 AND (m.closed_at IS NULL OR m.closed_at > CURRENT_TIMESTAMP - INTERVAL '7 days')
      GROUP BY 1`, [organizationId]);
  const recent = await runtime.db.query(
    `SELECT m.task_id||'-'||m.call_index AS job,m.kind,m.attempt,m.agent,m.problems,m.created_at AS "createdAt",m.answered_at AS "answeredAt",m.closed_at AS "closedAt",t.status AS "taskStatus"
       FROM lrn_manual_calls m JOIN lrn_ai_tasks t ON t.id=m.task_id WHERE m.channel='git' AND m.organization_id=$1 ORDER BY m.created_at DESC LIMIT 30`, [organizationId]);
  return { ...status, repo: REPO.replace(/\.git$/, ""), counts: Object.fromEntries(counts.rows.map(r => [r.state, r.n])), recent: recent.rows };
}

export function startGitDesk(runtime: Runtime) {
  if (!CONFIGURED) { console.warn("[git-desk] no deploy key or token: git desk disabled"); return () => undefined; }
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const pending = await runtime.db.query(`SELECT 1 FROM lrn_manual_calls WHERE channel='git' AND closed_at IS NULL LIMIT 1`);
      if (pending.rowCount) await syncGitDesk(runtime);
    } catch (error) {
      console.error("[git-desk]", error instanceof Error ? error.message : error);
    } finally { busy = false; }
  };
  const timer = setInterval(() => { void tick(); }, INTERVAL_MS);
  void tick();
  return () => clearInterval(timer);
}

import { Fragment, useEffect, useState } from "react";
import { Bot, CheckCircle2, ExternalLink, FileCheck2, GitBranch, Hand, Inbox, Pause, Play, RefreshCw, RotateCcw, Send, ShieldCheck, Square, TerminalSquare, XCircle } from "lucide-react";
import { post, put } from "../../../../web/api";
import { Badge, Button, Card, Notice, Spinner } from "../../../../web/components/ui";
import { ago, duration, fmtDate, num, PageHead, Select, Stat, tone, useAction, useLoad, words, type Ctx, type R } from "./shared";

type Settings = { provider: "codex" | "claude-code" | "manual" | "git"; state: "running" | "paused" | "stopped"; dailyTaskLimit: number; maxPromptChars: number; imageGeneration: boolean; dailyImageLimit: number };
type Engine = { settings: Settings; queue: Array<{ kind: string; status: string; n: number }>; today: { steps: number; promptChars: number; durationMs: number } };
type Desk = { enabled: boolean; repo: string; lastSyncAt: string | null; lastError: string | null; lastResult: Record<string, number> | null; counts: Record<string, number>; recent: R[] };

const PROVIDERS: Array<{ key: Settings["provider"]; name: string; text: string; icon: typeof Bot }> = [
  { key: "git", name: "GitHub agents", text: "Each step becomes a job in the resources bank repo. Outside agents answer it, and Ledgerly checks every quote before accepting.", icon: GitBranch },
  { key: "codex", name: "Codex", text: "Ledgerly runs the step itself on the server's Codex provider and checks the reply against the same quality gates.", icon: TerminalSquare },
  { key: "claude-code", name: "Claude Code", text: "Ledgerly runs the step itself on the server's Claude Code provider.", icon: Bot },
  { key: "manual", name: "Manual", text: "Prompts are stored and wait for a reply pasted in by an operator. Useful for testing.", icon: Hand },
];
const KINDS = ["scheme.source", "scheme.outline", "lesson.write", "lesson.plan", "page.analyze", "student.summary", "figure.generate"];
const PIPE: Array<[string, string, string]> = [
  ["to_publish", "To publish", "Waiting for the next sync to push"],
  ["open", "Open", "In jobs/inbox for an agent"],
  ["reopened", "Reopened", "Rejected once, feedback written"],
  ["answered", "Answered", "Imported and being applied"],
  ["closed", "Closed (7 days)", "Archived in jobs/done"],
];

/** git@github.com:owner/repo(.git) or https://github.com/owner/repo → a browsable https link. */
const repoUrl = (repo: string) => repo.replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
const repoName = (repo: string) => repoUrl(repo).replace(/^https:\/\/github\.com\//, "");

function jobState(j: R) {
  if (j.closedAt) return j.taskStatus === "succeeded" ? "closed" : j.taskStatus;
  if (j.answeredAt) return "answered";
  return j.attempt > 1 ? "reopened" : "open";
}

export function AgentsView({ me }: Ctx) {
  const engine = useLoad<Engine | null>("/learn/engine", null, 15_000);
  const desk = useLoad<Desk | null>("/learn/engine/git-desk", null, 15_000);
  const act = useAction();
  const admin = me.can.admin;
  const s = engine.data?.settings;
  const [draft, setDraft] = useState<Settings | null>(null);
  useEffect(() => { if (s && !draft) setDraft(s); }, [s, draft]);

  const save = async (patch: Partial<Settings>, label: string) => {
    const ok = await act.run(label, async () => { const next = await put<Settings>("/learn/engine", patch); setDraft(next); }, "Engine settings saved.");
    if (ok) void engine.reload(true);
  };
  const setState = (state: Settings["state"]) => act.run(`state-${state}`, async () => {
    if (state === "running") await post("/learn/engine/start", {});
    else if (state === "stopped") await post("/learn/engine/stop", {});
    else await put("/learn/engine", { state });
    await engine.reload(true);
  }, state === "running" ? "Engine started." : state === "paused" ? "Engine paused: running steps finish, nothing new starts." : "Engine stopped: the running step was interrupted.");
  const sync = () => act.run("sync", async () => { const r = await post<R>("/learn/engine/git-desk/sync", {}); await desk.reload(true); await engine.reload(true); return r; }, "Synced with the resources bank.");

  const queued = engine.data?.queue.filter(q => q.status === "queued").reduce((n, q) => n + q.n, 0) ?? 0;
  const running = engine.data?.queue.filter(q => q.status === "running").reduce((n, q) => n + q.n, 0) ?? 0;
  const failed = engine.data?.queue.filter(q => q.status === "failed").reduce((n, q) => n + q.n, 0) ?? 0;
  const done = engine.data?.queue.filter(q => q.status === "succeeded").reduce((n, q) => n + q.n, 0) ?? 0;

  return <div className="le-page">
    <PageHead title="Agents & GitHub" lead="Choose who writes the schemes, notes and plans, see what is waiting on the resources bank, and manage the work queue."
      actions={<>
        {desk.data?.repo && <a className="button button--secondary" href={repoUrl(desk.data.repo)} target="_blank" rel="noreferrer"><GitBranch size={15} /> {repoName(desk.data.repo)} <ExternalLink size={13} /></a>}
        <Button variant="secondary" onClick={() => { void engine.reload(); void desk.reload(); }}><RefreshCw size={15} /> Refresh</Button>
      </>} />
    {(engine.error || desk.error) && <Notice tone="danger">{engine.error || desk.error}</Notice>}
    {act.error && <Notice tone="danger">{act.error}</Notice>}
    {act.done && <Notice tone="success">{act.done}</Notice>}
    {!admin && <Notice tone="info">You can watch the engine here. Changing it needs the <b>learning:admin</b> scope or the owner role.</Notice>}

    {engine.loading && !engine.data ? <Spinner label="Loading the engine" /> : s && draft && <>
      <div className="le-stats">
        <Stat label="Engine" value={<Badge tone={s.state === "running" ? "success" : s.state === "paused" ? "warning" : "danger"}>{words(s.state)}</Badge>} hint={`Provider: ${PROVIDERS.find(p => p.key === s.provider)?.name ?? s.provider}`} icon={<Bot size={18} />} tone="brand" />
        <Stat label="AI steps today" value={`${num(engine.data!.today?.steps)} / ${num(s.dailyTaskLimit)}`} hint={`${duration(engine.data!.today?.durationMs)} of model time`} icon={<TerminalSquare size={18} />} />
        <Stat label="Waiting & running" value={`${num(queued)} · ${num(running)}`} hint="queued · running now" icon={<Inbox size={18} />} tone={queued || running ? "warning" : "neutral"} />
        <Stat label="Last 24 hours" value={`${num(done)} done`} hint={failed ? `${failed} failed` : "no failures"} icon={failed ? <XCircle size={18} /> : <CheckCircle2 size={18} />} tone={failed ? "danger" : "success"} />
      </div>

      <div className="le-grid le-grid--2-1">
        <Card className="le-card">
          <div className="le-card-head"><div><h2>Who does the writing</h2><p>Every step (sources, outline, notes, plans, page scans, figures) goes through the provider chosen here.</p></div></div>
          <div className="le-providers" role="radiogroup" aria-label="Provider">
            {PROVIDERS.map(p => {
              const Icon = p.icon, on = draft.provider === p.key;
              return <button key={p.key} type="button" role="radio" aria-checked={on} disabled={!admin || Boolean(act.busy)} className={`le-provider${on ? " active" : ""}`}
                onClick={() => { if (!on) { setDraft({ ...draft, provider: p.key }); void save({ provider: p.key }, "provider"); } }}>
                <span className="le-provider__icon"><Icon size={18} /></span>
                <span><b>{p.name}{s.provider === p.key && <em>Active</em>}</b><small>{p.text}</small></span>
              </button>;
            })}
          </div>
        </Card>

        <Card className="le-card">
          <div className="le-card-head"><div><h2>Engine state</h2><p>Pause lets the current step finish. Stop interrupts it. Queued steps wait either way.</p></div></div>
          <div className="le-state-buttons">
            <Button variant={s.state === "running" ? "primary" : "secondary"} disabled={!admin || s.state === "running" || Boolean(act.busy)} onClick={() => void setState("running")}><Play size={15} /> Run</Button>
            <Button variant={s.state === "paused" ? "primary" : "secondary"} disabled={!admin || s.state === "paused" || Boolean(act.busy)} onClick={() => void setState("paused")}><Pause size={15} /> Pause</Button>
            <Button variant={s.state === "stopped" ? "danger" : "secondary"} disabled={!admin || s.state === "stopped" || Boolean(act.busy)} onClick={() => void setState("stopped")}><Square size={15} /> Stop</Button>
          </div>
          <form className="le-form le-form--tight" onSubmit={e => { e.preventDefault(); void save({ dailyTaskLimit: draft.dailyTaskLimit, maxPromptChars: draft.maxPromptChars, imageGeneration: draft.imageGeneration, dailyImageLimit: draft.dailyImageLimit }, "limits"); }}>
            <label className="field"><span>AI steps per day</span><input type="number" min={0} max={5000} value={draft.dailyTaskLimit} disabled={!admin} onChange={e => setDraft({ ...draft, dailyTaskLimit: Number(e.target.value) })} /></label>
            <label className="field"><span>Max prompt size (characters)</span><input type="number" min={8000} max={200000} step={1000} value={draft.maxPromptChars} disabled={!admin} onChange={e => setDraft({ ...draft, maxPromptChars: Number(e.target.value) })} /></label>
            <label className="le-check"><input type="checkbox" checked={draft.imageGeneration} disabled={!admin} onChange={e => setDraft({ ...draft, imageGeneration: e.target.checked })} /> Generate figures and images</label>
            <label className="field"><span>Images per day</span><input type="number" min={0} max={1000} value={draft.dailyImageLimit} disabled={!admin || !draft.imageGeneration} onChange={e => setDraft({ ...draft, dailyImageLimit: Number(e.target.value) })} /></label>
            {admin && <Button type="submit" variant="secondary" disabled={Boolean(act.busy)}>{act.busy === "limits" ? "Saving…" : "Save limits"}</Button>}
          </form>
        </Card>
      </div>
    </>}

    <GitDesk desk={desk.data} loading={desk.loading} admin={admin} syncing={act.busy === "sync"} onSync={() => void sync()} />
    <TaskQueue admin={admin} onChange={() => void engine.reload(true)} />
  </div>;
}

function GitDesk({ desk, loading, admin, syncing, onSync }: { desk: Desk | null; loading: boolean; admin: boolean; syncing: boolean; onSync: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (loading && !desk) return <Card className="le-card"><Spinner label="Loading the git desk" /></Card>;
  if (!desk) return null;
  const total = PIPE.reduce((n, [k]) => n + (desk.counts[k] ?? 0), 0);
  return <Card className="le-card le-desk">
    <div className="le-card-head">
      <div><h2><GitBranch size={18} /> Git desk · Ledgerly Resources Bank</h2>
        <p>{desk.enabled ? <>Syncs about every 2 minutes while jobs are open. Last sync {ago(desk.lastSyncAt)}{desk.lastResult && Object.values(desk.lastResult).some(Boolean) && <> · {Object.entries(desk.lastResult).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(", ")}</>}.</>
          : "Not configured: set LRN_GITDESK_SSH_KEY or LRN_GITDESK_TOKEN on the API so Ledgerly can push to the repo."}</p></div>
      <div className="le-head-actions">
        <Badge tone={desk.enabled ? (desk.lastError ? "danger" : "success") : "neutral"}>{desk.enabled ? desk.lastError ? "Sync error" : "Connected" : "Off"}</Badge>
        {admin && desk.enabled && <Button variant="secondary" disabled={syncing} onClick={onSync}><RefreshCw size={15} className={syncing ? "le-spin" : ""} /> {syncing ? "Syncing…" : "Sync now"}</Button>}
      </div>
    </div>
    {desk.lastError && <Notice tone="danger">{desk.lastError}</Notice>}

    <ol className="le-flow" aria-label="How a job travels">
      <li><Send size={16} /><b>Publish</b><small>Ledgerly writes the job, prompt and quoted passages to <code>jobs/inbox/&lt;job&gt;</code>, with a resource pack per scheme in <code>library/</code>.</small></li>
      <li><Bot size={16} /><b>Agent answers</b><small>An agent claims the job, writes notes, plans and activities to <code>jobs/outbox/&lt;job&gt;</code> and runs <code>tools/check.py</code>.</small></li>
      <li><ShieldCheck size={16} /><b>Ledgerly verifies</b><small>Every note section, activity and figure must quote a source passage exactly. Nothing invented is accepted.</small></li>
      <li><FileCheck2 size={16} /><b>Accept or reopen</b><small>Accepted answers move to <code>jobs/done</code>. Rejected ones get <code>jobs/feedback</code> and a new attempt (3 at most).</small></li>
    </ol>

    <div className="le-pipe">
      {PIPE.map(([k, label, hint]) => <div key={k} className={`le-pipe__step le-pipe__step--${tone(k === "closed" ? "closed" : k)}`}>
        <b>{num(desk.counts[k] ?? 0)}</b><span>{label}</span><small>{hint}</small>
        <i style={{ width: `${total ? Math.max(4, Math.round((desk.counts[k] ?? 0) / total * 100)) : 0}%` }} />
      </div>)}
    </div>

    <div className="le-table-wrap">
      <table className="le-table">
        <thead><tr><th>Job</th><th>Step</th><th>State</th><th>Attempt</th><th>Agent</th><th>Created</th><th>Answered</th><th /></tr></thead>
        <tbody>
          {desk.recent.map(j => {
            const st = jobState(j), problems: string[] = Array.isArray(j.problems) ? j.problems : [];
            return <Fragment key={j.job}>
              <tr>
                <td><code className="le-mono">{j.job}</code></td>
                <td>{words(j.kind)}</td>
                <td><Badge tone={tone(st)}>{words(st)}</Badge></td>
                <td>{j.attempt} / 3</td>
                <td>{j.agent || <span className="le-muted">—</span>}</td>
                <td title={fmtDate(j.createdAt)}>{ago(j.createdAt)}</td>
                <td title={fmtDate(j.answeredAt)}>{j.answeredAt ? ago(j.answeredAt) : "—"}</td>
                <td>{problems.length > 0 && <button className="le-link" onClick={() => setOpen(open === j.job ? null : j.job)}>{open === j.job ? "Hide" : `${problems.length} problem${problems.length > 1 ? "s" : ""}`}</button>}</td>
              </tr>
              {open === j.job && <tr className="le-subrow"><td colSpan={8}><ul className="le-problems">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></td></tr>}
            </Fragment>;
          })}
          {!desk.recent.length && <tr><td colSpan={8} className="le-empty-cell">No jobs yet. Switch the provider to <b>GitHub agents</b> and request notes or plans for a week.</td></tr>}
        </tbody>
      </table>
    </div>
  </Card>;
}

function TaskQueue({ admin, onChange }: { admin: boolean; onChange: () => void }) {
  const [status, setStatus] = useState(""), [kind, setKind] = useState(""), [page, setPage] = useState(1), [open, setOpen] = useState<string | null>(null);
  const pageSize = 25;
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(status ? { status } : {}), ...(kind ? { kind } : {}) });
  const tasks = useLoad<R[]>(`/learn/engine/tasks?${qs}`, [], 15_000);
  const act = useAction();
  const run = (id: string, what: "cancel" | "retry") => act.run(`${what}-${id}`, async () => { await post(`/learn/engine/tasks/${id}/${what}`, {}); await tasks.reload(true); onChange(); });
  return <Card className="le-card">
    <div className="le-card-head">
      <div><h2>Work queue</h2><p>Every step the engine runs, newest first. Steps for the git provider stay queued until an agent answers.</p></div>
      <div className="le-filters">
        <Select label="Status" value={status} onChange={v => { setStatus(v); setPage(1); }} options={[["", "All statuses"], ["queued", "Queued"], ["running", "Running"], ["succeeded", "Succeeded"], ["failed", "Failed"], ["cancelled", "Cancelled"]]} />
        <Select label="Step" value={kind} onChange={v => { setKind(v); setPage(1); }} options={[["", "All steps"], ...KINDS.map(k => [k, words(k)] as [string, string])]} />
      </div>
    </div>
    {(tasks.error || act.error) && <Notice tone="danger">{tasks.error || act.error}</Notice>}
    <div className="le-table-wrap">
      <table className="le-table">
        <thead><tr><th>Step</th><th>Status</th><th>Tries</th><th>Provider</th><th>Prompt</th><th>Time</th><th>When</th><th /></tr></thead>
        <tbody>
          {tasks.loading && !tasks.data.length ? <tr><td colSpan={8}><Spinner /></td></tr> : tasks.data.map(t => <Fragment key={t.id}>
            <tr>
              <td><b>{words(t.kind)}</b><small className="le-mono le-muted">{t.subjectRef}</small></td>
              <td><Badge tone={tone(t.status)}>{words(t.status)}</Badge></td>
              <td>{t.attempts}</td>
              <td>{t.provider ? words(t.provider) : <span className="le-muted">—</span>}</td>
              <td>{t.promptChars ? `${num(t.promptChars)} ch` : "—"}</td>
              <td>{duration(t.durationMs)}</td>
              <td title={fmtDate(t.finishedAt || t.startedAt || t.createdAt)}>{ago(t.finishedAt || t.startedAt || t.createdAt)}</td>
              <td className="le-row-actions">
                {t.error && <button className="le-link" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? "Hide" : "Why"}</button>}
                {admin && ["queued", "running"].includes(t.status) && <Button variant="ghost" disabled={Boolean(act.busy)} onClick={() => void run(t.id, "cancel")}><XCircle size={14} /> Cancel</Button>}
                {admin && ["failed", "cancelled"].includes(t.status) && <Button variant="ghost" disabled={Boolean(act.busy)} onClick={() => void run(t.id, "retry")}><RotateCcw size={14} /> Retry</Button>}
              </td>
            </tr>
            {open === t.id && <tr className="le-subrow"><td colSpan={8}><pre className="le-pre">{t.error}</pre></td></tr>}
          </Fragment>)}
          {!tasks.loading && !tasks.data.length && <tr><td colSpan={8} className="le-empty-cell">Nothing matches these filters.</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="le-pager">
      <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
      <span>Page {page}</span>
      <Button variant="secondary" disabled={tasks.data.length < pageSize} onClick={() => setPage(p => p + 1)}>Next</Button>
    </div>
  </Card>;
}

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookMarked, CheckCircle2, Download, ExternalLink, FileText, Library, ListChecks, MoreHorizontal, NotebookPen, Plus, RefreshCw, Search, Send, Trash2, Undo2 } from "lucide-react";
import { del, downloadFile, post } from "../../../../web/api";
import { Badge, Button, Card, EmptyState, Modal, Notice, Spinner } from "../../../../web/components/ui";
import { ago, Markdown, optionsOf, PageHead, Progress, Segmented, Select, Stat, tone, useAction, useLoad, words, type Ctx, type R } from "./shared";

const ACTIVE = new Set(["sourcing", "outlining", "writing"]);
const STATUSES: Array<[string, string]> = [["", "All statuses"], ["sourcing", "Sourcing"], ["outlining", "Outlining"], ["writing", "Writing"], ["review", "In review"], ["published", "Published"], ["failed", "Failed"]];

export function SchemesView(ctx: Ctx) {
  const { me, setup, go } = ctx;
  const [termId, setTermId] = useState(me.term?.id ?? ""), [classId, setClassId] = useState(""), [subjectId, setSubjectId] = useState(""), [status, setStatus] = useState(""), [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const qs = new URLSearchParams({ ...(termId ? { termId } : {}), ...(classId ? { classId } : {}), ...(subjectId ? { subjectId } : {}), ...(status ? { status } : {}) });
  const schemes = useLoad<R[]>(`/learn/schemes?${qs}`, [], 20_000);
  const rows = schemes.data.filter(s => !q || `${s.title} ${s.className} ${s.subjectName}`.toLowerCase().includes(q.toLowerCase()));
  const classes = me.allClasses ? setup.classes : me.classes, subjects = me.allClasses ? setup.subjects : me.subjects;
  return <div className="le-page">
    <PageHead title="Schemes & lessons" lead="One scheme per class, subject and term. The engine sources material from the e-library, outlines the term, then writes notes and plans week by week."
      actions={me.can.manage && <Button onClick={() => setCreating(true)}><Plus size={15} /> New scheme</Button>} />
    <Card className="le-card">
      <div className="le-toolbar">
        <label className="le-search"><Search size={15} /><input placeholder="Search schemes" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Select label="Term" value={termId} onChange={setTermId} options={optionsOf(setup.terms, "All terms")} />
        <Select label="Class" value={classId} onChange={setClassId} options={optionsOf(classes, "All classes")} />
        <Select label="Subject" value={subjectId} onChange={setSubjectId} options={optionsOf(subjects, "All subjects")} />
        <Select label="Status" value={status} onChange={setStatus} options={STATUSES} />
      </div>
      {schemes.error && <Notice tone="danger">{schemes.error}</Notice>}
      {schemes.loading && !schemes.data.length ? <Spinner label="Loading schemes" /> : !rows.length
        ? <EmptyState title="No schemes here yet" description={me.can.manage ? "Start a scheme for a class and subject. The engine checks the e-library first and shows how far the material reaches." : "Schemes appear here once the Director of Studies starts them."}
            action={me.can.manage ? <Button onClick={() => setCreating(true)}><Plus size={15} /> New scheme</Button> : undefined} />
        : <div className="le-scheme-grid">
          {rows.map(s => <button key={s.id} className="le-scheme" aria-label={`${s.title}, ${words(s.status)}`} onClick={() => go("schemes", s.id)}>
            <span className="le-scheme__top"><Badge tone={tone(s.status)}>{words(s.status)}</Badge>{ACTIVE.has(s.status) && <RefreshCw size={13} className="le-spin le-muted" aria-label="Working" />}</span>
            <b>{s.title}</b>
            <small>{s.className} · {s.subjectName} · {s.termName}</small>
            <span className="le-scheme__progress"><Progress value={s.written} total={s.lessons} tone={s.failed ? "danger" : "brand"} /><em>{s.written}/{s.lessons} lessons written{s.failed ? ` · ${s.failed} failed` : ""}</em></span>
            {s.error && <small className="le-error-line">{s.error}</small>}
            <small className="le-muted">Updated {ago(s.updatedAt)}</small>
          </button>)}
        </div>}
    </Card>
    {creating && <NewScheme ctx={ctx} close={() => setCreating(false)} created={id => { setCreating(false); go("schemes", id); }} />}
  </div>;
}

/* ---------- create: pick → material check → confirm ---------- */

function NewScheme({ ctx, close, created }: { ctx: Ctx; close: () => void; created: (id: string) => void }) {
  const { me, setup } = ctx;
  const classes = me.allClasses ? setup.classes : me.classes, subjects = me.allClasses ? setup.subjects : me.subjects;
  const [termId, setTermId] = useState(me.term?.id ?? setup.terms[0]?.id ?? ""), [classId, setClassId] = useState(""), [subjectId, setSubjectId] = useState("");
  const [preview, setPreview] = useState<R | null>(null), [extras, setExtras] = useState<string[]>([]);
  const [title, setTitle] = useState(""), [weeks, setWeeks] = useState(10), [periods, setPeriods] = useState(""), [until, setUntil] = useState("");
  const act = useAction();
  const check = () => act.run("check", async () => { setPreview(await post<R>("/learn/schemes/preview", { termId, classId, subjectId })); setExtras([]); });
  const create = () => act.run("create", async () => {
    const r = await post<R>("/learn/schemes", {
      termId, classId, subjectId, ...(title.trim() ? { title: title.trim() } : {}), weeks, ...(periods ? { periodsPerWeek: Number(periods) } : {}),
      ...(until ? { writeUntilWeek: Number(until) } : {}), library: extras.length ? { extraSlugs: extras } : {},
    });
    created(r.id);
  });
  const existingId = preview?.existingSchemeId as string | null | undefined;
  return <Modal title="New scheme of work" onClose={close} locked={Boolean(act.busy)}>
    <div className="le-modal-body">
      <div className="le-form le-form--3">
        <label className="field"><span>Term</span><Select label="Term" value={termId} onChange={v => { setTermId(v); setPreview(null); }} options={optionsOf(setup.terms, "Choose a term")} /></label>
        <label className="field"><span>Class</span><Select label="Class" value={classId} onChange={v => { setClassId(v); setPreview(null); }} options={optionsOf(classes, "Choose a class")} /></label>
        <label className="field"><span>Subject</span><Select label="Subject" value={subjectId} onChange={v => { setSubjectId(v); setPreview(null); }} options={optionsOf(subjects, "Choose a subject")} /></label>
      </div>
      {!preview && <Button disabled={!termId || !classId || !subjectId || Boolean(act.busy)} onClick={() => void check()}><Library size={15} /> {act.busy === "check" ? "Checking the e-library…" : "Check material"}</Button>}
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      {preview && <>
        {existingId ? <Notice tone="warning">{preview.subjectName} for {preview.className}, {preview.termName} already has a scheme. <button className="le-link" onClick={() => { close(); ctx.go("schemes", existingId); }}>Open it</button></Notice>
          : <Notice tone={preview.teachingLessons >= 40 ? "success" : preview.teachingLessons >= 20 ? "info" : "warning"}>{preview.advice}</Notice>}
        <div className="le-stats le-stats--compact">
          <Stat label="Resources picked" value={preview.picked?.length ?? 0} />
          <Stat label="Teaching lessons" value={preview.teachingLessons ?? 0} hint="from notes, plans and schemes" />
          <Stat label="Weeks covered" value={`${preview.weeksCovered ?? 0} / 10`} />
        </div>
        {preview.picked?.length > 0 && <div className="le-list-box"><h3>Ledgerly will use</h3>
          <ul>{preview.picked.map((p: R) => <li key={p.slug}><FileText size={14} /><span>{p.title}</span><Badge>{words(p.role)}</Badge><small>{p.pages} lesson{p.pages === 1 ? "" : "s"} of text</small></li>)}</ul></div>}
        {preview.others?.length > 0 && <div className="le-list-box"><h3>Add more resources <small>({extras.length}/12 chosen)</small></h3>
          <ul>{preview.others.map((p: R) => <li key={p.slug}><label className="le-check"><input type="checkbox" checked={extras.includes(p.slug)} disabled={!extras.includes(p.slug) && extras.length >= 12}
            onChange={e => setExtras(x => e.target.checked ? [...x, p.slug] : x.filter(s => s !== p.slug))} /><span>{p.title}</span></label>{p.type && <Badge>{words(p.type)}</Badge>}<small>{p.pages} lesson{p.pages === 1 ? "" : "s"}</small></li>)}</ul></div>}
        {!existingId && <div className="le-form le-form--4">
          <label className="field le-span-4"><span>Title (optional)</span><input value={title} placeholder={`${preview.subjectName} · ${preview.className} · ${preview.termName}`} onChange={e => setTitle(e.target.value)} /></label>
          <label className="field"><span>Weeks</span><input type="number" min={1} max={20} value={weeks} onChange={e => setWeeks(Number(e.target.value))} /></label>
          <label className="field"><span>Periods per week</span><input type="number" min={1} max={20} value={periods} placeholder="School setting" onChange={e => setPeriods(e.target.value)} /></label>
          <label className="field le-span-2"><span>Write notes now up to week</span><input type="number" min={1} max={20} value={until} placeholder="Outline only, write later" onChange={e => setUntil(e.target.value)} /></label>
        </div>}
      </>}
    </div>
    <div className="modal-actions">
      <Button variant="secondary" onClick={close} disabled={Boolean(act.busy)}>Cancel</Button>
      {preview && !existingId && <Button disabled={Boolean(act.busy)} onClick={() => void create()}><Send size={15} /> {act.busy === "create" ? "Starting…" : "Start scheme"}</Button>}
    </div>
  </Modal>;
}

/* ---------- one scheme ---------- */

export function SchemeDetail({ ctx, id }: { ctx: Ctx; id: string }) {
  const { me, go } = ctx;
  const [tab, setTab] = useState<"weeks" | "units" | "sources" | "activity">("weeks");
  const [poll, setPoll] = useState<number | undefined>();
  const scheme = useLoad<R | null>(`/learn/schemes/${id}`, null, poll);
  const data = scheme.data;
  const busy = Boolean(data && (ACTIVE.has(data.status) || data.tasks?.some((t: R) => ["queued", "running"].includes(t.status))));
  useEffect(() => setPoll(busy ? 12_000 : undefined), [busy]);
  const act = useAction();
  const [exporting, setExporting] = useState(false), [more, setMore] = useState(false);
  const manage = me.can.manage;
  const refresh = () => scheme.reload(true);
  const doit = (key: string, fn: () => Promise<unknown>, msg: string) => act.run(key, async () => { await fn(); await refresh(); }, msg);

  const weeks = useMemo(() => {
    if (!data) return [];
    const by = new Map<number, R[]>();
    for (const l of data.lessons as R[]) { const w = l.week ?? 0; by.set(w, [...(by.get(w) ?? []), l]); }
    return [...by.entries()].sort((a, b) => a[0] - b[0]);
  }, [data]);

  if (scheme.loading && !data) return <div className="le-page"><Spinner label="Loading the scheme" /></div>;
  if (scheme.error || !data) return <div className="le-page"><Button variant="ghost" onClick={() => go("schemes")}><ArrowLeft size={15} /> All schemes</Button><Notice tone="danger">{scheme.error || "Scheme not found."}</Notice></div>;
  const p = data.progress ?? {};
  const written = (p.written ?? 0) + (p.reviewed ?? 0);
  const planned = (data.lessons as R[]).filter(l => l.planStatus === "written").length;
  return <div className="le-page">
    <PageHead eyebrow={`${data.className} · ${data.subjectName} · ${data.termName}`} title={data.title}
      back={<button className="le-back" onClick={() => go("schemes")}><ArrowLeft size={14} /> All schemes</button>}
      lead={<><Badge tone={tone(data.status)}>{words(data.status)}</Badge> {data.weeks} weeks · {data.periodsPerWeek} periods a week{data.publishedAt && <> · published {ago(data.publishedAt)}</>}{busy && <> · <RefreshCw size={12} className="le-spin" /> the engine is working on this scheme</>}</>}
      actions={<>
        <Button variant="secondary" onClick={() => setExporting(true)}><Download size={15} /> Download</Button>
        {manage && data.status === "review" && <Button disabled={Boolean(act.busy)} onClick={() => void doit("publish", () => post(`/learn/schemes/${id}/publish`, {}), "Scheme published: teachers can now use it.")}><CheckCircle2 size={15} /> Publish</Button>}
        {manage && data.status === "published" && <Button variant="secondary" disabled={Boolean(act.busy)} onClick={() => void doit("unpublish", () => post(`/learn/schemes/${id}/unpublish`, {}), "Scheme moved back to review.")}><Undo2 size={15} /> Unpublish</Button>}
        {manage && <Button variant="secondary" aria-label="More actions" onClick={() => setMore(true)}><MoreHorizontal size={15} /></Button>}
      </>} />
    {act.error && <Notice tone="danger">{act.error}</Notice>}
    {act.done && <Notice tone="success">{act.done}</Notice>}
    {data.error && <Notice tone="danger">{data.error}</Notice>}

    <div className="le-stats">
      <Stat label="Lessons outlined" value={p.lessons ?? 0} icon={<ListChecks size={18} />} />
      <Stat label="Notes written" value={`${written} / ${p.lessons ?? 0}`} hint={<Progress value={written} total={p.lessons ?? 0} />} icon={<NotebookPen size={18} />} tone="brand" />
      <Stat label="Lesson plans" value={`${planned} / ${p.lessons ?? 0}`} hint={<Progress value={planned} total={p.lessons ?? 0} />} icon={<FileText size={18} />} />
      <Stat label="Need attention" value={p.failed ?? 0} hint={p.failed ? "failed the quality gate" : "nothing failed"} tone={p.failed ? "danger" : "success"} icon={<BookMarked size={18} />} />
    </div>
    {(data.summary || data.coverageNote) && <Card className="le-card le-summary">{data.summary && <Markdown text={data.summary} />}{data.coverageNote && <Notice tone="info">{data.coverageNote}</Notice>}</Card>}

    <Segmented label="Scheme sections" value={tab} onChange={setTab} options={[["weeks", "Weeks & lessons"], ["units", `Units (${data.units.length})`], ["sources", `Sources (${data.sources.length})`], ["activity", "Engine activity"]]} />

    {tab === "weeks" && (weeks.length ? <div className="le-weeks">
      {weeks.map(([w, lessons]) => {
        const toWrite = lessons.filter(l => ["pending", "failed"].includes(l.status)).length;
        const allWritten = lessons.every(l => ["written", "reviewed"].includes(l.status));
        const toPlan = lessons.filter(l => ["none", "failed"].includes(l.planStatus)).length;
        const doneN = lessons.filter(l => ["written", "reviewed"].includes(l.status)).length;
        const plannedN = lessons.filter(l => l.planStatus === "written").length;
        return <Card key={w} className="le-week">
          <div className="le-week__head">
            <div><h3>{w ? `Week ${w}` : "Unscheduled"}</h3><small>{doneN}/{lessons.length} written · {plannedN}/{lessons.length} planned</small></div>
            {manage && w > 0 && <div className="le-head-actions">
              {toWrite > 0 && <Button variant="secondary" disabled={Boolean(act.busy)} onClick={() => void doit(`notes-${w}`, () => post(`/learn/schemes/${id}/weeks/${w}/notes`, {}), `Week ${w} notes requested.`)}><NotebookPen size={14} /> {act.busy === `notes-${w}` ? "Requesting…" : `Write notes (${toWrite})`}</Button>}
              {allWritten && toPlan > 0 && <Button variant="secondary" disabled={Boolean(act.busy)} onClick={() => void doit(`plans-${w}`, () => post(`/learn/schemes/${id}/weeks/${w}/plans`, {}), `Week ${w} plans requested.`)}><FileText size={14} /> {act.busy === `plans-${w}` ? "Requesting…" : `Make plans (${toPlan})`}</Button>}
            </div>}
          </div>
          <ul className="le-lessons">
            {lessons.map(l => <li key={l.id}><button onClick={() => go("lessons", l.id)}>
              <span className="le-lesson__seq">{l.seq}</span>
              <span className="le-lesson__main"><b>{l.title}</b>{l.subtopic && <small>{l.subtopic}</small>}{l.error && <small className="le-error-line">{l.error}</small>}</span>
              <span className="le-lesson__tags">
                {l.kind === "practice" && <Badge>Part B</Badge>}{l.kind && !["teach", "practice"].includes(l.kind) && <Badge>{words(l.kind)}</Badge>}
                <Badge tone={tone(l.status)}>{words(l.status)}</Badge>
                {l.planStatus && l.planStatus !== "none" && <Badge tone={l.planStatus === "written" ? "success" : tone(l.planStatus)}>Plan: {words(l.planStatus)}</Badge>}
                {l.questions > 0 && <small className="le-muted">{l.questions} activities</small>}
              </span>
            </button></li>)}
          </ul>
        </Card>;
      })}
    </div> : <Card className="le-card"><EmptyState title={ACTIVE.has(data.status) ? "The outline is being written" : "No lessons yet"} description={ACTIVE.has(data.status) ? "The engine is sourcing material and outlining the term. Lessons show up here as soon as the outline passes the checks." : "Regenerate the outline from the ⋯ menu."} /></Card>)}

    {tab === "units" && <Card className="le-card"><div className="le-table-wrap"><table className="le-table">
      <thead><tr><th>#</th><th>Unit</th><th>Theme</th><th>Weeks</th><th>Competences</th></tr></thead>
      <tbody>{(data.units as R[]).map(u => <tr key={u.id}><td>{u.seq}</td><td><b>{u.title}</b></td><td>{u.theme || "—"}</td><td>{u.weekFrom ? `${u.weekFrom}–${u.weekTo ?? u.weekFrom}` : "—"}</td>
        <td className="le-wrap">{Array.isArray(u.competences) ? u.competences.join("; ") : typeof u.competences === "string" ? u.competences : "—"}</td></tr>)}
        {!data.units.length && <tr><td colSpan={5} className="le-empty-cell">No units yet.</td></tr>}</tbody></table></div></Card>}

    {tab === "sources" && <Card className="le-card">
      <div className="le-card-head"><div><h2>Resource report</h2><p>{data.resourceReport.used} used · {data.resourceReport.skipped} skipped · {data.resourceReport.failed} failed. Every note and activity quotes these passages.</p></div></div>
      <div className="le-table-wrap"><table className="le-table">
        <thead><tr><th>Resource</th><th>Role</th><th>Decision</th><th>Passages used</th><th>Quality</th><th>Why</th></tr></thead>
        <tbody>{(data.resourceReport.resources as R[]).map((r, i) => {
          const src = (data.sources as R[]).find(s => s.title === r.title);
          return <tr key={`${r.slug}-${i}`}><td><b>{r.title}</b>{src?.pageUrl && <a className="le-link" href={src.pageUrl} target="_blank" rel="noreferrer"> <ExternalLink size={12} /></a>}<small className="le-muted">{words(r.provider)}</small></td>
            <td>{words(r.role)}</td><td><Badge tone={tone(r.decision)}>{words(r.decision)}</Badge></td><td>{r.passagesUsed ?? 0} / {r.passages ?? 0}</td>
            <td>{r.qualityStatus ? <Badge tone={tone(r.qualityStatus)}>{words(r.qualityStatus)}</Badge> : "—"}</td><td className="le-wrap le-muted">{r.reason || (Array.isArray(r.qualityIssues) ? r.qualityIssues.join("; ") : "")}</td></tr>;
        })}
        {!data.resourceReport.resources.length && <tr><td colSpan={6} className="le-empty-cell">No resources recorded yet.</td></tr>}</tbody></table></div>
    </Card>}

    {tab === "activity" && <Card className="le-card">
      <div className="le-card-head"><div><h2>Engine steps for this scheme</h2><p>Sourcing, outline, notes and plans. Open <button className="le-link" onClick={() => go("agents")}>Agents & GitHub</button> for the full queue and the git desk.</p></div></div>
      <div className="le-table-wrap"><table className="le-table"><thead><tr><th>Step</th><th>Status</th><th>Count</th></tr></thead>
        <tbody>{(data.tasks as R[]).map((t, i) => <tr key={i}><td>{words(t.kind)}</td><td><Badge tone={tone(t.status)}>{words(t.status)}</Badge></td><td>{t.n}</td></tr>)}
          {!data.tasks.length && <tr><td colSpan={3} className="le-empty-cell">No engine steps recorded.</td></tr>}</tbody></table></div>
    </Card>}

    {exporting && <ExportModal scheme={data} close={() => setExporting(false)} />}
    {more && <MoreModal scheme={data} close={() => setMore(false)} after={async (msg) => { setMore(false); if (msg === "deleted") go("schemes"); else { act.clear(); await refresh(); } }} />}
  </div>;
}

function ExportModal({ scheme, close }: { scheme: R; close: () => void }) {
  const [format, setFormat] = useState<"pdf" | "docx">("pdf"), [parts, setParts] = useState<string[]>(["scheme", "plans", "notes"]);
  const [scope, setScope] = useState<"all" | "week" | "until">("all"), [week, setWeek] = useState(1);
  const act = useAction();
  const download = () => act.run("dl", async () => {
    const qs = new URLSearchParams({ format, parts: parts.join(","), ...(scope === "week" ? { week: String(week) } : scope === "until" ? { untilWeek: String(week) } : {}) });
    const name = `${scheme.title}`.replace(/[^\w.-]+/g, "_").slice(0, 80);
    await downloadFile(`/learn/schemes/${scheme.id}/export?${qs}`, `${name}.${format}`);
  });
  const toggle = (k: string) => setParts(x => x.includes(k) ? x.filter(y => y !== k) : [...x, k]);
  return <Modal title="Download scheme" onClose={close} locked={Boolean(act.busy)}>
    <div className="le-modal-body">
      <label className="field"><span>Format</span><Segmented label="Format" value={format} onChange={setFormat} options={[["pdf", "PDF"], ["docx", "Word (.docx)"]]} /></label>
      <fieldset className="le-fieldset"><legend>Include</legend>
        {[["scheme", "Scheme of work"], ["plans", "Lesson plans"], ["notes", "Lesson notes"]].map(([k, t]) => <label key={k} className="le-check"><input type="checkbox" checked={parts.includes(k!)} onChange={() => toggle(k!)} /> {t}</label>)}
      </fieldset>
      <label className="field"><span>Weeks</span><Segmented label="Weeks" value={scope} onChange={setScope} options={[["all", "Whole term"], ["week", "One week"], ["until", "Up to a week"]]} /></label>
      {scope !== "all" && <label className="field"><span>Week</span><input type="number" min={1} max={scheme.weeks ?? 20} value={week} onChange={e => setWeek(Number(e.target.value))} /></label>}
      {act.error && <Notice tone="danger">{act.error}</Notice>}
    </div>
    <div className="modal-actions"><Button variant="secondary" onClick={close}>Close</Button><Button disabled={!parts.length || Boolean(act.busy)} onClick={() => void download()}><Download size={15} /> {act.busy ? "Preparing…" : "Download"}</Button></div>
  </Modal>;
}

function MoreModal({ scheme, close, after }: { scheme: R; close: () => void; after: (msg: string) => Promise<void> }) {
  const act = useAction();
  const [until, setUntil] = useState(""), [confirm, setConfirm] = useState("");
  const library = useLoad<R[]>(`/learn/schemes/${scheme.id}/library`, []);
  const published = scheme.status === "published";
  const run = (key: string, fn: () => Promise<unknown>, msg = "ok") => act.run(key, async () => { await fn(); await after(msg); });
  return <Modal title="Scheme actions" onClose={close} locked={Boolean(act.busy)}>
    <div className="le-modal-body le-actions-list">
      {act.error && <Notice tone="danger">{act.error}</Notice>}
      <section><h3>Write more of the term</h3><p>Notes are written week by week. Ask for every week up to a point, or the whole term.</p>
        <div className="le-inline"><input type="number" min={1} max={scheme.weeks ?? 20} placeholder="Week" value={until} onChange={e => setUntil(e.target.value)} />
          <Button variant="secondary" disabled={Boolean(act.busy)} onClick={() => void run("until", () => post(`/learn/schemes/${scheme.id}/write`, { untilWeek: until ? Number(until) : null }))}>{until ? `Write up to week ${until}` : "Write the whole term"}</Button></div></section>
      <section><h3>Regenerate</h3><p>{published ? "Unpublish the scheme first to regenerate it." : "Re-run one stage. The outline wipes lessons that are not published."}</p>
        <div className="le-inline">
          <Button variant="secondary" disabled={published || Boolean(act.busy)} onClick={() => void run("sources", () => post(`/learn/schemes/${scheme.id}/regenerate`, { what: "sources" }))}><RefreshCw size={14} /> Sources</Button>
          <Button variant="secondary" disabled={published || Boolean(act.busy)} onClick={() => void run("outline", () => post(`/learn/schemes/${scheme.id}/regenerate`, { what: "outline" }))}><RefreshCw size={14} /> Outline</Button>
          <Button variant="secondary" disabled={published || !scheme.progress?.failed || Boolean(act.busy)} onClick={() => void run("failed", () => post(`/learn/schemes/${scheme.id}/regenerate`, { what: "failed_lessons" }))}><RefreshCw size={14} /> Failed lessons</Button>
        </div></section>
      <section><h3>Post to the e-library</h3><p>Shares the written weeks as a resource on the Notesug e-library.</p>
        {library.data.length > 0 && <ul className="le-mini-list">{library.data.map((x, i) => <li key={i}><a className="le-link" href={x.url} target="_blank" rel="noreferrer">{x.slug}</a> <Badge tone={tone(x.status)}>{words(x.status)}</Badge> <small className="le-muted">{ago(x.createdAt)}</small></li>)}</ul>}
        <Button variant="secondary" disabled={Boolean(act.busy)} onClick={() => void run("library", () => post(`/learn/schemes/${scheme.id}/library`, {}))}><Library size={14} /> Post written weeks</Button></section>
      <section className="le-danger-zone"><h3>Delete scheme</h3><p>Removes the scheme, its lessons and its queued steps. This cannot be undone. Type <b>delete</b> to confirm.</p>
        <div className="le-inline"><input value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="delete" />
          <Button variant="danger" disabled={confirm !== "delete" || Boolean(act.busy)} onClick={() => void run("delete", () => del(`/learn/schemes/${scheme.id}`), "deleted")}><Trash2 size={14} /> Delete</Button></div></section>
    </div>
    <div className="modal-actions"><Button variant="secondary" onClick={close}>Close</Button></div>
  </Modal>;
}


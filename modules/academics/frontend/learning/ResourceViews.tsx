import { useState } from "react";
import { ArrowLeft, Ban, CalendarCheck, CalendarX, ChevronLeft, ChevronRight, Copy, ImageIcon, RotateCcw, ScanLine, Search, Shapes, Shuffle, Tags, XCircle } from "lucide-react";
import { post } from "../../../../web/api";
import { Badge, Button, Card, EmptyState, Modal, Notice, Pagination, Spinner } from "../../../../web/components/ui";
import { ago, AuthImage, num, optionsOf, PageHead, Select, Segmented, Stat, tone, useAction, useLoad, words, type Ctx, type R } from "./shared";

/* ---------------- Question bank ---------------- */

export function QuestionsView({ me, setup }: Ctx) {
  const classes = me.allClasses ? setup.classes : me.classes, subjects = me.allClasses ? setup.subjects : me.subjects;
  const [classId, setClassId] = useState(""), [subjectId, setSubjectId] = useState(""), [origin, setOrigin] = useState(""), [q, setQ] = useState(""), [search, setSearch] = useState("");
  const [groupId, setGroupId] = useState(""), [page, setPage] = useState(1), [reveal, setReveal] = useState(false), [similar, setSimilar] = useState<R | null>(null);
  const pageSize = 30;
  const base = { ...(classId ? { classId } : {}), ...(subjectId ? { subjectId } : {}), ...(me.term?.id ? { termId: me.term.id } : {}) };
  const groups = useLoad<R[]>(`/learn/questions/groups?${new URLSearchParams(base)}`, []);
  const list = useLoad<{ items: R[]; total: number }>(`/learn/questions?${new URLSearchParams({ ...base, ...(groupId ? { groupId } : {}), ...(origin ? { origin } : {}), ...(search ? { q: search } : {}), page: String(page), pageSize: String(pageSize) })}`, { items: [], total: 0 });
  const act = useAction();
  const retire = (id: string) => act.run(`retire-${id}`, async () => { await post(`/learn/questions/${id}/retire`, {}); await list.reload(true); }, "Question retired: it will not be given again.");
  const reset = (fn: () => void) => { fn(); setPage(1); setGroupId(""); };
  return <div className="le-page">
    <PageHead title="Question bank" lead="Every activity the engine has taken from the sources, plus questions read from scanned exercise books, grouped by concept and skill."
      actions={<Button variant="secondary" onClick={() => setReveal(r => !r)}>{reveal ? "Hide answers" : "Show answers"}</Button>} />
    <Card className="le-card">
      <form className="le-toolbar" onSubmit={e => { e.preventDefault(); setSearch(q.trim()); setPage(1); }}>
        <label className="le-search"><Search size={15} /><input placeholder="Search question text" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Select label="Class" value={classId} onChange={v => reset(() => setClassId(v))} options={optionsOf(classes, "All classes")} />
        <Select label="Subject" value={subjectId} onChange={v => reset(() => setSubjectId(v))} options={optionsOf(subjects, "All subjects")} />
        <Select label="Origin" value={origin} onChange={v => { setOrigin(v); setPage(1); }} options={[["", "Any origin"], ["elibrary", "From the e-library"], ["capture", "From scanned books"]]} />
      </form>
    </Card>
    {(list.error || groups.error || act.error) && <Notice tone="danger">{list.error || groups.error || act.error}</Notice>}
    {act.done && <Notice tone="success">{act.done}</Notice>}
    <div className="le-grid le-grid--side">
      <Card className="le-card le-groups">
        <h3><Tags size={15} /> Concept groups</h3>
        <button className={!groupId ? "active" : ""} onClick={() => { setGroupId(""); setPage(1); }}><span>All questions</span></button>
        {groups.loading ? <Spinner /> : groups.data.map(g => <button key={g.id} className={groupId === g.id ? "active" : ""} onClick={() => { setGroupId(g.id); setPage(1); }}>
          <span>{g.label}</span><small>{g.questions} q{g.accuracyPct != null ? ` · ${g.accuracyPct}% right` : ""}</small>
        </button>)}
        {!groups.loading && !groups.data.length && <p className="le-muted">No groups for these filters.</p>}
      </Card>
      <Card className="le-card">
        <div className="le-card-head"><div><h2>{num(list.data.total)} question{list.data.total === 1 ? "" : "s"}</h2><p>{groupId ? groups.data.find(g => g.id === groupId)?.label : "All concept groups"}</p></div></div>
        {list.loading && !list.data.items.length ? <Spinner /> : list.data.items.length ? <ol className="le-activities le-activities--bank" start={(page - 1) * pageSize + 1}>
          {list.data.items.map(x => <li key={x.id}>
            <p>{x.stem}</p>
            {Array.isArray(x.options) && x.options.length > 0 && <ul className="le-options">{x.options.map((o: unknown, i: number) => <li key={i}>{String.fromCharCode(65 + i)}. {typeof o === "string" ? o : JSON.stringify(o)}</li>)}</ul>}
            {reveal && x.answer && <p className="le-answer"><b>Answer:</b> {x.answer}</p>}
            <div className="le-q-meta">
              {x.topic && <Badge>{x.topic}</Badge>}{x.kind && <Badge>{words(x.kind)}</Badge>}{x.difficulty && <Badge>Level {x.difficulty}</Badge>}
              <Badge tone={x.origin === "capture" ? "warning" : "neutral"}>{x.origin === "capture" ? "Scanned book" : "E-library"}</Badge>
              {x.timesGiven > 0 && <small className="le-muted">given {x.timesGiven}×</small>}
              {x.sourceUrl ? <a className="le-link" href={x.sourceUrl} target="_blank" rel="noreferrer">{x.sourceTitle || "source"}</a> : x.sourceTitle && <small className="le-muted">{x.sourceTitle}</small>}
              <span className="le-q-actions">
                {x.groupId && <Button variant="ghost" onClick={() => setSimilar(x)}><Shuffle size={14} /> Similar</Button>}
                {me.can.write && <Button variant="ghost" disabled={Boolean(act.busy)} onClick={() => void retire(x.id)}><Ban size={14} /> Retire</Button>}
              </span>
            </div>
          </li>)}
        </ol> : <EmptyState title="No questions" description="Questions arrive as the engine writes lessons and as scanned book pages are analysed." />}
        {list.data.total > pageSize && <Pagination page={page} pages={Math.ceil(list.data.total / pageSize)} onChange={setPage} />}
      </Card>
    </div>
    {similar && <SimilarModal question={similar} reveal={reveal} close={() => setSimilar(null)} />}
  </div>;
}

function SimilarModal({ question, reveal, close }: { question: R; reveal: boolean; close: () => void }) {
  const [harder, setHarder] = useState(false);
  const alts = useLoad<R[]>(`/learn/questions/${question.id}/alternatives?count=8${harder ? "&harder=true" : ""}`, []);
  const copy = () => void navigator.clipboard?.writeText(alts.data.map((a, i) => `${i + 1}. ${a.stem}`).join("\n"));
  return <Modal title="Similar questions" onClose={close}>
    <div className="le-modal-body">
      <p className="le-quote">{question.stem}</p>
      <div className="le-inline"><label className="le-check"><input type="checkbox" checked={harder} onChange={e => setHarder(e.target.checked)} /> Same level or harder</label>
        {alts.data.length > 0 && <Button variant="ghost" onClick={copy}><Copy size={14} /> Copy list</Button>}</div>
      {alts.error && <Notice tone="danger">{alts.error}</Notice>}
      {alts.loading ? <Spinner /> : alts.data.length ? <ol className="le-activities">{alts.data.map(a => <li key={a.id}><p>{a.stem}</p>{reveal && a.answer && <p className="le-answer"><b>Answer:</b> {a.answer}</p>}<small className="le-muted">{a.timesGiven ? `given ${a.timesGiven}×` : "not given yet"}</small></li>)}</ol>
        : <p className="le-muted">No other questions in this group yet.</p>}
    </div>
    <div className="modal-actions"><Button variant="secondary" onClick={close}>Close</Button></div>
  </Modal>;
}

/* ---------------- Book scans ---------------- */

export function ScansView(ctx: Ctx) {
  const { me, setup, go } = ctx;
  const [classId, setClassId] = useState(""), [status, setStatus] = useState("");
  const batches = useLoad<R[]>(`/learn/captures/batches?${new URLSearchParams({ ...(classId ? { classId } : {}), ...(status ? { status } : {}), pageSize: "100" })}`, [], 30_000);
  return <div className="le-page">
    <PageHead title="Book scans" lead="Exercise books and notebooks photographed with the Ledgerly Academics app. Each page is read by the engine, matched to a learner and added to the question bank."
      actions={me.stats.pagesToReview > 0 && <Badge tone="warning">{me.stats.pagesToReview} pages need review</Badge>} />
    <Card className="le-card">
      <div className="le-toolbar">
        <Select label="Class" value={classId} onChange={setClassId} options={optionsOf(me.allClasses ? setup.classes : me.classes, "All classes")} />
        <Select label="Status" value={status} onChange={setStatus} options={[["", "All statuses"], ["open", "Open"], ["processing", "Processing"], ["needs_review", "Needs review"], ["done", "Done"], ["cancelled", "Cancelled"]]} />
      </div>
      {batches.error && <Notice tone="danger">{batches.error}</Notice>}
      {batches.loading && !batches.data.length ? <Spinner /> : batches.data.length ? <div className="le-table-wrap"><table className="le-table">
        <thead><tr><th>Batch</th><th>Class</th><th>Subject</th><th>Pages</th><th>Captured</th><th>Status</th><th /></tr></thead>
        <tbody>{batches.data.map(b => <tr key={b.id} className="le-click" onClick={() => go("scans", b.id)}>
          <td><b>{b.title || words(b.kind)}</b><small className="le-muted">{words(b.kind)}</small></td><td>{b.className || "—"}</td><td>{b.subjectName || "—"}</td>
          <td>{b.pageCount}</td><td>{b.capturedOn || ago(b.createdAt)}</td><td><Badge tone={tone(b.status)}>{words(b.status)}</Badge></td><td><span className="le-link">Open</span></td>
        </tr>)}</tbody></table></div>
        : <EmptyState title="No scans yet" description="Teachers scan pages from the Ledgerly Academics Android app. Batches show up here as they upload." />}
    </Card>
  </div>;
}

export function ScanBatch({ ctx, id }: { ctx: Ctx; id: string }) {
  const { me, go } = ctx;
  const batch = useLoad<R | null>(`/learn/captures/batches/${id}`, null, 20_000);
  const [page, setPage] = useState<R | null>(null);
  const act = useAction();
  const b = batch.data;
  if (batch.loading && !b) return <div className="le-page"><Spinner /></div>;
  if (!b) return <div className="le-page"><Notice tone="danger">{batch.error || "Batch not found."}</Notice></div>;
  const open = !["cancelled"].includes(b.status);
  return <div className="le-page">
    <PageHead eyebrow={`${b.className ?? "No class"} · ${b.subjectName ?? "No subject"}`} title={b.title || words(b.kind)}
      back={<button className="le-back" onClick={() => go("scans")}><ArrowLeft size={14} /> All scans</button>}
      lead={<><Badge tone={tone(b.status)}>{words(b.status)}</Badge> {b.pageCount} pages · captured {b.capturedOn || ago(b.createdAt)}</>}
      actions={me.can.capture && open && <>
        {b.status === "open" && <Button disabled={Boolean(act.busy)} onClick={() => void act.run("submit", async () => { await post(`/learn/captures/batches/${id}/submit`, {}); await batch.reload(true); }, "Batch submitted: the pages are queued for reading.")}><ScanLine size={15} /> Read all pages</Button>}
        <Button variant="secondary" disabled={Boolean(act.busy)} onClick={() => void act.run("cancel", async () => { await post(`/learn/captures/batches/${id}/cancel`, {}); await batch.reload(true); })}><XCircle size={15} /> Cancel batch</Button>
      </>} />
    {act.error && <Notice tone="danger">{act.error}</Notice>}
    {act.done && <Notice tone="success">{act.done}</Notice>}
    <div className="le-stats le-stats--compact">{Object.entries(b.counts ?? {}).map(([k, n]) => <Stat key={k} label={words(k)} value={n as number} tone={tone(k)} />)}</div>
    <div className="le-page-grid">
      {(b.pages as R[]).map(p => <button key={p.id} className="le-scan" onClick={() => setPage(p)}>
        <AuthImage src={`/learn/captures/pages/${p.id}/image`} alt={`Page ${p.seq}`} />
        <span><b>Page {p.seq}</b><Badge tone={tone(p.status)}>{words(p.status)}</Badge></span>
        <small>{p.studentName || p.writtenName || "No learner yet"}{p.pageType ? ` · ${words(p.pageType)}` : ""}</small>
      </button>)}
      {!b.pages.length && <Card className="le-card"><EmptyState title="No pages uploaded" description="Pages appear here as the app uploads them." /></Card>}
    </div>
    {page && <PageModal ctx={ctx} batch={b} page={page} close={() => setPage(null)} changed={() => void batch.reload(true)} />}
  </div>;
}

function PageModal({ ctx, batch, page, close, changed }: { ctx: Ctx; batch: R; page: R; close: () => void; changed: () => void }) {
  const detail = useLoad<R | null>(`/learn/captures/pages/${page.id}`, null);
  const people = useLoad<R>(batch.classId ? `/learn/captures/context?classId=${encodeURIComponent(batch.classId)}` : null, { students: [] });
  const [studentId, setStudentId] = useState<string>(page.studentId ?? "");
  const act = useAction();
  const d = detail.data;
  return <Modal title={`Page ${page.seq}`} onClose={close} locked={Boolean(act.busy)}>
    <div className="le-modal-body le-modal-body--wide le-page-detail">
      <AuthImage src={`/learn/captures/pages/${page.id}/image`} alt={`Page ${page.seq}`} className="le-img--big" />
      <div className="le-stack">
        <p><Badge tone={tone(page.status)}>{words(page.status)}</Badge> {page.pageType && <Badge>{words(page.pageType)}</Badge>}</p>
        {page.error && <Notice tone="danger">{page.error}</Notice>}
        {page.writtenName && <p><small className="le-muted">Name written on the page</small><br /><b>{page.writtenName}</b>{page.studentMatch != null && <span className="le-muted"> · match {typeof page.studentMatch === "number" ? `${Math.round(page.studentMatch * 100)}%` : String(page.studentMatch)}</span>}</p>}
        {ctx.me.can.capture && <div className="le-inline">
          <Select label="Learner" value={studentId} onChange={setStudentId} options={[["", "Choose the learner"], ...(people.data.students as R[] ?? []).map(s => [s.id, `${s.name}${s.admissionNumber ? ` (${s.admissionNumber})` : ""}`] as [string, string])]} />
          <Button variant="secondary" disabled={!studentId || studentId === page.studentId || Boolean(act.busy)} onClick={() => void act.run("student", async () => { await post(`/learn/captures/pages/${page.id}/student`, { studentId }); changed(); }, "Learner saved.")}>Save learner</Button>
          <Button variant="ghost" disabled={page.status === "duplicate" || Boolean(act.busy)} onClick={() => void act.run("again", async () => { await post(`/learn/captures/pages/${page.id}/reanalyze`, {}); changed(); }, "Queued to be read again.")}><RotateCcw size={14} /> Read again</Button>
        </div>}
        {act.error && <Notice tone="danger">{act.error}</Notice>}
        {act.done && <Notice tone="success">{act.done}</Notice>}
        {detail.loading ? <Spinner /> : d?.transcript && <><h3>What the engine read</h3><pre className="le-pre le-pre--soft">{typeof d.transcript === "string" ? d.transcript : JSON.stringify(d.transcript, null, 2)}</pre></>}
      </div>
    </div>
    <div className="modal-actions"><Button variant="secondary" onClick={close}>Close</Button></div>
  </Modal>;
}

/* ---------------- Figure library ---------------- */

export function FiguresView(_: Ctx) {
  const [q, setQ] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1), [open, setOpen] = useState<R | null>(null);
  const pageSize = 24;
  const figures = useLoad<R[]>(`/learn/figures?${new URLSearchParams({ ...(search ? { q: search } : {}), page: String(page), pageSize: String(pageSize) })}`, []);
  return <div className="le-page">
    <PageHead title="Figure library" lead="Diagrams are drawn once, stored unlabelled with the position of every part, then labelled on demand for notes, exercises and exams." />
    <Card className="le-card">
      <form className="le-toolbar" onSubmit={e => { e.preventDefault(); setSearch(q.trim()); setPage(1); }}>
        <label className="le-search"><Search size={15} /><input placeholder="Search figures (e.g. parts of a flower)" value={q} onChange={e => setQ(e.target.value)} /></label>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
    </Card>
    {figures.error && <Notice tone="danger">{figures.error}</Notice>}
    {figures.loading && !figures.data.length ? <Spinner /> : figures.data.length ? <div className="le-figure-grid">
      {figures.data.map(f => <button key={f.id} className="le-figure" onClick={() => setOpen(f)}>
        <AuthImage src={`/learn/figures/${f.id}/base.png`} alt={f.title} />
        <b>{f.title}</b>
        <small>{[f.subject, `${f.parts ?? 0} parts`, `used ${f.uses}×`].filter(Boolean).join(" · ")}</small>
        {f.status !== "ready" && <Badge tone={tone(f.status)}>{words(f.status)}</Badge>}
      </button>)}
    </div> : <Card className="le-card"><EmptyState title="No figures found" description="Figures are added when lessons need a diagram." /></Card>}
    <div className="le-pager">
      <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={15} /> Previous</Button><span>Page {page}</span>
      <Button variant="secondary" disabled={figures.data.length < pageSize} onClick={() => setPage(p => p + 1)}>Next <ChevronRight size={15} /></Button>
    </div>
    {open && <FigureModal figure={open} close={() => setOpen(null)} />}
  </div>;
}

function FigureModal({ figure, close }: { figure: R; close: () => void }) {
  const detail = useLoad<R | null>(`/learn/figures/${figure.id}`, null);
  const [mode, setMode] = useState<"names" | "letters" | "blank">("names"), [made, setMade] = useState<R | null>(null);
  const act = useAction();
  const parts: string[] = (detail.data?.anchors as R[] | undefined)?.map(a => a.name) ?? [];
  const label = () => act.run("label", async () => setMade(await post<R>(`/learn/figures/${figure.id}/labelings`, { mode })));
  return <Modal title={figure.title} onClose={close}>
    <div className="le-modal-body le-modal-body--wide le-figure-detail">
      <div className="le-stack">
        {made?.imageUrl ? <AuthImage key={made.id} src={made.imageUrl} alt={`${figure.title} labelled`} className="le-img--big" /> : <AuthImage src={`/learn/figures/${figure.id}/base.png`} alt={figure.title} className="le-img--big" />}
        {made?.answerKey && <div className="le-answer-key"><h3>Answer key</h3><ul>{Object.entries(made.answerKey as Record<string, string>).map(([k, v]) => <li key={k}><b>{k}</b> {v}</li>)}</ul></div>}
      </div>
      <div className="le-stack">
        <h3><Shapes size={15} /> Parts ({parts.length})</h3>
        {detail.loading ? <Spinner /> : <div className="le-chips">{parts.map(p => <span key={p}>{p}</span>)}</div>}
        <h3><ImageIcon size={15} /> Make a copy</h3>
        <Segmented label="Labels" value={mode} onChange={v => { setMode(v); setMade(null); }} options={[["names", "Named"], ["letters", "Lettered"], ["blank", "Blank"]]} />
        <p className="le-muted">Lettered and blank copies come with an answer key, ready for exercises and exams.</p>
        <Button disabled={Boolean(act.busy)} onClick={() => void label()}>{act.busy ? "Drawing…" : "Make labelled copy"}</Button>
        {act.error && <Notice tone="danger">{act.error}</Notice>}
        {detail.data?.labelings?.length > 0 && <small className="le-muted">{detail.data!.labelings.length === 1 ? "1 labelled copy" : `${detail.data!.labelings.length} labelled copies`} made before</small>}
      </div>
    </div>
    <div className="modal-actions"><Button variant="secondary" onClick={close}>Close</Button></div>
  </Modal>;
}

/* ---------------- Teaching plan (published lesson-aware timetable) ---------------- */

const iso = (d: Date) => d.toISOString().slice(0, 10);
function weekOf(day: string, shift = 0) {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + shift * 7);
  const end = new Date(d); end.setUTCDate(d.getUTCDate() + 6);
  return { from: iso(d), to: iso(end) };
}

export function TeachingView({ me, setup, go }: Ctx) {
  const [shift, setShift] = useState(0), [classId, setClassId] = useState("");
  const { from, to } = weekOf(me.today, shift);
  const plan = useLoad<R[]>(`/learn/plan?${new URLSearchParams({ from, to, ...(classId ? { classId } : {}) })}`, []);
  const act = useAction();
  const mark = (id: string, status: "taught" | "missed" | "planned") => act.run(`${status}-${id}`, async () => { await post(`/learn/plan/${id}/status`, { status }); await plan.reload(true); },
    status === "missed" ? "Marked missed: this class's remaining lessons moved forward." : undefined);
  const days = new Map<string, R[]>();
  for (const p of plan.data) if (p.status !== "free") days.set(p.date, [...(days.get(p.date) ?? []), p]);
  const taught = plan.data.filter(p => p.status === "taught").length, planned = plan.data.filter(p => p.status !== "free").length;
  return <div className="le-page">
    <PageHead title="Teaching plan" lead="The lesson each class gets in each period, from the published timetable and the schemes. Mark periods taught or missed; missed lessons move forward automatically." />
    <Card className="le-card">
      <div className="le-toolbar">
        <div className="le-inline">
          <Button variant="secondary" aria-label="Previous week" onClick={() => setShift(s => s - 1)}><ChevronLeft size={15} /></Button>
          <b className="le-week-label">{new Date(`${from}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short" })} – {new Date(`${to}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</b>
          <Button variant="secondary" aria-label="Next week" onClick={() => setShift(s => s + 1)}><ChevronRight size={15} /></Button>
          {shift !== 0 && <Button variant="ghost" onClick={() => setShift(0)}>This week</Button>}
        </div>
        <Select label="Class" value={classId} onChange={setClassId} options={optionsOf(me.allClasses ? setup.classes : me.classes, "All classes")} />
        {planned > 0 && <span className="le-muted">{taught} of {planned} periods taught</span>}
      </div>
    </Card>
    {(plan.error || act.error) && <Notice tone="danger">{plan.error || act.error}</Notice>}
    {act.done && <Notice tone="success">{act.done}</Notice>}
    {plan.loading && !plan.data.length ? <Spinner /> : days.size ? [...days.entries()].map(([day, rows]) => <Card key={day} className="le-card le-day">
      <h3>{new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}{day === me.today && <Badge tone="success">Today</Badge>}</h3>
      <div className="le-table-wrap"><table className="le-table">
        <thead><tr><th>Time</th><th>Class</th><th>Subject</th><th>Lesson</th><th>Teacher</th><th>Status</th>{me.can.write && <th />}</tr></thead>
        <tbody>{rows.map(p => <tr key={p.id}>
          <td className="le-mono">{p.startsAt}–{p.endsAt}</td><td>{p.className}</td><td>{p.subject}</td>
          <td className="le-wrap">{p.lessonId ? <button className="le-link" onClick={() => go("lessons", p.lessonId)}>{p.topic || "Lesson"}</button> : (p.topic || "—")}{p.subtopic && <small className="le-muted">{p.subtopic}</small>}{p.parts > 1 && <small className="le-muted">part {p.part} of {p.parts}</small>}</td>
          <td>{p.teacher || "—"}</td><td><Badge tone={tone(p.status)}>{words(p.status)}</Badge></td>
          {me.can.write && <td className="le-row-actions">
            {p.status !== "taught" && <Button variant="ghost" disabled={Boolean(act.busy)} onClick={() => void mark(p.id, "taught")}><CalendarCheck size={14} /> Taught</Button>}
            {p.status !== "missed" && <Button variant="ghost" disabled={Boolean(act.busy)} onClick={() => void mark(p.id, "missed")}><CalendarX size={14} /> Missed</Button>}
            {p.status !== "planned" && <Button variant="ghost" disabled={Boolean(act.busy)} onClick={() => void mark(p.id, "planned")}><RotateCcw size={14} /> Undo</Button>}
          </td>}
        </tr>)}</tbody></table></div>
    </Card>) : <Card className="le-card"><EmptyState title="Nothing planned this week" description="Periods appear here once a timetable is generated and published for the term, and schemes are written for its subjects." /></Card>}
  </div>;
}

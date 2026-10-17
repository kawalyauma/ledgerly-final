import { useState } from "react";
import { ArrowLeft, BookOpen, Download, ExternalLink, Pencil, Printer, RotateCcw, Target } from "lucide-react";
import { downloadFile, patch, post } from "../../../../web/api";
import { Badge, Button, Card, Modal, Notice, Spinner } from "../../../../web/components/ui";
import { AuthImage, fmtDate, Markdown, openAuthed, PageHead, Segmented, tone, useAction, useLoad, words, type Ctx, type R } from "./shared";

const list = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : typeof v === "string" && v.trim() ? v.split(/,\s*/) : [];

export function LessonView({ ctx, id }: { ctx: Ctx; id: string }) {
  const { me, go } = ctx;
  const lesson = useLoad<R | null>(`/learn/lessons/${id}`, null);
  const activities = useLoad<{ items: R[]; total: number }>(`/learn/questions?lessonId=${encodeURIComponent(id)}&pageSize=100`, { items: [], total: 0 });
  const [tab, setTab] = useState<"notes" | "plan" | "activities" | "sources">("notes");
  const [editing, setEditing] = useState(false), [reveal, setReveal] = useState(false);
  const act = useAction();
  const l = lesson.data;
  if (lesson.loading && !l) return <div className="le-page"><Spinner label="Loading the lesson" /></div>;
  if (lesson.error || !l) return <div className="le-page"><Button variant="ghost" onClick={() => history.back()}><ArrowLeft size={15} /> Back</Button><Notice tone="danger">{lesson.error || "Lesson not found."}</Notice></div>;

  const plan: R | null = l.lessonPlan && typeof l.lessonPlan === "object" ? l.lessonPlan : null;
  const steps: R[] = Array.isArray(plan?.steps) ? plan!.steps : [];
  const minutes = steps.reduce((n, s) => n + Number(s.minutes || 0), 0);
  const methods = list(plan?.methods ?? l.methods), materials = list(plan?.materials ?? l.materials), lifeSkills = list(plan?.lifeSkills ?? l.lifeSkills);
  const objectives: string[] = Array.isArray(l.objectives) ? l.objectives : [];
  const busy = ["pending", "writing"].includes(l.status);

  return <div className="le-page">
    <PageHead eyebrow={`${l.unit ?? "Lesson"} · Week ${l.week ?? "—"}${l.dayName ? ` · ${l.dayName}` : ""}`} title={l.title}
      back={<button className="le-back" onClick={() => go("schemes", l.schemeId)}><ArrowLeft size={14} /> Back to the scheme</button>}
      lead={<>{l.subtopic && <span className="le-lead-sub">{l.subtopic}</span>} <Badge tone={tone(l.status)}>{words(l.status)}</Badge>{l.kind === "practice" && <> <Badge>Part B · practice</Badge></>}{l.planStatus && l.planStatus !== "none" && <> <Badge tone={tone(l.planStatus)}>Plan: {words(l.planStatus)}</Badge></>}{l.writtenAt && <span className="le-muted"> · written {fmtDate(l.writtenAt)}</span>}</>}
      actions={<>
        <Button variant="secondary" disabled={!l.notes} onClick={() => void act.run("print", () => openAuthed(`/learn/lessons/${id}/print`))}><Printer size={15} /> Print</Button>
        <Button variant="secondary" disabled={!l.notes || Boolean(act.busy)} onClick={() => void act.run("pdf", () => downloadFile(`/learn/schemes/${l.schemeId}/export?format=pdf&lessonId=${encodeURIComponent(id)}`, `${String(l.title).replace(/[^\w.-]+/g, "_").slice(0, 70)}.pdf`))}><Download size={15} /> {act.busy === "pdf" ? "Preparing…" : "PDF"}</Button>
        {me.can.manage && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</Button>}
        {me.can.manage && <Button variant="secondary" disabled={busy || Boolean(act.busy)} onClick={() => void act.run("rewrite", async () => { await post(`/learn/lessons/${id}/rewrite`, {}); await lesson.reload(true); }, "Rewrite queued: the engine (or an agent on the git desk) will write this lesson again.")}><RotateCcw size={15} /> Rewrite</Button>}
      </>} />
    {act.error && <Notice tone="danger">{act.error}</Notice>}
    {act.done && <Notice tone="success">{act.done}</Notice>}
    {l.error && <Notice tone="danger">{l.error}</Notice>}

    <div className="le-grid le-grid--lesson">
      <div className="le-stack">
        <Segmented label="Lesson sections" value={tab} onChange={setTab} options={[["notes", "Notes"], ["plan", "Lesson plan"], ["activities", `Activities (${activities.data.total})`], ["sources", `Sources (${l.citations?.length ?? 0})`]]} />

        {tab === "notes" && <Card className="le-card le-notes">
          {l.notesDisplay || l.notes ? <Markdown text={l.notesDisplay || l.notes} /> : <div className="le-empty-inline"><BookOpen size={20} /><p>{busy ? "The notes are being written." : "No notes yet. Request this week's notes from the scheme page."}</p></div>}
          {l.diagrams?.length > 0 && <div className="le-diagrams">{(l.diagrams as R[]).map(d => <figure key={d.id}><AuthImage src={d.url} alt={d.title || "Diagram"} /><figcaption><b>{d.title}</b>{d.caption && <span>{d.caption}</span>}</figcaption></figure>)}</div>}
        </Card>}

        {tab === "plan" && <Card className="le-card">
          {steps.length ? <>
            <div className="le-card-head"><div><h2>Lesson procedure</h2><p>{minutes} minutes{l.periods > 1 ? ` · ${l.periods} periods` : ""}</p></div></div>
            <ol className="le-steps">{steps.map((s, i) => <li key={i}>
              <div className="le-steps__time"><b>{s.minutes}′</b><span>{s.stage}</span></div>
              <div className="le-steps__body">{s.content && <p className="le-steps__content"><small>Content</small>{s.content}</p>}<p><small>Teacher</small>{s.teacherActivity}</p><p><small>Learners</small>{s.learnerActivity}</p></div>
            </li>)}</ol>
          </> : l.teachingGuide ? <pre className="le-pre le-pre--soft">{l.teachingGuide}</pre> : <div className="le-empty-inline"><p>{l.planStatus === "requested" || l.planStatus === "writing" ? "The plan is being written." : "No lesson plan yet. Plans are made from the notes, week by week."}</p></div>}
          {(plan?.priorKnowledge || plan?.competences?.length > 0) && <div className="le-plan-extra">
            {Array.isArray(plan?.competences) && plan!.competences.length > 0 && <p><b>Competences</b>{plan!.competences.join(" ")}</p>}
            {plan?.languageCompetence && <p><b>Language competence</b>{plan.languageCompetence}</p>}
            {plan?.priorKnowledge && <p><b>Prior knowledge</b>{plan.priorKnowledge}</p>}
          </div>}
          {(plan?.homework || l.assessment || plan?.assessment) && <div className="le-plan-extra">
            {(plan?.assessment || l.assessment) && <p><b>Assessment</b>{plan?.assessment || l.assessment}</p>}
            {plan?.homework && <p><b>Homework</b>{plan.homework}</p>}
          </div>}
        </Card>}

        {tab === "activities" && <Card className="le-card">
          <div className="le-card-head"><div><h2>Activities</h2><p>Exercises taken from the sources. Each one is in the question bank too.</p></div>
            <Button variant="secondary" onClick={() => setReveal(r => !r)}>{reveal ? "Hide answers" : "Show answers"}</Button></div>
          {activities.loading ? <Spinner /> : activities.data.items.length ? <ol className="le-activities">{activities.data.items.map(q => <li key={q.id}>
            <p>{q.stem}</p>
            {Array.isArray(q.options) && q.options.length > 0 && <ul className="le-options">{q.options.map((o: unknown, i: number) => <li key={i}>{String.fromCharCode(65 + i)}. {typeof o === "string" ? o : JSON.stringify(o)}</li>)}</ul>}
            {reveal && q.answer && <p className="le-answer"><b>Answer:</b> {q.answer}</p>}
            <small className="le-muted">{[q.kind && words(q.kind), q.difficulty && `difficulty ${q.difficulty}`, q.sourceTitle].filter(Boolean).join(" · ")}</small>
          </li>)}</ol> : <p className="le-muted">No activities recorded for this lesson.</p>}
        </Card>}

        {tab === "sources" && <Card className="le-card">
          <div className="le-card-head"><div><h2>Where this lesson comes from</h2><p>Every note section and activity is quoted from these passages. Nothing is invented.</p></div></div>
          <ul className="le-cites">{(l.citations as R[] ?? []).map(c => <li key={c.passageId}><b>{c.title}</b><span>part {c.part}</span>{c.pageUrl && <a className="le-link" href={c.pageUrl} target="_blank" rel="noreferrer">Open <ExternalLink size={12} /></a>}<code className="le-mono le-muted">{c.passageId}</code></li>)}</ul>
          {!l.citations?.length && <p className="le-muted">No citations recorded.</p>}
        </Card>}
      </div>

      <aside className="le-stack">
        <Card className="le-card le-side">
          <h3><Target size={15} /> Objectives</h3>
          {objectives.length ? <ul>{objectives.map((o, i) => <li key={i}>{o}</li>)}</ul> : <p className="le-muted">None recorded.</p>}
        </Card>
        {(methods.length > 0 || materials.length > 0 || lifeSkills.length > 0) && <Card className="le-card le-side">
          {methods.length > 0 && <><h3>Methods</h3><div className="le-chips">{methods.map((m, i) => <span key={i}>{m}</span>)}</div></>}
          {materials.length > 0 && <><h3>Materials</h3><div className="le-chips">{materials.map((m, i) => <span key={i}>{m}</span>)}</div></>}
          {lifeSkills.length > 0 && <><h3>Life skills</h3><div className="le-chips">{lifeSkills.map((m, i) => <span key={i}>{m}</span>)}</div></>}
        </Card>}
      </aside>
    </div>
    {editing && <EditLesson lesson={l} close={() => setEditing(false)} saved={async () => { setEditing(false); await lesson.reload(true); }} />}
  </div>;
}

function EditLesson({ lesson, close, saved }: { lesson: R; close: () => void; saved: () => Promise<void> }) {
  const [title, setTitle] = useState<string>(lesson.title ?? ""), [subtopic, setSubtopic] = useState<string>(lesson.subtopic ?? "");
  const [objectives, setObjectives] = useState<string>((Array.isArray(lesson.objectives) ? lesson.objectives : []).join("\n"));
  const [notes, setNotes] = useState<string>(lesson.notes ?? ""), [preview, setPreview] = useState(false);
  const act = useAction();
  const save = () => act.run("save", async () => {
    await patch(`/learn/lessons/${lesson.id}`, { title: title.trim(), subtopic: subtopic.trim() || null, objectives: objectives.split("\n").map(x => x.trim()).filter(Boolean), notes: notes.trim() || null });
    await saved();
  });
  return <Modal title="Edit lesson" onClose={close} locked={Boolean(act.busy)}>
    <div className="le-modal-body le-modal-body--wide">
      <div className="le-form le-form--2">
        <label className="field"><span>Title</span><input value={title} onChange={e => setTitle(e.target.value)} /></label>
        <label className="field"><span>Subtopic</span><input value={subtopic} onChange={e => setSubtopic(e.target.value)} /></label>
      </div>
      <label className="field"><span>Objectives (one per line)</span><textarea rows={3} value={objectives} onChange={e => setObjectives(e.target.value)} /></label>
      <div className="le-editor-head"><span>Notes (Markdown)</span><Segmented label="Editor mode" value={preview ? "preview" : "edit"} onChange={v => setPreview(v === "preview")} options={[["edit", "Edit"], ["preview", "Preview"]]} /></div>
      {preview ? <div className="le-card le-notes le-notes--preview"><Markdown text={notes} /></div> : <textarea className="le-code" rows={18} value={notes} onChange={e => setNotes(e.target.value)} />}
      <Notice tone="info">Hand edits are kept as they are. Use <b>Rewrite</b> instead if you want the engine to write the lesson again from the sources.</Notice>
      {act.error && <Notice tone="danger">{act.error}</Notice>}
    </div>
    <div className="modal-actions"><Button variant="secondary" onClick={close}>Cancel</Button><Button disabled={!title.trim() || Boolean(act.busy)} onClick={() => void save()}>{act.busy ? "Saving…" : "Save lesson"}</Button></div>
  </Modal>;
}

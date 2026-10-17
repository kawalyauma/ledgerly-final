import { useState } from "react";
import { ArrowRight, BookMarked, Bot, CalendarClock, ExternalLink, GitBranch, GraduationCap, ScanLine, Search, Sparkles } from "lucide-react";
import { useHashSegments } from "../../../../web/navigation";
import { Badge, Button, Card, Notice, Spinner } from "../../../../web/components/ui";
import { AgentsView } from "./AgentsView";
import { LessonView } from "./LessonView";
import { FiguresView, QuestionsView, ScanBatch, ScansView, TeachingView } from "./ResourceViews";
import { SchemeDetail, SchemesView } from "./SchemesView";
import { ago, num, PageHead, Stat, tone, useLoad, words, type Ctx, type Me, type R, type Setup } from "./shared";
import "./learning-engine.css";

/**
 * Learning engine: the GitHub- and agent-powered academics module (backend /api/v1/learn).
 * Hash routes: learning, learning/schemes[/<id>], learning/lessons/<id>, learning/agents, learning/questions,
 * learning/scans[/<id>], learning/figures, learning/teaching.
 */
export function LearningEngineWorkspace() {
  const [segments, go] = useHashSegments("learning");
  const me = useLoad<Me | null>("/learn/me", null);
  const setup = useLoad<Setup>("/academics/setup", { terms: [], classes: [], subjects: [] });
  if (me.loading && !me.data) return <div className="le-page"><Spinner label="Opening the learning engine" /></div>;
  if (!me.data) return <div className="le-page"><Notice tone="danger">{me.error || "The learning engine could not be reached."}</Notice><Button onClick={() => void me.reload()}>Try again</Button></div>;
  // Teachers without the academics setup scope still get their own classes and subjects from /learn/me.
  const lists: Setup = setup.data.terms.length ? setup.data : { terms: me.data.term ? [me.data.term] : [], classes: me.data.classes, subjects: me.data.subjects };
  const ctx: Ctx = { me: me.data, setup: lists, go };
  const [view, id] = segments;
  switch (view) {
    case "schemes": return id ? <SchemeDetail key={id} ctx={ctx} id={id} /> : <SchemesView {...ctx} />;
    case "lessons": return id ? <LessonView key={id} ctx={ctx} id={id} /> : <SchemesView {...ctx} />;
    case "agents": return <AgentsView {...ctx} />;
    case "questions": return <QuestionsView {...ctx} />;
    case "scans": return id ? <ScanBatch key={id} ctx={ctx} id={id} /> : <ScansView {...ctx} />;
    case "figures": return <FiguresView {...ctx} />;
    case "teaching": return <TeachingView {...ctx} />;
    default: return <Overview {...ctx} />;
  }
}

function greeting(now: string) {
  const h = Number(now.slice(0, 2));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Overview(ctx: Ctx) {
  const { me, go } = ctx;
  const engine = useLoad<R | null>("/learn/engine", null, 30_000);
  const desk = useLoad<R | null>("/learn/engine/git-desk", null, 30_000);
  const schemes = useLoad<R[]>(me.term?.id ? `/learn/schemes?termId=${encodeURIComponent(me.term.id)}` : "/learn/schemes", [], 30_000);
  const s = engine.data?.settings;
  const queued = (engine.data?.queue as R[] | undefined)?.filter(q => q.status === "queued" || q.status === "running").reduce((n, q) => n + q.n, 0) ?? 0;
  const open = desk.data ? (desk.data.counts.open ?? 0) + (desk.data.counts.reopened ?? 0) + (desk.data.counts.to_publish ?? 0) : 0;
  const working = schemes.data.filter(x => ["sourcing", "outlining", "writing", "review"].includes(x.status)).slice(0, 6);
  const firstName = me.user.name.split(" ")[0];
  return <div className="le-page">
    <PageHead eyebrow={[me.school, me.term?.name, me.term?.week ? `Week ${me.term.week}` : null].filter(Boolean).join(" · ") || "Learning engine"}
      title={`${greeting(me.now)}, ${firstName}`}
      lead="Schemes, notes and lesson plans written from the school's own sources by AI agents working through GitHub, checked line by line before teachers see them."
      actions={me.can.manage && <Button onClick={() => go("schemes")}><BookMarked size={15} /> Schemes</Button>} />

    <SearchBox ctx={ctx} />

    <div className="le-stats">
      <Stat label="Schemes published" value={num(me.stats.schemesPublished)} hint={me.stats.schemesToReview ? `${me.stats.schemesToReview} waiting for review` : "none waiting"} icon={<BookMarked size={18} />} tone="brand" onClick={() => go("schemes")} />
      <Stat label="Periods this week" value={`${me.week.taught} / ${me.week.planned}`} hint="taught so far" icon={<CalendarClock size={18} />} onClick={() => go("teaching")} />
      <Stat label="Lessons recorded" value={num(me.stats.lessonsTaught)} hint="by you this term" icon={<GraduationCap size={18} />} />
      <Stat label="Book pages" value={num(me.stats.pagesScanned)} hint={me.stats.pagesToReview ? `${me.stats.pagesToReview} need review` : "all reviewed"} tone={me.stats.pagesToReview ? "warning" : "neutral"} icon={<ScanLine size={18} />} onClick={() => go("scans")} />
    </div>

    <div className="le-grid le-grid--2">
      <Card className="le-card le-engine-card">
        <div className="le-card-head"><div><h2><Bot size={18} /> Writing engine</h2><p>{s ? <>Provider <b>{s.provider === "git" ? "GitHub agents" : words(s.provider)}</b> · {num(engine.data?.today?.steps)} of {num(s.dailyTaskLimit)} AI steps used today</> : "Loading…"}</p></div>
          {s && <Badge tone={s.state === "running" ? "success" : s.state === "paused" ? "warning" : "danger"}>{words(s.state)}</Badge>}</div>
        <div className="le-mini-stats">
          <span><b>{num(queued)}</b>steps waiting or running</span>
          <span><b>{num(open)}</b>jobs open on GitHub</span>
          <span><b>{num(desk.data?.counts.answered ?? 0)}</b>answers being applied</span>
        </div>
        {desk.data && <p className="le-muted le-desk-line"><GitBranch size={14} /> {desk.data.enabled ? <>Git desk connected · last sync {ago(desk.data.lastSyncAt)}{desk.data.lastError && <Badge tone="danger">Sync error</Badge>}</> : "Git desk not configured on the server"}</p>}
        <Button variant="secondary" onClick={() => go("agents")}>Open Agents & GitHub <ArrowRight size={15} /></Button>
      </Card>

      <Card className="le-card">
        <div className="le-card-head"><div><h2><Sparkles size={18} /> In progress{me.term ? ` · ${me.term.name}` : ""}</h2><p>Schemes the engine is writing or that wait for the Director of Studies.</p></div></div>
        {schemes.loading && !schemes.data.length ? <Spinner /> : working.length ? <ul className="le-mini-list le-mini-list--rows">
          {working.map(x => <li key={x.id}><button className="le-link" onClick={() => go("schemes", x.id)}>{x.title}</button><Badge tone={tone(x.status)}>{words(x.status)}</Badge><small className="le-muted">{x.written}/{x.lessons} written</small></li>)}
        </ul> : <p className="le-muted">Nothing in progress. {me.can.manage && <button className="le-link" onClick={() => go("schemes")}>Start a scheme</button>}</p>}
      </Card>
    </div>

    <Card className="le-card">
      <div className="le-card-head"><div><h2><CalendarClock size={18} /> Today{me.allClasses ? " across the school" : ""}</h2>
        <p>{me.nowPeriod ? <>Now: <b>{me.nowPeriod.className} · {me.nowPeriod.subject}</b>{me.nowPeriod.topic ? ` · ${me.nowPeriod.topic}` : ""}</> : me.nextPeriod ? <>Next at {me.nextPeriod.startsAt}: <b>{me.nextPeriod.className} · {me.nextPeriod.subject}</b></> : "No more periods today."}</p></div>
        <Button variant="ghost" onClick={() => go("teaching")}>Week plan <ArrowRight size={14} /></Button></div>
      {me.todayPlan.filter(p => p.status !== "free").length ? <div className="le-table-wrap"><table className="le-table">
        <thead><tr><th>Time</th><th>Class</th><th>Subject</th><th>Lesson</th><th>Status</th></tr></thead>
        <tbody>{me.todayPlan.filter(p => p.status !== "free").slice(0, 40).map(p => <tr key={p.id} className={me.nowPeriod?.id === p.id ? "le-now" : ""}>
          <td className="le-mono">{p.startsAt}–{p.endsAt}</td><td>{p.className}</td><td>{p.subject}</td>
          <td className="le-wrap">{p.lessonId ? <button className="le-link" onClick={() => go("lessons", p.lessonId)}>{p.topic || "Lesson"}</button> : p.topic || "—"}{p.subtopic && <small className="le-muted">{p.subtopic}</small>}</td>
          <td><Badge tone={tone(p.status)}>{words(p.status)}</Badge></td></tr>)}</tbody></table></div>
        : <p className="le-muted">No periods planned today. The plan comes from a published timetable and the schemes of its subjects.</p>}
    </Card>
  </div>;
}

function SearchBox({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState(""), [term, setTerm] = useState("");
  const res = useLoad<R | null>(term.length >= 2 ? `/learn/search?q=${encodeURIComponent(term)}` : null, null);
  const r = res.data;
  const empty = r && !r.lessons.length && !r.questions.length && !r.learners.length && !r.resources.length;
  return <Card className="le-card le-searchcard">
    <form onSubmit={e => { e.preventDefault(); setTerm(q.trim()); }} className="le-search le-search--big" role="search">
      <Search size={18} /><input placeholder="Search lessons, questions, learners and the e-library" value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
      <Button type="submit" disabled={q.trim().length < 2}>Search</Button>
    </form>
    {res.error && <Notice tone="danger">{res.error}</Notice>}
    {term && res.loading && <Spinner label="Searching" />}
    {r && !res.loading && (empty ? <p className="le-muted">Nothing found for “{term}”.</p> : <div className="le-results">
      {r.lessons.length > 0 && <section><h3>Lessons</h3><ul>{(r.lessons as R[]).map(l => <li key={l.id}><button className="le-link" onClick={() => ctx.go("lessons", l.id)}>{l.title}</button><small>{l.className} · {l.subject}{l.week ? ` · week ${l.week}` : ""}</small></li>)}</ul></section>}
      {r.questions.length > 0 && <section><h3>Questions</h3><ul>{(r.questions as R[]).map(x => <li key={x.id}><span>{x.stem}</span><small>{[x.className, x.subject, x.topic].filter(Boolean).join(" · ")}</small></li>)}</ul></section>}
      {r.learners.length > 0 && <section><h3>Learners</h3><ul>{(r.learners as R[]).map(x => <li key={x.id}><span>{x.name}</span><small>{[x.admissionNumber, x.className].filter(Boolean).join(" · ")}</small></li>)}</ul></section>}
      {r.resources.length > 0 && <section><h3>E-library</h3><ul>{(r.resources as R[]).map(x => <li key={x.slug}><a className="le-link" href={x.pageUrl} target="_blank" rel="noreferrer">{x.title} <ExternalLink size={12} /></a><small>{[x.type && words(x.type), x.class].filter(Boolean).join(" · ")}</small></li>)}</ul></section>}
    </div>)}
  </Card>;
}

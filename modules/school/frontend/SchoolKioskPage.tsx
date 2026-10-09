import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, BookOpenCheck, CalendarDays, CircleDollarSign, Clock3, GraduationCap, HeartPulse, ListChecks, Maximize, Megaphone, NotebookPen, RefreshCw, School, ShieldCheck, UserCheck, Users } from "lucide-react";
import { api, errorText } from "../../../web/api";
import "./school-kiosk.css";

type R = Record<string, any>;

const KEY_STORE = "ledgerly.kioskKey";
const REFRESH_MS = 60_000;
const ROTATE_MS = 14_000;

const n = (value: unknown) => Number(value || 0);
const percent = (part: unknown, total: unknown) => n(total) ? Math.round(n(part) * 100 / n(total)) : 0;
const className = (value: unknown) => String(value ?? "").replace(/\s+20\d\d$/, "") || "Unassigned";
const hhmm = (value: unknown) => String(value ?? "").slice(0, 5);
const minutesOf = (value: unknown) => { const [h, m] = String(value ?? "").split(":").map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : NaN; };
const initials = (name: unknown) => String(name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";
const title = (value: unknown) => String(value ?? "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

function money(value: unknown, currency = "UGX") {
  return new Intl.NumberFormat("en-UG", { style: "currency", currency, maximumFractionDigits: currency === "UGX" ? 0 : 2 }).format(n(value) / 100);
}

function termDate(value: unknown) {
  const date = new Date(`${String(value ?? "").slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-UG", { day: "numeric", month: "short", year: "numeric" });
}

function shortDay(value: unknown) {
  const date = new Date(`${String(value ?? "").slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-UG", { weekday: "short", day: "numeric", month: "short" });
}

/** The display key arrives once as #kiosk=<key>; it is kept on the device and scrubbed from the address bar. */
export function kioskKeyFromLocation() {
  const match = window.location.hash.match(/^#kiosk=([\w-]+)/);
  if (match) {
    localStorage.setItem(KEY_STORE, match[1]);
    history.replaceState(null, "", `${window.location.pathname}#kiosk`);
  }
  return localStorage.getItem(KEY_STORE);
}

/** Animates a number towards its new value so changes are noticed on a wall display. */
function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setValue(target); from.current = target; return; }
    const start = performance.now(), origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - t, 3);
      setValue(origin + (target - origin) * eased);
      if (t < 1) frame = requestAnimationFrame(step); else from.current = target;
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); from.current = target; };
  }, [target, duration]);
  return value;
}

/** Cycles long lists a page at a time so every class gets screen time without shrinking text. */
function usePager<T>(items: T[], size: number, ms = 8_000) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
    if (pages < 2) return;
    const timer = window.setInterval(() => setPage(current => (current + 1) % pages), ms);
    return () => clearInterval(timer);
  }, [pages, ms]);
  const current = page % pages;
  return { rows: items.slice(current * size, current * size + size), page: current, pages };
}

function PageDots({ page, pages }: { page: number; pages: number }) {
  return pages > 1 ? <span className="kiosk-pages">{page + 1}/{pages}</span> : null;
}

function Count({ value, format = v => Math.round(v).toLocaleString() }: { value: number; format?: (value: number) => string }) {
  return <>{format(useCountUp(value))}</>;
}

function Metric({ icon: Icon, label, value, suffix = "", note, tone, index }: { icon: typeof School; label: string; value: number; suffix?: string; note: string; tone: string; index: number }) {
  return <article className={`kiosk-card kiosk-metric kiosk-metric--${tone}`} style={{ ["--i" as string]: index }}>
    <span className="kiosk-metric__icon"><Icon/></span>
    <div><small>{label}</small><strong><Count value={value}/>{suffix}</strong><p>{note}</p></div>
  </article>;
}

function Panel({ index, kicker, title: heading, icon: Icon, aside, className: extra = "", children }: { index: number; kicker: string; title: string; icon?: typeof School; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return <article className={`kiosk-card kiosk-panel ${extra}`} style={{ ["--i" as string]: index }}>
    <header className="kiosk-panel__head"><div><small>{kicker}</small><h2>{heading}</h2></div>{aside ?? (Icon && <Icon/>)}</header>
    {children}
  </article>;
}

function Empty({ icon: Icon, text, hint }: { icon: typeof School; text: string; hint?: string }) {
  return <div className="kiosk-empty"><Icon/><b>{text}</b>{hint && <small>{hint}</small>}</div>;
}

function TopicLine({ lesson }: { lesson: R }) {
  if (!lesson.topic && !lesson.subtopic) return <small className="kiosk-topic is-muted">Topic not planned yet</small>;
  return <small className="kiosk-topic">{lesson.topic}{lesson.subtopic && <><i>›</i>{lesson.subtopic}</>}</small>;
}

/** Current and next lesson per class from timed lessons; untimed lesson plans are listed as today's lessons. */
function LessonBoard({ lessons, now }: { lessons: R[]; now: Date }) {
  const minute = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const timed = lessons.filter(lesson => Number.isFinite(minutesOf(lesson.startsAt)) && Number.isFinite(minutesOf(lesson.endsAt)));
  if (!lessons.length) return <Empty icon={CalendarDays} text="No lessons scheduled for today" hint="Publish a timetable or add lesson plans to show what is being taught."/>;

  if (!timed.length) return <PlannedLessons lessons={lessons}/>;
  return <TimedLessons timed={timed} minute={minute}/>;
}

function PlannedLessons({ lessons }: { lessons: R[] }) {
  const { rows, page, pages } = usePager(lessons, 4);
  return <><div className="kiosk-period"><b>Lessons planned today</b><span>{lessons.length} lesson{lessons.length === 1 ? "" : "s"} · no timetable published <PageDots page={page} pages={pages}/></span></div>
  <ul key={page} className="kiosk-lessons">
    {rows.map((lesson, index) => <li key={index} style={{ ["--d" as string]: `${index * 70}ms` }}>
      <span className="kiosk-lessons__class">{className(lesson.className)}</span>
      <p><b>{title(lesson.subject)}{lesson.teacher && <em> · {title(lesson.teacher)}</em>}</b><TopicLine lesson={lesson}/></p>
      {lesson.planStatus && <span className={`kiosk-chip kiosk-chip--${lesson.planStatus}`}>{String(lesson.planStatus).replaceAll("_", " ")}</span>}
    </li>)}
  </ul></>;
}

function TimedLessons({ timed, minute }: { timed: R[]; minute: number }) {

  const running = timed.filter(lesson => minutesOf(lesson.startsAt) <= minute && minute < minutesOf(lesson.endsAt));
  const upcoming = timed.filter(lesson => minutesOf(lesson.startsAt) > minute);
  const slot = running[0] ?? null;
  const nextStart = upcoming.length ? Math.min(...upcoming.map(lesson => minutesOf(lesson.startsAt))) : null;
  const classes = [...new Set(timed.map(lesson => String(lesson.className)))].sort();
  const rows = classes.map(name => ({
    name,
    current: running.find(lesson => String(lesson.className) === name),
    next: upcoming.filter(lesson => String(lesson.className) === name).sort((a, b) => minutesOf(a.startsAt) - minutesOf(b.startsAt))[0],
  })).filter(row => row.current || row.next);
  const pager = usePager(rows, 4);

  const status = slot
    ? { label: `Period ${hhmm(slot.startsAt)} – ${hhmm(slot.endsAt)}`, note: `${Math.max(0, Math.ceil(minutesOf(slot.endsAt) - minute))} min left`, progress: (minute - minutesOf(slot.startsAt)) * 100 / Math.max(1, minutesOf(slot.endsAt) - minutesOf(slot.startsAt)) }
    : nextStart !== null
      ? { label: "Break", note: `Next period ${String(Math.floor(nextStart / 60)).padStart(2, "0")}:${String(Math.round(nextStart % 60)).padStart(2, "0")} · in ${Math.ceil(nextStart - minute)} min`, progress: 0 }
      : { label: "Lessons over for today", note: `${timed.length} lessons taught`, progress: 100 };

  return <>
    <div className="kiosk-period"><b>{status.label}</b><span>{status.note} <PageDots page={pager.page} pages={pager.pages}/></span><i><em style={{ width: `${Math.min(100, Math.max(0, status.progress))}%` }}/></i></div>
    {rows.length ? <div key={pager.page} className="kiosk-nownext">
      <div className="kiosk-nownext__head"><span>Class</span><span>Now</span><span>Next</span></div>
      {pager.rows.map((row, index) => <div key={row.name} className="kiosk-nownext__row" style={{ ["--d" as string]: `${index * 60}ms` }}>
        <span className="kiosk-lessons__class">{className(row.name)}</span>
        <p>{row.current ? <><b>{title(row.current.subjectShort || row.current.subject)}{row.current.teacher && <em> · {title(row.current.teacher)}</em>}</b><TopicLine lesson={row.current}/></> : <small className="kiosk-topic is-muted">Free / break</small>}</p>
        <p>{row.next ? <><b>{hhmm(row.next.startsAt)} {title(row.next.subjectShort || row.next.subject)}</b><TopicLine lesson={row.next}/></> : <small className="kiosk-topic is-muted">Done for today</small>}</p>
      </div>)}
    </div> : <Empty icon={Clock3} text="School day complete" hint="Tomorrow's lessons appear here from the first period."/>}
  </>;
}

function DutyPanel({ duty }: { duty: R[] }) {
  const lead = duty[0];
  if (!lead) return <Empty icon={ShieldCheck} text="No teacher on duty assigned" hint="Set this week's duty team in School › Duty roster."/>;
  return <div className="kiosk-duty">
    <div className="kiosk-duty__lead">
      <span className="kiosk-avatar">{initials(lead.staffName)}</span>
      <div><small>{lead.dutyRole}</small><b>{title(lead.staffName)}</b><span>{shortDay(lead.startsOn)} – {shortDay(lead.endsOn)}</span></div>
    </div>
    {lead.notes && <p className="kiosk-duty__note">{lead.notes}</p>}
    <ul>{duty.slice(1, 5).map((row, index) => <li key={index} style={{ ["--d" as string]: `${index * 80}ms` }}><span className="kiosk-avatar kiosk-avatar--sm">{initials(row.staffName)}</span><p><b>{title(row.staffName)}</b><small>{row.dutyRole}</small></p></li>)}</ul>
  </div>;
}

function CoveragePanel({ coverage, plans }: { coverage: R[]; plans: R }) {
  const chips = [
    { key: "draft", label: "Draft", value: n(plans.draft) },
    { key: "submitted", label: "Submitted", value: n(plans.submitted) },
    { key: "approved", label: "Approved", value: n(plans.approved) },
    { key: "changes_requested", label: "Changes", value: n(plans.changesRequested) },
    { key: "delivered", label: "Delivered", value: n(plans.delivered) },
  ];
  return <>
    <div className="kiosk-plans">{chips.map(chip => <div key={chip.key} className={`kiosk-plans__chip kiosk-chip--${chip.key}`}><b><Count value={chip.value}/></b><small>{chip.label}</small></div>)}</div>
    <div className="kiosk-coverage">
      {coverage.slice(0, 5).map((row, index) => {
        const total = n(row.lessons) || n(row.itemPeriods), done = n(row.lessons) ? n(row.delivered) : n(row.itemPeriodsDone);
        const rate = percent(done, total), due = percent(row.due, row.lessons);
        return <div key={index} className="kiosk-coverage__row" style={{ ["--d" as string]: `${index * 70}ms` }}>
          <div><b>{className(row.className)} · {title(row.subject)}</b><span>{rate}% <small>{done}/{total}</small></span></div>
          <i><u style={{ width: `${due}%` }}/><em style={{ width: `${rate}%` }}/></i>
          <small>{row.currentTopic ? `Now: ${row.currentTopic}` : row.teacher ? title(row.teacher) : "Scheme of work"}</small>
        </div>;
      })}
      {!coverage.length && <Empty icon={BookOpenCheck} text="No schemes of work this term" hint="Coverage appears once teachers add schemes of work."/>}
    </div>
  </>;
}

function AttendanceBar({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const rate = percent(value, total);
  return <div className={`kiosk-bar kiosk-bar--${tone}`}><div><span>{label}</span><b>{value.toLocaleString()} <small>{rate}%</small></b></div><i><em style={{ width: `${rate}%` }}/></i></div>;
}

function Rotator({ slides }: { slides: { key: string; kicker: string; title: string; icon: typeof School; body: React.ReactNode }[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex(current => (current + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [slides.length]);
  const slide = slides[index % slides.length];
  const Icon = slide.icon;
  return <>
    <header className="kiosk-panel__head"><div><small>{slide.kicker}</small><h2>{slide.title}</h2></div><Icon/></header>
    <div key={slide.key} className="kiosk-slide">{slide.body}</div>
    <div className="kiosk-dots">{slides.map((item, dot) => <i key={item.key} className={dot === index % slides.length ? "is-on" : ""}/>)}</div>
  </>;
}

export function SchoolKioskPage({ apiKey }: { apiKey?: string | null } = {}) {
  const [summary, setSummary] = useState<R | null>(null);
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = apiKey
        ? await fetch("/api/v1/school/kiosk/summary", { cache: "no-store", headers: { Accept: "application/json", "X-API-Key": apiKey } })
          .then(async response => {
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload?.error?.message || `Request failed (${response.status})`);
            return payload.data as R;
          })
        : await api<R>("/school/kiosk/summary", { cache: "no-store" });
      setSummary(data); setError("");
    }
    catch (reason) { setError(reason instanceof Error && apiKey ? reason.message : errorText(reason)); }
    finally { setLoading(false); }
  }, [apiKey]);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => void load(), REFRESH_MS);
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    return () => { clearInterval(refresh); clearInterval(clock); };
  }, [load]);

  const currency = summary?.profile?.defaultCurrency || "UGX";
  const students = summary?.attendance?.students || {};
  const staff = summary?.attendance?.staff || {};
  const services = summary?.services || {};
  const lessons: R[] = summary?.lessons ?? [];
  const coverage: R[] = summary?.coverage ?? [];
  const studentTotal = n(students.expected) || n(summary?.population?.activeStudents);
  const staffTotal = n(summary?.population?.activeStaff);
  const coverageRate = useMemo(() => {
    const total = coverage.reduce((sum, row) => sum + (n(row.lessons) || n(row.itemPeriods)), 0);
    const done = coverage.reduce((sum, row) => sum + (n(row.lessons) ? n(row.delivered) : n(row.itemPeriodsDone)), 0);
    return percent(done, total);
  }, [coverage]);
  const dateLabel = useMemo(() => now.toLocaleDateString("en-UG", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), [now.toDateString()]);
  const termProgress = useMemo(() => {
    const start = new Date(`${String(summary?.period?.termStartsOn ?? "").slice(0, 10)}T00:00:00`).getTime();
    const end = new Date(`${String(summary?.period?.termEndsOn ?? "").slice(0, 10)}T23:59:59`).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return { done: Math.round(Math.min(1, Math.max(0, (Date.now() - start) / (end - start))) * 100), daysLeft: Math.max(0, Math.ceil((end - Date.now()) / 86_400_000)) };
  }, [summary?.period?.termStartsOn, summary?.period?.termEndsOn, dateLabel]);

  // The day schedule starts from the lesson running now so the wall shows what is still to be taught.
  const minuteNow = now.getHours() * 60 + now.getMinutes();
  const remaining = lessons.filter(lesson => !Number.isFinite(minutesOf(lesson.endsAt)) || minutesOf(lesson.endsAt) > minuteNow);
  const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.max(1, Math.ceil(items.length / size)) }, (_, i) => items.slice(i * size, i * size + size));
  const feePages = chunk<R>(summary?.feeStructures ?? [], 5);
  const classPages = chunk<R>(summary?.classes ?? [], 5);
  const slides = [
    { key: "schedule", kicker: "Teaching today", title: "Topics by period", icon: ListChecks, body: remaining.length ? <ul className="kiosk-schedule">
      {remaining.slice(0, 5).map((lesson, index) => <li key={index} style={{ ["--d" as string]: `${index * 60}ms` }}>
        <time>{lesson.startsAt ? hhmm(lesson.startsAt) : "—"}</time>
        <p><b>{className(lesson.className)} · {title(lesson.subjectShort || lesson.subject)}</b><TopicLine lesson={lesson}/></p>
      </li>)}
    </ul> : <Empty icon={ListChecks} text={lessons.length ? "All of today's lessons are done" : "No topics planned for today"} hint="Topics come from lesson plans and schemes of work."/> },
    ...feePages.map((page, pageIndex) => ({ key: `fees-${pageIndex}`, kicker: `${summary?.period?.term || "Term"} fee structure${feePages.length > 1 ? ` · ${pageIndex + 1}/${feePages.length}` : ""}`, title: "Fees per class", icon: CircleDollarSign, body: page.length ? <ul className="kiosk-fees">
      {page.map((row, index) => <li key={index} style={{ ["--d" as string]: `${index * 60}ms` }}>
        <span>{className(row.className)}</span>
        <small>{(row.lines ?? []).map((line: R) => title(line.category)).join(" · ")}</small>
        <b>{money(row.totalMinor, row.currency || currency)}</b>
      </li>)}
    </ul> : <Empty icon={CircleDollarSign} text="No fee structure published" hint="Active fee structures for the current term appear here."/> })),
    ...classPages.map((page, pageIndex) => ({ key: `classes-${pageIndex}`, kicker: `Enrollment${classPages.length > 1 ? ` · ${pageIndex + 1}/${classPages.length}` : ""}`, title: "Learners by class", icon: GraduationCap, body: <ul className="kiosk-fees">
      {page.map((row, index) => <li key={index} style={{ ["--d" as string]: `${index * 60}ms` }}>
        <span>{className(row.name)}</span>
        <small>{n(row.marked) ? `${percent(row.present, row.marked)}% present today` : "Register not marked"}</small>
        <b>{n(row.students)}</b>
      </li>)}
    </ul> })),
    { key: "pulse", kicker: "Around school", title: "Daily pulse", icon: HeartPulse, body: <ul className="kiosk-feed">
      <li><span className="kiosk-feed__icon"><UserCheck/></span><p><b>{n(staff.present)} staff present</b><small>{n(staff.late)} late · {n(staff.absent)} absent · {n(staff.other)} away</small></p></li>
      <li className={n(summary?.discipline?.critical) ? "is-alert" : ""}><span className="kiosk-feed__icon"><AlertTriangle/></span><p><b>{n(summary?.discipline?.critical)} critical safeguarding alerts</b><small>{n(summary?.discipline?.meritsToday)} merits · {n(summary?.discipline?.reportedToday)} behaviour records today</small></p></li>
      <li><span className="kiosk-feed__icon"><HeartPulse/></span><p><b>{n(services.clinicToday)} sick-bay visits</b><small>{n(services.homeworkDue)} homework tasks due today</small></p></li>
      <li><span className="kiosk-feed__icon"><BookOpen/></span><p><b>{n(services.libraryOut)} library books out</b><small>{n(services.libraryOverdue)} overdue</small></p></li>
      <li><span className="kiosk-feed__icon"><Megaphone/></span><p><b>{(summary?.notices ?? []).length ? summary!.notices[0].title : "No notices posted"}</b><small>{(summary?.notices ?? []).length ? `${summary!.notices.length} active parent notice${summary!.notices.length === 1 ? "" : "s"}` : "Parent portal notice board"}</small></p></li>
    </ul> },
  ];

  return <main className="school-kiosk">
    <header className="kiosk-header">
      <div className="kiosk-brand"><span><School/></span><div><small>Ledgerly school operations</small><h1>{summary?.profile?.schoolName || "School dashboard"}</h1><p>{[summary?.period?.academicYear, summary?.period?.term, termProgress && `${termProgress.daysLeft} days to end of term`].filter(Boolean).join(" · ") || "Daily command centre"}</p></div></div>
      <div className="kiosk-clock"><strong>{now.toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" })}<sup>{String(now.getSeconds()).padStart(2, "0")}</sup></strong><span><CalendarDays/> {dateLabel}</span></div>
      <div className="kiosk-actions"><button title="Refresh dashboard" onClick={() => void load()}><RefreshCw className={loading ? "spin" : ""}/></button><button title="Enter full screen" onClick={() => void document.documentElement.requestFullscreen?.()}><Maximize/></button></div>
    </header>

    {error && <div className="kiosk-alert"><AlertTriangle/><span><b>Live data is temporarily unavailable.</b><small>{error} · The dashboard will retry automatically.</small></span></div>}

    <section className="kiosk-metrics">
      <Metric index={0} icon={GraduationCap} tone="blue" label="Active students" value={n(summary?.population?.activeStudents)} note={`in ${(summary?.classes ?? []).length} classes`}/>
      <Metric index={1} icon={UserCheck} tone="good" label="Students present" value={percent(students.present, studentTotal)} suffix="%" note={`${n(students.present).toLocaleString()} present · ${n(students.late).toLocaleString()} late`}/>
      <Metric index={2} icon={Users} tone="violet" label="Staff present" value={percent(staff.present, staffTotal)} suffix="%" note={`${n(staff.present).toLocaleString()} of ${staffTotal.toLocaleString()} staff`}/>
      <Metric index={3} icon={NotebookPen} tone="orange" label="Lessons today" value={lessons.length} note={`${n(summary?.lessonPlans?.thisWeek)} plans for this week`}/>
      <Metric index={4} icon={BookOpenCheck} tone="aqua" label="Syllabus covered" value={coverageRate} suffix="%" note={`${coverage.length} scheme${coverage.length === 1 ? "" : "s"} of work`}/>
    </section>

    <section className="kiosk-grid">
      <Panel index={5} className="kiosk-panel--lessons" kicker="Timetable" title="Now & next" icon={Clock3}>
        <LessonBoard lessons={lessons} now={now}/>
      </Panel>

      <Panel index={6} className="kiosk-panel--duty" kicker="This week" title="Teacher on duty" icon={ShieldCheck}>
        <DutyPanel duty={summary?.duty ?? []}/>
      </Panel>

      <Panel index={7} className="kiosk-panel--coverage" kicker="Lesson plans & coverage" title="Teaching progress" icon={BookOpenCheck}>
        <CoveragePanel coverage={coverage} plans={summary?.lessonPlans ?? {}}/>
      </Panel>

      <Panel index={8} className="kiosk-panel--attendance" kicker="Today’s attendance" title="Student roll call" aside={<span className="kiosk-pill"><Clock3/> {n(students.sessions)} registers</span>}>
        <div className="kiosk-attendance-hero"><strong><Count value={percent(students.present, studentTotal)}/>%</strong><span>present today<small>{n(students.marked).toLocaleString()} of {studentTotal.toLocaleString()} learners marked</small></span></div>
        <div className="kiosk-bars">
          <AttendanceBar label="Present" value={n(students.present)} total={studentTotal} tone="good"/>
          <AttendanceBar label="Absent" value={n(students.absent)} total={studentTotal} tone="critical"/>
          <AttendanceBar label="Late" value={n(students.late)} total={studentTotal} tone="warning"/>
          <AttendanceBar label="Excused / sick" value={n(students.excused)} total={studentTotal} tone="neutral"/>
        </div>
      </Panel>

      <article className="kiosk-card kiosk-panel kiosk-panel--feed" style={{ ["--i" as string]: 9 }}>
        <Rotator slides={slides}/>
      </article>
    </section>

    <footer><span className={error ? "offline" : "online"}/><b>{error ? "Reconnecting" : "Live"}</b><span>Updates every minute</span><span>Last update {summary?.generatedAt ? new Date(summary.generatedAt).toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</span>{termProgress && <span>{termDate(summary?.period?.termStartsOn)} → {termDate(summary?.period?.termEndsOn)}</span>}<span className="kiosk-footer__brand">Powered by Ledgerly</span></footer>
  </main>;
}

/** Standalone wall display: no app shell, authenticated by a display-only API key. */
export function SchoolKioskApp() {
  const [apiKey] = useState(kioskKeyFromLocation);
  useEffect(() => {
    // Pick up new releases and shed long-running memory on unattended screens.
    const timer = window.setTimeout(() => window.location.reload(), 6 * 60 * 60_000);
    return () => clearTimeout(timer);
  }, []);
  if (!apiKey) return <main className="school-kiosk school-kiosk--unlinked"><div className="kiosk-card kiosk-panel"><School/><h2>This display is not linked</h2><p>Open <code>#kiosk=&lt;display key&gt;</code> once on this screen to connect it to your school.</p></div></main>;
  return <SchoolKioskPage apiKey={apiKey}/>;
}

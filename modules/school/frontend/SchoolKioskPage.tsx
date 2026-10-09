import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BookOpen, CalendarDays, CircleDollarSign, Clock3, GraduationCap, HeartPulse, Maximize, Megaphone, ReceiptText, RefreshCw, School, ShieldCheck, TrendingUp, UserCheck, Users } from "lucide-react";
import { api, errorText } from "../../../web/api";
import "./school-kiosk.css";

type R = Record<string, any>;

const KEY_STORE = "ledgerly.kioskKey";
const REFRESH_MS = 60_000;
const ROTATE_MS = 12_000;

const n = (value: unknown) => Number(value || 0);
const percent = (part: unknown, total: unknown) => n(total) ? Math.round(n(part) * 100 / n(total)) : 0;
const className = (value: unknown) => String(value ?? "").replace(/\s+20\d\d$/, "") || "Unassigned";

function money(value: unknown, currency = "UGX", compact = false) {
  return new Intl.NumberFormat("en-UG", { style: "currency", currency, notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : currency === "UGX" ? 0 : 2 }).format(n(value) / 100);
}

function termDate(value: unknown) {
  const date = new Date(`${String(value ?? "").slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-UG", { day: "numeric", month: "short", year: "numeric" });
}

function ago(value: unknown) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(String(value)).getTime()) / 60_000));
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
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

function Count({ value, format = v => Math.round(v).toLocaleString() }: { value: number; format?: (value: number) => string }) {
  return <>{format(useCountUp(value))}</>;
}

function Metric({ icon: Icon, label, value, format, suffix = "", note, tone, index }: { icon: typeof School; label: string; value: number; format?: (v: number) => string; suffix?: string; note: string; tone: string; index: number }) {
  return <article className={`kiosk-card kiosk-metric kiosk-metric--${tone}`} style={{ ["--i" as string]: index }}>
    <span className="kiosk-metric__icon"><Icon/></span>
    <div><small>{label}</small><strong><Count value={value} format={format}/>{suffix}</strong><p>{note}</p></div>
  </article>;
}

function Panel({ index, kicker, title, icon: Icon, aside, className: extra = "", children }: { index: number; kicker: string; title: string; icon?: typeof School; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return <article className={`kiosk-card kiosk-panel ${extra}`} style={{ ["--i" as string]: index }}>
    <header className="kiosk-panel__head"><div><small>{kicker}</small><h2>{title}</h2></div>{aside ?? (Icon && <Icon/>)}</header>
    {children}
  </article>;
}

function FeeTrend({ days, currency }: { days: R[]; currency: string }) {
  const max = Math.max(1, ...days.map(day => n(day.amountMinor)));
  const peak = days.reduce((best, day) => n(day.amountMinor) > n(best?.amountMinor) ? day : best, days[0]);
  return <div className="kiosk-trend" role="img" aria-label="Fees collected per day over the last 14 days">
    <div className="kiosk-trend__grid"><i/><i/><i/></div>
    {days.map((day, index) => {
      const amount = n(day.amountMinor), isToday = index === days.length - 1, date = new Date(`${day.day}T00:00:00`);
      const label = isToday || (day === peak && amount > 0);
      return <div key={day.day} className={`kiosk-trend__col${isToday ? " is-today" : ""}`} title={`${date.toDateString()}: ${money(amount, currency)} · ${n(day.receiptCount)} receipts`}>
        {label && <span className="kiosk-trend__value">{money(amount, currency, true)}</span>}
        <em style={{ height: `${Math.max(amount ? 3 : 0, amount * 100 / max)}%`, ["--d" as string]: `${index * 45}ms` }}/>
        <small>{isToday ? "Today" : date.toLocaleDateString("en-UG", { weekday: "narrow" })}</small>
      </div>;
    })}
  </div>;
}

function Ring({ value }: { value: number }) {
  const radius = 52, circumference = 2 * Math.PI * radius, shown = Math.min(100, Math.max(0, value));
  return <svg className="kiosk-ring" viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r={radius} className="kiosk-ring__track"/>
    <circle cx="60" cy="60" r={radius} className="kiosk-ring__fill" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - shown / 100)}/>
  </svg>;
}

function AttendanceBar({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const rate = percent(value, total);
  return <div className={`kiosk-bar kiosk-bar--${tone}`}><div><span>{label}</span><b>{value.toLocaleString()} <small>{rate}%</small></b></div><i><em style={{ width: `${rate}%` }}/></i></div>;
}

function ClassBoard({ classes }: { classes: R[] }) {
  const max = Math.max(1, ...classes.map(row => n(row.capacity) || n(row.students)));
  return <div className="kiosk-classes" style={{ ["--rows" as string]: Math.max(1, Math.ceil(classes.length / 2)) }}>
    {classes.map((row, index) => {
      const marked = n(row.marked);
      return <div key={row.name} className="kiosk-class" style={{ ["--d" as string]: `${index * 60}ms` }}>
        <span>{className(row.name)}</span>
        <i><em style={{ width: `${n(row.students) * 100 / max}%` }}/></i>
        <b>{n(row.students)}</b>
        <small className={marked ? "" : "is-muted"}>{marked ? `${percent(row.present, marked)}% in` : "not marked"}</small>
      </div>;
    })}
    {!classes.length && <p className="kiosk-empty">No active classes configured.</p>}
  </div>;
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
  const [flash, setFlash] = useState<number | null>(null);
  const lastCollected = useRef<number | null>(null);

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
      const collected = n(data?.collections?.amountMinor);
      if (lastCollected.current !== null && collected > lastCollected.current) setFlash(collected - lastCollected.current);
      lastCollected.current = collected;
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

  useEffect(() => {
    if (flash === null) return;
    const timer = window.setTimeout(() => setFlash(null), 9_000);
    return () => clearTimeout(timer);
  }, [flash]);

  const currency = summary?.profile?.defaultCurrency || "UGX";
  const students = summary?.attendance?.students || {};
  const staff = summary?.attendance?.staff || {};
  const term = summary?.termFees || {};
  const services = summary?.services || {};
  const studentTotal = n(students.expected) || n(summary?.population?.activeStudents);
  const staffTotal = n(summary?.population?.activeStaff);
  const collectionRate = percent(term.collectedMinor, term.billedMinor);
  const outstanding = Math.max(0, n(term.billedMinor) - n(term.collectedMinor));
  const dateLabel = useMemo(() => now.toLocaleDateString("en-UG", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), [now.toDateString()]);
  const termProgress = useMemo(() => {
    const start = new Date(`${String(summary?.period?.termStartsOn ?? "").slice(0, 10)}T00:00:00`).getTime();
    const end = new Date(`${String(summary?.period?.termEndsOn ?? "").slice(0, 10)}T23:59:59`).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const done = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
    return { done: Math.round(done * 100), daysLeft: Math.max(0, Math.ceil((end - Date.now()) / 86_400_000)) };
  }, [summary?.period?.termStartsOn, summary?.period?.termEndsOn, dateLabel]);

  const slides = [
    { key: "payments", kicker: "Live feed", title: "Latest fee payments", icon: ReceiptText, body: <ul className="kiosk-feed">
      {(summary?.recentReceipts ?? []).map((row: R, index: number) => <li key={index} style={{ ["--d" as string]: `${index * 80}ms` }}>
        <span className="kiosk-feed__icon"><CircleDollarSign/></span><p><b>{money(row.amountMinor, currency)}</b><small>{className(row.className)}</small></p><time>{ago(row.createdAt)}</time>
      </li>)}
      {!summary?.recentReceipts?.length && <p className="kiosk-empty">No fee payments recorded yet.</p>}
    </ul> },
    { key: "pulse", kicker: "People & wellbeing", title: "Daily pulse", icon: HeartPulse, body: <ul className="kiosk-feed">
      <li><span className="kiosk-feed__icon"><UserCheck/></span><p><b>{n(staff.present)} staff present</b><small>{n(staff.late)} late · {n(staff.absent)} absent · {n(staff.other)} away</small></p></li>
      <li><span className="kiosk-feed__icon"><GraduationCap/></span><p><b>{n(summary?.admissions?.receivedToday)} applications today</b><small>{n(summary?.admissions?.open)} open admission applications</small></p></li>
      <li><span className="kiosk-feed__icon"><ShieldCheck/></span><p><b>{n(summary?.discipline?.meritsToday)} merits today</b><small>{n(summary?.discipline?.reportedToday)} behaviour records today</small></p></li>
      <li className={n(summary?.discipline?.critical) ? "is-alert" : ""}><span className="kiosk-feed__icon"><AlertTriangle/></span><p><b>{n(summary?.discipline?.critical)} critical safeguarding alerts</b><small>{n(summary?.discipline?.open)} open behaviour cases</small></p></li>
    </ul> },
    { key: "services", kicker: "Around school", title: "Services today", icon: BookOpen, body: <ul className="kiosk-feed">
      <li><span className="kiosk-feed__icon"><HeartPulse/></span><p><b>{n(services.clinicToday)} sick-bay visits</b><small>Recorded at the clinic today</small></p></li>
      <li><span className="kiosk-feed__icon"><BookOpen/></span><p><b>{n(services.libraryOut)} library books out</b><small>{n(services.libraryOverdue)} overdue</small></p></li>
      <li><span className="kiosk-feed__icon"><Clock3/></span><p><b>{n(services.homeworkDue)} homework tasks due</b><small>Across all classes today</small></p></li>
      <li><span className="kiosk-feed__icon"><Megaphone/></span><p><b>{(summary?.notices ?? []).length ? summary!.notices[0].title : "No notices posted"}</b><small>{(summary?.notices ?? []).length ? `${summary!.notices.length} active parent notice${summary!.notices.length === 1 ? "" : "s"}` : "Parent portal notice board"}</small></p></li>
    </ul> },
  ];

  return <main className="school-kiosk">
    <header className="kiosk-header">
      <div className="kiosk-brand"><span><School/></span><div><small>Ledgerly school operations</small><h1>{summary?.profile?.schoolName || "School dashboard"}</h1><p>{summary?.profile?.motto || [summary?.period?.academicYear, summary?.period?.term].filter(Boolean).join(" · ") || "Daily command centre"}</p></div></div>
      <div className="kiosk-clock"><strong>{now.toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" })}<sup>{String(now.getSeconds()).padStart(2, "0")}</sup></strong><span><CalendarDays/> {dateLabel}</span></div>
      <div className="kiosk-actions"><button title="Refresh dashboard" onClick={() => void load()}><RefreshCw className={loading ? "spin" : ""}/></button><button title="Enter full screen" onClick={() => void document.documentElement.requestFullscreen?.()}><Maximize/></button></div>
    </header>

    {error && <div className="kiosk-alert"><AlertTriangle/><span><b>Live data is temporarily unavailable.</b><small>{error} · The dashboard will retry automatically.</small></span></div>}
    {flash !== null && <div className="kiosk-toast"><CircleDollarSign/><span><small>New payment received</small><b>+{money(flash, currency)}</b></span></div>}

    <section className="kiosk-metrics">
      <Metric index={0} icon={GraduationCap} tone="blue" label="Active students" value={n(summary?.population?.activeStudents)} note={`in ${(summary?.classes ?? []).length} classes`}/>
      <Metric index={1} icon={UserCheck} tone="good" label="Students present" value={percent(students.present, studentTotal)} suffix="%" note={`${n(students.present).toLocaleString()} present · ${n(students.late).toLocaleString()} late`}/>
      <Metric index={2} icon={Users} tone="violet" label="Staff present" value={percent(staff.present, staffTotal)} suffix="%" note={`${n(staff.present).toLocaleString()} of ${staffTotal.toLocaleString()} staff`}/>
      <Metric index={3} icon={CircleDollarSign} tone="orange" label="Collected today" value={n(summary?.collections?.amountMinor)} format={v => money(v, currency)} note={`${n(summary?.collections?.receiptCount).toLocaleString()} receipt${n(summary?.collections?.receiptCount) === 1 ? "" : "s"}`}/>
      <Metric index={4} icon={TrendingUp} tone="aqua" label="Last 7 days" value={n(term.weekMinor)} format={v => money(v, currency, true)} note={`${n(term.payingStudents).toLocaleString()} payers this term`}/>
    </section>

    <section className="kiosk-grid">
      <Panel index={5} className="kiosk-panel--trend" kicker="Fee collections" title="Last 14 days" icon={TrendingUp}>
        <FeeTrend days={summary?.feeTrend ?? []} currency={currency}/>
      </Panel>

      <Panel index={6} className="kiosk-panel--term" kicker={summary?.period?.academicYear || "Academic calendar"} title={`${summary?.period?.term || "Term"} fees`} icon={CalendarDays}>
        <div className="kiosk-term">
          <div className="kiosk-term__ring"><Ring value={collectionRate}/><strong><Count value={collectionRate}/>%</strong><small>collected</small></div>
          <dl>
            <div><dt>Billed</dt><dd>{money(term.billedMinor, currency, true)}</dd></div>
            <div><dt>Collected</dt><dd>{money(term.collectedMinor, currency, true)}</dd></div>
            <div><dt>Outstanding</dt><dd>{money(outstanding, currency, true)}</dd></div>
          </dl>
        </div>
        <div className="kiosk-termline">
          <div><span>{termDate(summary?.period?.termStartsOn)}</span><b>{termProgress ? `${termProgress.daysLeft} days left` : "Term dates not set"}</b><span>{termDate(summary?.period?.termEndsOn)}</span></div>
          <i><em style={{ width: `${termProgress?.done ?? 0}%` }}/></i>
        </div>
      </Panel>

      <Panel index={7} className="kiosk-panel--classes" kicker="Enrollment" title="Learners by class" icon={GraduationCap}>
        <ClassBoard classes={summary?.classes ?? []}/>
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

    <footer><span className={error ? "offline" : "online"}/><b>{error ? "Reconnecting" : "Live"}</b><span>Updates every minute</span><span>Last update {summary?.generatedAt ? new Date(summary.generatedAt).toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</span><span className="kiosk-footer__brand">Powered by Ledgerly</span></footer>
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

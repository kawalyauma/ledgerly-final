import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CircleDollarSign, Clock3, GraduationCap, HeartHandshake, Maximize, RefreshCw, School, ShieldCheck, UserCheck, Users } from "lucide-react";
import { errorText, get } from "../../../web/api";
import "./school-kiosk.css";

type R = Record<string, any>;

const n = (value: unknown) => Number(value || 0);
const percent = (part: unknown, total: unknown) => n(total) ? Math.round(n(part) * 100 / n(total)) : 0;
const words = (value: unknown) => String(value ?? "").replaceAll("_", " ");

function money(value: unknown, currency = "UGX") {
  return new Intl.NumberFormat("en-UG", { style: "currency", currency, maximumFractionDigits: currency === "UGX" ? 0 : 2 }).format(n(value) / 100);
}

function Metric({ icon: Icon, label, value, note, tone = "green" }: { icon: typeof School; label: string; value: string | number; note: string; tone?: string }) {
  return <article className={`kiosk-metric kiosk-metric--${tone}`}>
    <span className="kiosk-metric__icon"><Icon/></span>
    <div><small>{label}</small><strong>{value}</strong><p>{note}</p></div>
  </article>;
}

function AttendanceBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const rate = percent(value, total);
  return <div className="kiosk-bar"><div><span>{label}</span><b>{value.toLocaleString()} <small>{rate}%</small></b></div><i><em style={{ width: `${rate}%`, background: color }}/></i></div>;
}

export function SchoolKioskPage() {
  const [summary, setSummary] = useState<R | null>(null);
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try { setSummary(await get<R>("/school/kiosk/summary")); setError(""); }
    catch (reason) { setError(errorText(reason)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => void load(), 60_000);
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    return () => { clearInterval(refresh); clearInterval(clock); };
  }, [load]);

  const currency = summary?.profile?.defaultCurrency || "UGX";
  const students = summary?.attendance?.students || {};
  const staff = summary?.attendance?.staff || {};
  const studentTotal = n(students.expected) || n(summary?.population?.activeStudents);
  const staffTotal = n(summary?.population?.activeStaff);
  const dateLabel = useMemo(() => now.toLocaleDateString("en-UG", { weekday: "long", day: "numeric", month: "long", year: "numeric" }), [now]);

  return <main className="school-kiosk">
    <header className="kiosk-header">
      <div className="kiosk-brand"><span><School/></span><div><small>Ledgerly school operations</small><h1>{summary?.profile?.schoolName || "School dashboard"}</h1><p>{summary?.profile?.motto || [summary?.period?.academicYear, summary?.period?.term].filter(Boolean).join(" · ") || "Daily command centre"}</p></div></div>
      <div className="kiosk-clock"><strong>{now.toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit" })}</strong><span><CalendarDays/> {dateLabel}</span></div>
      <div className="kiosk-actions"><button title="Refresh dashboard" onClick={() => void load()}><RefreshCw className={loading ? "spin" : ""}/></button><button title="Enter full screen" onClick={() => void document.documentElement.requestFullscreen?.()}><Maximize/></button></div>
    </header>

    {error && <div className="kiosk-alert"><AlertTriangle/><span><b>Live data is temporarily unavailable.</b><small>{error} · The dashboard will retry automatically.</small></span></div>}

    <section className="kiosk-metrics">
      <Metric icon={GraduationCap} label="Active students" value={n(summary?.population?.activeStudents).toLocaleString()} note={`${n(students.marked).toLocaleString()} attendance marks today`}/>
      <Metric icon={UserCheck} label="Students present" value={`${percent(students.present, studentTotal)}%`} note={`${n(students.present).toLocaleString()} present · ${n(students.late).toLocaleString()} late`} tone="blue"/>
      <Metric icon={Users} label="Staff present" value={`${percent(staff.present, staffTotal)}%`} note={`${n(staff.present).toLocaleString()} of ${staffTotal.toLocaleString()} staff`} tone="violet"/>
      <Metric icon={CircleDollarSign} label="Collected today" value={money(summary?.collections?.amountMinor, currency)} note={`${n(summary?.collections?.receiptCount).toLocaleString()} receipt${n(summary?.collections?.receiptCount) === 1 ? "" : "s"}`} tone="gold"/>
    </section>

    <section className="kiosk-grid">
      <article className="kiosk-panel kiosk-panel--attendance">
        <div className="kiosk-panel__head"><div><small>Today’s attendance</small><h2>Student roll call</h2></div><span className="kiosk-pill"><Clock3/> {n(students.sessions)} registers</span></div>
        <div className="kiosk-attendance-hero"><strong>{percent(students.present, studentTotal)}%</strong><span>present today<small>{n(students.marked).toLocaleString()} of {studentTotal.toLocaleString()} expected learners marked</small></span></div>
        <div className="kiosk-bars">
          <AttendanceBar label="Present" value={n(students.present)} total={studentTotal} color="#22c55e"/>
          <AttendanceBar label="Absent" value={n(students.absent)} total={studentTotal} color="#ef4444"/>
          <AttendanceBar label="Late" value={n(students.late)} total={studentTotal} color="#f59e0b"/>
          <AttendanceBar label="Excused / sick" value={n(students.excused)} total={studentTotal} color="#38bdf8"/>
        </div>
      </article>

      <article className="kiosk-panel">
        <div className="kiosk-panel__head"><div><small>People & wellbeing</small><h2>Daily pulse</h2></div><HeartHandshake/></div>
        <div className="kiosk-pulse-list">
          <div><span className="green"><UserCheck/></span><p><b>{n(staff.present)} staff present</b><small>{n(staff.late)} late · {n(staff.absent)} absent · {n(staff.other)} away</small></p></div>
          <div><span className="blue"><GraduationCap/></span><p><b>{n(summary?.admissions?.receivedToday)} applications today</b><small>{n(summary?.admissions?.open)} open admission applications</small></p></div>
          <div><span className="gold"><ShieldCheck/></span><p><b>{n(summary?.discipline?.meritsToday)} merits today</b><small>{n(summary?.discipline?.reportedToday)} behaviour records reported today</small></p></div>
          <div><span className={n(summary?.discipline?.critical) ? "red" : "green"}><AlertTriangle/></span><p><b>{n(summary?.discipline?.critical)} critical safeguarding alerts</b><small>{n(summary?.discipline?.open)} open behaviour cases</small></p></div>
        </div>
      </article>

      <article className="kiosk-panel kiosk-panel--period">
        <div className="kiosk-panel__head"><div><small>Academic calendar</small><h2>{summary?.period?.term || "Current term not set"}</h2></div><CalendarDays/></div>
        <p className="kiosk-year">{summary?.period?.academicYear || "Academic year not configured"}</p>
        <div className="kiosk-term-dates"><span><small>Term opens</small><b>{summary?.period?.termStartsOn ? new Date(`${summary.period.termStartsOn}T00:00:00`).toLocaleDateString("en-UG", { day: "numeric", month: "short" }) : "—"}</b></span><i/><span><small>Term closes</small><b>{summary?.period?.termEndsOn ? new Date(`${summary.period.termEndsOn}T00:00:00`).toLocaleDateString("en-UG", { day: "numeric", month: "short" }) : "—"}</b></span></div>
      </article>
    </section>

    <footer><span className={error ? "offline" : "online"}/><b>{error ? "Reconnecting" : "Live"}</b><span>Updates every minute</span><span>Last update {summary?.generatedAt ? new Date(summary.generatedAt).toLocaleTimeString("en-UG", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}</span><span>{words(summary?.period?.term)}</span></footer>
  </main>;
}

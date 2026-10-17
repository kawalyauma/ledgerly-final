import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CheckCheck, Clock3, FileSpreadsheet, History, LockKeyhole, LogIn, LogOut, Printer, RefreshCw, Save, UnlockKeyhole } from "lucide-react";
import { can, errorText, get, post, put } from "../../../web/api";
import { useAuth } from "../../../web/auth";
import { useHashView } from "../../../web/navigation";
import { Badge, Button, Card, Field, Modal, Notice, Pagination, Spinner } from "../../../web/components/ui";
import { downloadTableCsv, printReportElement } from "../../../web/reporting";

type R = Record<string, any>;
type Tab = "students" | "staff" | "reports";
const base = "/school/attendance";
const pageSize = 25;
const studentStatuses = ["present", "absent", "late", "excused", "sick", "permission"];
const staffStatuses = ["present", "absent", "late", "on_leave", "sick", "official_duty", "remote", "half_day"];
const localDate = () => { const d = new Date(), off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); };
const firstOfMonth = () => `${localDate().slice(0, 8)}01`;
const fullName = (r: R) => [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ");
const words = (v: unknown) => String(v ?? "—").replaceAll("_", " ");
const pct = (v: unknown) => v == null ? "—" : `${Number(v).toFixed(1)}%`;
const percent = (attended: number, counted: number) => counted > 0 ? attended / counted * 100 : null;
// The server stores check-in/clock times as timestamps; the forms work in local HH:MM on the working date.
const toHM = (v: unknown) => { if (!v) return ""; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const atTime = (date: string, hm: string | undefined) => hm ? new Date(`${date}T${hm}:00`).toISOString() : null;
const nowHM = () => toHM(new Date().toISOString());
const qs = (obj: R) => { const p = new URLSearchParams(); Object.entries(obj).forEach(([k, v]) => { if (v !== "" && v != null) p.set(k, String(v)); }); const s = p.toString(); return s ? `?${s}` : ""; };

function StatusBadge({ value }: { value: unknown }) {
  const v = String(value || "unmarked");
  const good = ["present", "completed"].includes(v);
  const warn = ["late", "excused", "permission", "on_leave", "half_day", "open", "remote", "official_duty"].includes(v);
  const bad = ["absent", "sick", "cancelled"].includes(v);
  return <Badge tone={good ? "success" : bad ? "danger" : warn ? "warning" : "neutral"}>{words(v)}</Badge>;
}

function SummaryCards({ items }: { items: Array<[string, unknown, string?]> }) {
  return <div className="metric-grid">{items.map(([label, value, hint]) => <Card key={label} className="metric-card"><small>{label}</small><strong>{String(value ?? 0)}</strong>{hint && <span>{hint}</span>}</Card>)}</div>;
}

function useRefs() {
  const [data, setData] = useState<R>({ years: [], terms: [], classes: [], streams: [], subjects: [], departments: [], branches: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  // Each list loads on its own, so one the server lacks leaves that list empty instead of breaking the page.
  useEffect(() => { void (async () => {
    setLoading(true);
    const lists: Array<[string, string]> = [["years", "academicYears?limit=500"], ["terms", "terms?limit=500"], ["classes", "classes?limit=500"], ["streams", "streams?limit=1000"], ["subjects", "subjects?limit=500"], ["departments", "departments?limit=500"], ["branches", "branches?limit=500"]];
    const got = await Promise.all(lists.map(([key, path]) => get<R[]>(`/school/setup/${path}`).then(rows => [key, rows, null] as const, (e: unknown) => [key, [], e] as const)));
    setData(Object.fromEntries(got.map(([key, rows]) => [key, rows])));
    const classesFailed = got.find(([key]) => key === "classes")?.[2];
    if (classesFailed) setError(errorText(classesFailed));
    setLoading(false);
  })(); }, []);
  return { ...data, loading, error };
}

export function AttendanceWorkspace() {
  // Tabs follow the address (#attendance/students, /staff, /reports) so the sidebar can link straight to them.
  const [tab, setTab] = useHashView<Tab>("attendance", "students", ["students", "staff", "reports"]), [day, setDay] = useState(localDate()), [overview, setOverview] = useState<R>({ students: {}, staff: {} });
  const loadOverview = async () => { try { setOverview(await get<R>(`${base}/overview?date=${day}`)); } catch { /* individual panels show actionable errors */ } };
  useEffect(() => { void loadOverview(); }, [day]);
  return <>
    <div className="school-page-head"><div><span className="eyebrow">School management</span><h1>Attendance</h1><p>Daily and lesson registers for learners, staff timekeeping and attendance reports.</p></div><div className="heading-actions"><Field label="Working date"><input type="date" value={day} onChange={e => setDay(e.target.value)} /></Field><Button variant="secondary" onClick={() => void loadOverview()}><RefreshCw size={15}/> Refresh</Button></div></div>
    <SummaryCards items={[["Student sessions", overview.students?.sessions || 0, `${overview.students?.marked || 0}/${overview.students?.expected || 0} marked`],["Students present", overview.students?.present || 0, `${overview.students?.late || 0} late`],["Student absences", overview.students?.absent || 0, `${overview.students?.excused || 0} excused/sick`],["Staff marked", overview.staff?.total || 0, `${overview.staff?.late || 0} late`],["Staff absent", overview.staff?.absent || 0, `${overview.staff?.other || 0} leave/duty/other`]]}/>
    <div className="school-subtabs"><button className={tab === "students" ? "active" : ""} onClick={() => setTab("students")}><CalendarCheck size={15}/> Student attendance</button><button className={tab === "staff" ? "active" : ""} onClick={() => setTab("staff")}><Clock3 size={15}/> Staff attendance</button><button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}><FileSpreadsheet size={15}/> Reports</button></div>
    {tab === "students" && <StudentAttendancePanel day={day} onChanged={loadOverview}/>} {tab === "staff" && <StaffAttendancePanel day={day} onChanged={loadOverview}/>} {tab === "reports" && <AttendanceReports defaultTo={day}/>} 
  </>;
}

function StudentAttendancePanel({ day, onChanged }: { day: string; onChanged: () => Promise<void> }) {
  const { principal } = useAuth(), refs = useRefs(), [classId, setClassId] = useState(""), [streamId, setStreamId] = useState(""), [sessionType, setSessionType] = useState("daily"), [subjectId, setSubjectId] = useState(""), [startTime, setStartTime] = useState(""), [endTime, setEndTime] = useState(""), [session, setSession] = useState<R | null>(null), [rows, setRows] = useState<R[]>([]), [page, setPage] = useState(1), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState(""), [history, setHistory] = useState<R | null>(null);
  const canWrite = can(principal, "school:write") || can(principal, "school.attendance.student:write"), canManage = can(principal, "school:write") || can(principal, "school.attendance:manage");
  const streams = refs.streams.filter((x: R) => !classId || x.classId === classId), pages = Math.max(1, Math.ceil(rows.length / pageSize)), visible = rows.slice((page - 1) * pageSize, page * pageSize);
  const counts = useMemo(() => { const c: R = { unmarked: 0 }; for (const r of rows) { const s = r.attendance?.status || "unmarked"; c[s] = (c[s] || 0) + 1; } return c; }, [rows]);
  useEffect(() => { setSession(null); setRows([]); setPage(1); }, [day, classId, streamId, sessionType, subjectId, startTime, endTime]);
  // The register lists the enrolled learners as `roster`, each with its saved record (checkInAt/notes) or null.
  const loadSession = async (id: string) => { const x = await get<R>(`${base}/student/sessions/${id}`); setSession(x); setRows((x.roster || []).map((r: R) => ({ ...r, attendance: r.attendance ? { ...r.attendance, arrivalTime: toHM(r.attendance.checkInAt), reason: r.attendance.notes || "" } : null }))); setPage(1); };
  const openRegister = async () => { if (!classId) { setError("Select a class first."); return; } if (sessionType === "period" && !subjectId) { setError("Select the lesson's subject."); return; } setLoading(true); setError(""); setMessage(""); try { const x = await post<R>(`${base}/student/sessions`, { attendanceDate: day, sessionType, classId, streamId: streamId || null, subjectId: sessionType === "period" ? subjectId || null : null, startsAt: sessionType === "period" ? atTime(day, startTime) : null, endsAt: sessionType === "period" ? atTime(day, endTime) : null }); await loadSession(x.id); } catch (e) { setError(errorText(e)); } finally { setLoading(false); } };
  const changeRow = (studentId: string, patch: R) => setRows(xs => xs.map(r => r.id === studentId ? { ...r, attendance: { ...(r.attendance || {}), ...patch } } : r));
  const markAll = (status: string) => setRows(xs => xs.map(r => ({ ...r, attendance: { ...(r.attendance || {}), status, minutesLate: status === "late" ? Number(r.attendance?.minutesLate || 0) : 0 } })));
  // Saving keeps the register open; completing saves and closes it (reopen to change it again).
  const save = async (complete = false) => { if (!session) return; const marked = rows.filter(r => r.attendance?.status); if (!marked.length) { setError("Mark at least one learner before saving."); return; } if (complete && marked.length < rows.length) { setError(`Mark every learner before completing the register: ${rows.length - marked.length} still unmarked.`); return; } setSaving(true); setError(""); setMessage(""); try { await put(`${base}/student/sessions/${session.id}/records`, { complete, records: marked.map(r => ({ studentId: r.id, status: r.attendance.status, checkInAt: atTime(session.attendanceDate || day, r.attendance.arrivalTime), minutesLate: Number(r.attendance.minutesLate || 0), notes: r.attendance.reason || null })) }); await loadSession(session.id); setMessage(complete ? "Register completed." : "Attendance register saved."); await onChanged(); } catch (e) { setError(errorText(e)); } finally { setSaving(false); } };
  const reopen = async () => { if (!session) return; setError(""); try { await post(`${base}/student/sessions/${session.id}/reopen`, {}); await loadSession(session.id); setMessage("Register reopened."); await onChanged(); } catch (e) { setError(errorText(e)); } };
  const showHistory = async (r: R) => { try { const x = await get<R>(`${base}/student/report${qs({ studentId: r.id })}`); setHistory({ student: r, byStatus: x.byStatus || [] }); } catch (e) { setError(errorText(e)); } };
  const closed = session?.status === "completed" || session?.status === "cancelled";
  return <Card className="school-panel"><div className="school-panel-head"><div><h2>Student register</h2><p>Open one register per class/stream and date. Use daily registers for promotion attendance percentages; period registers can track lesson presence.</p></div>{session && <StatusBadge value={session.status}/>}</div>
    {refs.error && <Notice tone="danger">{refs.error}</Notice>} {error && <Notice tone="danger">{error}</Notice>} {message && <Notice tone="success">{message}</Notice>}
    <div className="form-grid"><Field label="Class"><select value={classId} onChange={e => { setClassId(e.target.value); setStreamId(""); }}><option value="">Select class…</option>{refs.classes.map((x: R) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Stream"><select value={streamId} onChange={e => setStreamId(e.target.value)} disabled={!classId}><option value="">Whole class</option>{streams.map((x: R) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Register type"><select value={sessionType} onChange={e => setSessionType(e.target.value)}><option value="daily">Daily attendance</option><option value="period">Lesson / period</option><option value="assembly">Assembly</option><option value="event">School event</option><option value="other">Other</option></select></Field>{sessionType === "period" && <><Field label="Subject"><select value={subjectId} onChange={e => setSubjectId(e.target.value)}><option value="">Select subject…</option>{refs.subjects.map((x: R) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Lesson starts"><input type="time" value={startTime} onChange={e => setStartTime(e.target.value)}/></Field><Field label="Lesson ends"><input type="time" value={endTime} onChange={e => setEndTime(e.target.value)}/></Field></>}</div>
    <div className="heading-actions"><Button disabled={loading || refs.loading || !classId} onClick={() => void openRegister()}><CalendarCheck size={15}/>{loading ? "Opening…" : session ? "Reload register" : "Open register"}</Button>{session && canWrite && !closed && <><Button variant="secondary" onClick={() => markAll("present")}><CheckCheck size={15}/> Mark all present</Button><Button variant="secondary" disabled={saving} onClick={() => void save()}><Save size={15}/>{saving ? "Saving…" : "Save"}</Button><Button disabled={saving} onClick={() => void save(true)}><LockKeyhole size={15}/> Complete register</Button></>}{session?.status === "completed" && canManage && <Button variant="secondary" onClick={() => void reopen()}><UnlockKeyhole size={15}/> Reopen</Button>}</div>
    {session && <><SummaryCards items={[["Expected", rows.length],["Present", counts.present || 0],["Late", counts.late || 0],["Absent", counts.absent || 0],["Excused / sick", (counts.excused || 0) + (counts.sick || 0) + (counts.permission || 0)],["Unmarked", counts.unmarked || 0]]}/>
      <div className="table-wrap"><table><thead><tr><th>Learner</th><th>Status</th><th>Arrival</th><th>Late mins</th><th>Reason / remarks</th><th></th></tr></thead><tbody>{visible.map(r => <tr key={r.id}><td><b>{fullName(r)}</b><small>{r.admissionNumber} · {r.streamName || "No stream"}</small></td><td>{canWrite && !closed ? <select value={r.attendance?.status || ""} onChange={e => changeRow(r.id, { status: e.target.value || undefined })}><option value="">Unmarked</option>{studentStatuses.map(x => <option key={x} value={x}>{words(x)}</option>)}</select> : <StatusBadge value={r.attendance?.status}/>}</td><td><input type="time" disabled={!canWrite || closed} value={r.attendance?.arrivalTime || ""} onChange={e => changeRow(r.id, { arrivalTime: e.target.value })}/></td><td><input type="number" min="0" disabled={!canWrite || closed} value={r.attendance?.minutesLate || 0} onChange={e => changeRow(r.id, { minutesLate: Number(e.target.value) })}/></td><td><input disabled={!canWrite || closed} value={r.attendance?.reason || ""} onChange={e => changeRow(r.id, { reason: e.target.value })} placeholder="Reason if absent/late/excused"/></td><td><button className="fees-inline-link" onClick={() => void showHistory(r)}><History size={13}/> History</button></td></tr>)}</tbody></table></div>{pages > 1 && <Pagination page={page} pages={pages} onChange={setPage}/>}</>}
    {!session && <p className="school-muted">Choose a class and open the register to load the enrolled learners.</p>}
    {history && <StudentTotalsModal title={`${fullName(history.student)} · attendance to date`} byStatus={history.byStatus} onClose={() => setHistory(null)}/>}
  </Card>;
}

function StaffAttendancePanel({ day, onChanged }: { day: string; onChanged: () => Promise<void> }) {
  const { principal } = useAuth(), refs = useRefs(), [departmentId, setDepartmentId] = useState(""), [campusId, setCampusId] = useState(""), [rows, setRows] = useState<R[]>([]), [page, setPage] = useState(1), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const canWrite = can(principal, "school:write") || can(principal, "school.attendance.staff:write"), isToday = day === localDate();
  // One row per active staff member, merged with that day's saved record (status, clock in/out, worked minutes, notes).
  const load = async () => { setLoading(true); setError(""); try {
    const [staff, records] = await Promise.all([get<R[]>(`/school/staff-management/staff${qs({ limit: 500, departmentId })}`), get<R[]>(`${base}/staff${qs({ date: day })}`)]);
    const byStaff = new Map(records.map(x => [x.staffId, x]));
    setRows(staff.filter(x => (!campusId || x.campusId === campusId) && !["terminated", "resigned", "retired", "inactive"].includes(String(x.employmentStatus || "").toLowerCase())).map(x => {
      const rec = byStaff.get(x.id);
      return { staffId: x.id, firstName: x.firstName, middleName: x.middleName, lastName: x.lastName, staffNumber: x.staffNumber, positionName: x.positionName, departmentName: x.departmentName,
        attendanceId: rec?.id ?? null, status: rec?.status ?? "", clockIn: toHM(rec?.clockInAt), clockOut: toHM(rec?.clockOutAt), workedMinutes: Number(rec?.workedMinutes || 0), reason: rec?.notes ?? "" };
    })); setPage(1);
  } catch (e) { setError(errorText(e)); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [day, departmentId, campusId]);
  const change = (staffId: string, patch: R) => setRows(xs => xs.map(r => r.staffId === staffId ? { ...r, ...patch } : r));
  const markAll = () => setRows(xs => xs.map(r => ({ ...r, status: r.status || "present" })));
  const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const worked = (r: R) => r.clockIn && r.clockOut ? Math.max(0, minutesOf(r.clockOut) - minutesOf(r.clockIn)) : Number(r.workedMinutes || 0);
  const payload = (r: R) => ({ staffId: r.staffId, attendanceDate: day, status: r.status, clockInAt: atTime(day, r.clockIn), clockOutAt: atTime(day, r.clockOut), workedMinutes: worked(r), notes: r.reason || null, source: "manual" });
  const save = async () => { const marked = rows.filter(r => r.status); if (!marked.length) { setError("Mark at least one staff member before saving."); return; } setSaving(true); setError(""); setMessage(""); try { await put(`${base}/staff`, marked.map(payload)); setMessage("Staff attendance saved."); await load(); await onChanged(); } catch (e) { setError(errorText(e)); } finally { setSaving(false); } };
  // Clocking saves that one person straight away with the current time.
  const clock = async (r: R, which: "in" | "out") => { const next = { ...r, status: r.status || "present", ...(which === "in" ? { clockIn: nowHM() } : { clockOut: nowHM() }) }; setError(""); try { await put(`${base}/staff`, [payload(next)]); await load(); await onChanged(); } catch (e) { setError(errorText(e)); } };
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)), visible = rows.slice((page - 1) * pageSize, page * pageSize), counts = rows.reduce((a: R, r) => { const s = r.status || "unmarked"; a[s] = (a[s] || 0) + 1; return a; }, {});
  return <Card className="school-panel"><div className="school-panel-head"><div><h2>Staff attendance & timekeeping</h2><p>Mark each staff member's status for the day, or clock them in and out; worked time is calculated from the clock times.</p></div></div>{error && <Notice tone="danger">{error}</Notice>}{message && <Notice tone="success">{message}</Notice>}
    <div className="form-grid"><Field label="Department"><select value={departmentId} onChange={e => setDepartmentId(e.target.value)}><option value="">All departments</option>{refs.departments.map((x: R) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Campus"><select value={campusId} onChange={e => setCampusId(e.target.value)}><option value="">All campuses</option>{refs.branches.map((x: R) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field></div>
    <div className="heading-actions"><Button variant="secondary" onClick={() => void load()}><RefreshCw size={15}/> Refresh</Button>{canWrite && <><Button variant="secondary" onClick={markAll}><CheckCheck size={15}/> Mark unmarked present</Button><Button disabled={saving} onClick={() => void save()}><Save size={15}/>{saving ? "Saving…" : "Save attendance"}</Button></>}</div>
    <SummaryCards items={[["Staff", rows.length],["Present", counts.present || 0],["Late", counts.late || 0],["Absent", counts.absent || 0],["Leave / sick", (counts.on_leave || 0) + (counts.sick || 0)],["Unmarked", counts.unmarked || 0]]}/>
    {loading ? <Spinner/> : <><div className="table-wrap"><table><thead><tr><th>Staff member</th><th>Status</th><th>Clock in</th><th>Clock out</th><th>Worked</th><th>Reason / notes</th></tr></thead><tbody>{visible.map(r => { const w = worked(r); return <tr key={r.staffId}><td><b>{fullName(r)}</b><small>{r.staffNumber} · {r.positionName || "Staff"}{r.departmentName ? ` · ${r.departmentName}` : ""}</small></td><td>{canWrite ? <select value={r.status || ""} onChange={e => change(r.staffId, { status: e.target.value })}><option value="">Unmarked</option>{staffStatuses.map(x => <option key={x} value={x}>{words(x)}</option>)}</select> : <StatusBadge value={r.status}/>}</td><td>{canWrite ? <input type="time" value={r.clockIn} onChange={e => change(r.staffId, { clockIn: e.target.value })}/> : <b>{r.clockIn || "—"}</b>}{isToday && canWrite && !r.clockIn && <button className="fees-inline-link" onClick={() => void clock(r, "in")}><LogIn size={12}/> Clock in now</button>}</td><td>{canWrite ? <input type="time" value={r.clockOut} onChange={e => change(r.staffId, { clockOut: e.target.value })}/> : <b>{r.clockOut || "—"}</b>}{isToday && canWrite && r.clockIn && !r.clockOut && <button className="fees-inline-link" onClick={() => void clock(r, "out")}><LogOut size={12}/> Clock out now</button>}</td><td><b>{Math.floor(w / 60)}h {w % 60}m</b></td><td><input disabled={!canWrite} value={r.reason || ""} onChange={e => change(r.staffId, { reason: e.target.value })} placeholder="Leave/absence reason"/></td></tr>; })}</tbody></table></div>{pages > 1 && <Pagination page={page} pages={pages} onChange={setPage}/>}</>}
  </Card>;
}

function AttendanceReports({ defaultTo }: { defaultTo: string }) {
  const refs = useRefs(), [kind, setKind] = useState<"student" | "staff">("student"), [from, setFrom] = useState(firstOfMonth()), [to, setTo] = useState(defaultTo), [classId, setClassId] = useState(""), [streamId, setStreamId] = useState(""), [rows, setRows] = useState<R[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState(""), [page, setPage] = useState(1);
  const streams = refs.streams.filter((x: R) => !classId || x.classId === classId), load = async () => { if (kind === "student" && !classId) { setError("Choose a class for the student report."); return; } setLoading(true); setError(""); try {
    if (kind === "student") { const x = await get<R>(`${base}/student/class-report${qs({ from, to, classId, streamId })}`); setRows((x.students || []).map((r: R) => ({ ...r, attendancePercent: percent(Number(r.present || 0) + Number(r.late || 0), Number(r.marked || 0) - Number(r.excused || 0)) }))); }
    else { const x = await get<R>(`${base}/staff/report${qs({ from, to })}`); setRows((x.staff || []).map((r: R) => ({ ...r, attendancePercent: percent(Number(r.present || 0) + Number(r.late || 0), Number(r.marked || 0)) }))); }
    setPage(1); } catch (e) { setError(errorText(e)); } finally { setLoading(false); } };
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)), visible = rows.slice((page - 1) * pageSize, page * pageSize), reportId = `attendance-${kind}-report`, title = kind === "student" ? "Student attendance report" : "Staff attendance report";
  return <Card className="school-panel"><div className="school-panel-head"><div><h2>Attendance reports</h2><p>Attendance percentages, absences, lateness and worked time across any date range, per class or for all staff.</p></div><div className="heading-actions">{rows.length > 0 && <><Button variant="secondary" onClick={() => downloadTableCsv(reportId, title)}><FileSpreadsheet size={15}/> Export CSV</Button><Button variant="secondary" onClick={() => printReportElement(reportId, title, `${from} to ${to}`)}><Printer size={15}/> Print</Button></>}</div></div>
    <div className="school-subtabs"><button className={kind === "student" ? "active" : ""} onClick={() => { setKind("student"); setRows([]); }}>Student report</button><button className={kind === "staff" ? "active" : ""} onClick={() => { setKind("staff"); setRows([]); }}>Staff report</button></div>
    <div className="form-grid"><Field label="From"><input type="date" value={from} onChange={e => setFrom(e.target.value)}/></Field><Field label="To"><input type="date" value={to} onChange={e => setTo(e.target.value)}/></Field>{kind === "student" ? <><Field label="Class"><select value={classId} onChange={e => { setClassId(e.target.value); setStreamId(""); }}><option value="">Choose a class…</option>{refs.classes.map((x: R) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field><Field label="Stream"><select value={streamId} onChange={e => setStreamId(e.target.value)}><option value="">All streams</option>{streams.map((x: R) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field></> : null}</div>
    <div className="heading-actions"><Button disabled={loading} onClick={() => void load()}>{loading ? "Loading…" : "Generate report"}</Button></div>{error && <Notice tone="danger">{error}</Notice>}
    <div id={reportId}>{loading ? <Spinner/> : rows.length ? <div className="table-wrap"><table><thead><tr>{kind === "student" ? <><th>Learner</th><th>Registers marked</th><th>Present</th><th>Late</th><th>Absent</th><th>Excused / sick</th><th>Attendance %</th></> : <><th>Staff member</th><th>Days marked</th><th>Present</th><th>Late</th><th>Absent</th><th>Leave</th><th>Worked</th><th>Attendance %</th></>}</tr></thead><tbody>{visible.map(r => kind === "student" ? <tr key={r.studentId}><td><b>{r.studentName}</b><small>{r.admissionNumber || r.studentNumber}</small></td><td>{r.marked}</td><td>{r.present}</td><td>{r.late}</td><td>{r.absent}</td><td>{r.excused}</td><td><b>{pct(r.attendancePercent)}</b></td></tr> : <tr key={r.staffId}><td><b>{r.staffName}</b><small>{r.staffNumber}</small></td><td>{r.marked}</td><td>{r.present}</td><td>{r.late}</td><td>{r.absent}</td><td>{r.onLeave}</td><td>{Math.round(Number(r.workedMinutes || 0) / 60)}h</td><td><b>{pct(r.attendancePercent)}</b></td></tr>)}</tbody></table></div> : <p className="school-muted">Generate a report to see attendance data.</p>}</div>{pages > 1 && <Pagination page={page} pages={pages} onChange={setPage}/>}<p className="school-muted">Student percentage counts present + late as attended and excludes excused/permission sessions from the denominator. Staff percentage counts present and late days out of the days marked.</p>
  </Card>;
}

function StudentTotalsModal({ title, byStatus, onClose }: { title: string; byStatus: R[]; onClose: () => void }) {
  const n = (k: string) => Number(byStatus.find(x => x.status === k)?.count || 0), total = byStatus.reduce((a, x) => a + Number(x.count || 0), 0);
  const excused = n("excused") + n("sick") + n("permission"), rate = percent(n("present") + n("late"), total - excused);
  return <Modal title={title} onClose={onClose}><div className="modal-body"><SummaryCards items={[["Registers marked", total],["Present", n("present")],["Late", n("late")],["Absent", n("absent")],["Excused / sick", excused],["Attendance", pct(rate)]]}/>{!total && <p className="school-muted">No attendance has been recorded for this learner yet.</p>}</div><div className="modal-actions"><Button onClick={onClose}>Close</Button></div></Modal>;
}

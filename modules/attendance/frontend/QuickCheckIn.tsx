import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock3, CloudUpload, RefreshCw, RotateCcw, Search, UserCheck, X } from "lucide-react";
import { ApiError, can, errorText, get, post, put } from "../../../web/api";
import { useAuth } from "../../../web/auth";
import { Badge, Button, Card, Notice, Spinner } from "../../../web/components/ui";
import "./quick-checkin.css";

/*
 * Quick check-in: type a learner's name, pick them, and they are marked in today's daily register of their class.
 * Registers are found or created on the fly (one whole-class daily register per class and day on the server,
 * /api/v1/school/attendance), so nobody has to open a register first.
 */

type R = Record<string, any>;
type Learner = { id: string; name: string; admissionNumber: string; studentNumber: string; classId: string | null; className: string; streamName: string; words: string[]; codes: string[] };
type Mark = { studentId: string; status: string; at: string | null };
/** A mark kept in this browser until the server has it (survives refreshes, closed tabs and lost connections). */
type Pending = { studentId: string; classId: string; className: string; name: string; day: string; status: string; checkInAt: string | null; minutesLate: number; tries: number; next: number; error?: string };

const base = "/school/attendance";
const STATUSES = ["present", "late", "absent", "excused", "sick", "permission"];
const LATE_KEY = "ledgerly.checkin.lateAfter";
const OUTBOX_KEY = (org: string) => `ledgerly.checkin.outbox.${org}`;
const LEARNERS_KEY = (org: string) => `ledgerly.checkin.learners.${org}`;
const readJson = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const writeJson = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked: the mark still syncs from memory */ } };
const pendingKey = (x: { day: string; studentId: string }) => `${x.day}|${x.studentId}`;
const localDate = () => { const d = new Date(), off = d.getTimezoneOffset(); return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10); };
const hm = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const fold = (v: unknown) => String(v ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const words = (v: unknown) => String(v ?? "—").replaceAll("_", " ");

/** Edit distance with an early exit once it exceeds `max` (names are short, so this stays cheap). */
function within(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]!);
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[b.length]! <= max;
}

/** How well one typed word matches a learner: names in any order, prefixes, admission numbers, class, small typos. */
function tokenScore(t: string, l: Learner) {
  let best = 0;
  for (const w of l.words) {
    if (w === t) best = Math.max(best, 100);
    else if (w.startsWith(t)) best = Math.max(best, 70 + Math.min(20, t.length * 4));
    else if (t.length >= 3 && w.includes(t)) best = Math.max(best, 45);
    else if (t.length >= 4 && within(t, w.slice(0, Math.max(t.length, w.length)), t.length >= 7 ? 2 : 1)) best = Math.max(best, 35);
    else if (t.length >= 4 && within(t, w.slice(0, t.length), 1)) best = Math.max(best, 30);
  }
  for (const c of l.codes) {
    if (c === t) best = Math.max(best, 120);
    else if (c.startsWith(t) || c.endsWith(t)) best = Math.max(best, t.length >= 3 ? 90 : 40);
  }
  if (fold(l.className).replace(/ /g, "") === t) best = Math.max(best, 25);
  return best;
}

function rank(query: string, learners: Learner[], limit = 8) {
  const tokens = fold(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const scored: Array<[number, Learner]> = [];
  for (const l of learners) {
    let total = 0;
    for (const t of tokens) { const s = tokenScore(t, l); if (!s) { total = -1; break; } total += s; }
    if (total > 0) scored.push([total, l]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit).map(x => x[1]);
}

/** Splits a name so the typed prefixes can be shown in bold. */
function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = fold(query).split(" ").filter(Boolean);
  return <>{text.split(/(\s+)/).map((part, i) => {
    const f = fold(part), t = tokens.find(x => f.startsWith(x));
    return t ? <span key={i}><b>{part.slice(0, t.length)}</b>{part.slice(t.length)}</span> : <span key={i}>{part}</span>;
  })}</>;
}

type StoredLearner = Pick<Learner, "id" | "name" | "admissionNumber" | "studentNumber" | "classId" | "className" | "streamName">;
function toLearner(s: StoredLearner): Learner {
  return { ...s, words: fold(s.name).split(" ").filter(Boolean), codes: [s.admissionNumber, s.studentNumber].map(fold).map(c => c.replace(/ /g, "")).filter(Boolean) };
}

async function allActiveLearners(): Promise<Learner[]> {
  const rows: R[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const page = await get<R[]>(`/school/student-management/students?status=active&limit=500&offset=${offset}`);
    rows.push(...page);
    if (page.length < 500) break;
  }
  return rows.map(s => {
    const name = [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
    return { id: s.id, name, admissionNumber: s.admissionNumber || "", studentNumber: s.studentNumber || "", classId: s.currentClassId || null, className: s.className || "", streamName: s.streamName || "",
      words: fold(name).split(" ").filter(Boolean), codes: [s.admissionNumber, s.studentNumber].map(fold).map(c => c.replace(/ /g, "")).filter(Boolean) };
  });
}

export function QuickCheckInPage() {
  const { principal } = useAuth();
  return principal?.organizationId ? <OrganizationCheckIn key={principal.organizationId} org={principal.organizationId}/> : null;
}

function OrganizationCheckIn({ org }: { org: string }) {
  const { principal } = useAuth();
  const canWrite = can(principal, "school:write") || can(principal, "school.attendance.student:write");
  const [learners, setLearners] = useState<Learner[]>(() => readJson<StoredLearner[]>(LEARNERS_KEY(org), []).map(toLearner));
  const [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [serverMarks, setServerMarks] = useState<Map<string, Mark>>(new Map());
  const [query, setQuery] = useState(""), [active, setActive] = useState(0), [flash, setFlash] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [lateAfter, setLateAfter] = useState(() => { try { return localStorage.getItem(LATE_KEY) || ""; } catch { return ""; } });
  const [recent, setRecent] = useState<string[]>([]), [, setTick] = useState(0), [offline, setOffline] = useState(false);
  const outbox = useRef(new Map<string, Pending>(readJson<Pending[]>(OUTBOX_KEY(org), []).map(x => [pendingKey(x), x])));
  const sessions = useRef(new Map<string, R>()), syncing = useRef(false), input = useRef<HTMLInputElement>(null);
  const day = localDate();
  const byId = useMemo(() => new Map(learners.map(l => [l.id, l])), [learners]);
  const suggestions = useMemo(() => rank(query, learners), [query, learners]);
  const persist = () => { writeJson(OUTBOX_KEY(org), [...outbox.current.values()]); setTick(t => t + 1); };

  // What the screen shows: the server's marks for today, with anything still in the local queue on top.
  const pendingToday = [...outbox.current.values()].filter(x => x.day === day);
  const marks = new Map<string, Mark>(serverMarks);
  for (const x of pendingToday) marks.set(x.studentId, { studentId: x.studentId, status: x.status, at: x.checkInAt });
  const pendingAll = [...outbox.current.values()];
  const waiting = pendingAll.filter(x => !x.error).length, failedAll = pendingAll.filter(x => x.error);
  const failed = pendingToday.filter(x => x.error);

  // Today's daily whole-class registers and who is already in them.
  const loadToday = async () => {
    const list = await get<R[]>(`${base}/student/sessions?date=${day}`);
    const daily = list.filter(s => (s.sessionType ?? s.session_type) === "daily" && !(s.streamId ?? s.stream_id) && s.status !== "cancelled");
    const details = await Promise.all(daily.map(s => get<R>(`${base}/student/sessions/${s.id}`)));
    const next = new Map<string, Mark>();
    for (const d of details) {
      sessions.current.set(`${day}|${d.classId}`, { id: d.id, status: d.status, classId: d.classId });
      for (const r of d.roster || []) if (r.attendance?.status) next.set(r.id, { studentId: r.id, status: r.attendance.status, at: r.attendance.checkInAt || null });
    }
    setServerMarks(next);
  };
  const load = async () => {
    setLoading(true); setLoadError("");
    try {
      const [all] = await Promise.all([allActiveLearners(), loadToday()]);
      setLearners(all);
      writeJson(LEARNERS_KEY(org), all.map(({ words: _w, codes: _c, ...l }) => l));
    } catch (e) { setLoadError(errorText(e)); }
    finally { setLoading(false); setTimeout(() => input.current?.focus(), 0); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { try { lateAfter ? localStorage.setItem(LATE_KEY, lateAfter) : localStorage.removeItem(LATE_KEY); } catch { /* per-device preference only */ } }, [lateAfter]);

  /** The class's daily register for that day: the one already open, or a new one. */
  const registerFor = async (classId: string, onDay: string) => {
    const key = `${onDay}|${classId}`, cached = sessions.current.get(key);
    if (cached) return cached;
    const find = async () => (await get<R[]>(`${base}/student/sessions?date=${onDay}&classId=${encodeURIComponent(classId)}`))
      .find(s => (s.sessionType ?? s.session_type) === "daily" && !(s.streamId ?? s.stream_id) && s.status !== "cancelled");
    let found = await find();
    if (!found) {
      try { const created = await post<R>(`${base}/student/sessions`, { attendanceDate: onDay, sessionType: "daily", classId, streamId: null }); found = { id: created.id, status: "open" }; }
      catch (e) { if (e instanceof ApiError && e.code === "ATTENDANCE_SESSION_EXISTS") found = await find(); else throw e; }
    }
    if (!found) throw new Error("Could not open the register for this class.");
    const session = { id: found.id, status: found.status, classId };
    sessions.current.set(key, session);
    return session;
  };

  /** Sends queued marks in the background, one request per class register; keeps them locally until the server has them. */
  const sync = async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      for (let round = 0; round < 20; round++) {
        const now = Date.now(), due = [...outbox.current.values()].filter(x => !x.error && x.next <= now);
        if (!due.length) break;
        const groups = new Map<string, Pending[]>();
        for (const x of due) groups.set(`${x.day}|${x.classId}`, [...(groups.get(`${x.day}|${x.classId}`) ?? []), x]);
        // Each class register saves on its own, in parallel, so one slow class does not hold up the others.
        await Promise.all([...groups.values()].map(async items => {
          const batch = items.slice(0, 200), first = batch[0]!;
          const fail = (xs: Pending[], error: string) => { for (const x of xs) if (outbox.current.get(pendingKey(x)) === x) x.error = error; };
          try {
            const session = await registerFor(first.classId, first.day);
            if (session.status === "completed") { fail(batch, `${first.className}'s register for ${first.day} is completed. Reopen it in Student attendance, then retry.`); return; }
            await put(`${base}/student/sessions/${session.id}/records`, { complete: false, records: batch.map(x => ({ studentId: x.studentId, status: x.status, checkInAt: x.checkInAt, minutesLate: x.minutesLate, notes: null })) });
            for (const x of batch) {
              if (outbox.current.get(pendingKey(x)) !== x) continue; // changed again while sending: the newer mark goes next
              outbox.current.delete(pendingKey(x));
              if (x.day === localDate()) setServerMarks(m => new Map(m).set(x.studentId, { studentId: x.studentId, status: x.status, at: x.checkInAt }));
            }
            setOffline(false);
          } catch (e) {
            if (e instanceof ApiError && e.code === "STUDENT_NOT_IN_ROSTER") {
              const bad = String((e.details as R | undefined)?.studentId ?? ""), who = batch.find(x => x.studentId === bad);
              if (who) { fail([who], `Not enrolled in ${who.className} for this academic year, so the register can't include them. Check their enrolment in Students.`); return; }
            }
            if (e instanceof ApiError && e.code === "SESSION_COMPLETED") { sessions.current.set(`${first.day}|${first.classId}`, { id: "", status: "completed", classId: first.classId }); fail(batch, `${first.className}'s register is completed. Reopen it in Student attendance, then retry.`); return; }
            if (e instanceof ApiError && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status)) { fail(batch, errorText(e)); return; }
            // No connection or a server hiccup: keep the marks and try again shortly (backing off up to a minute).
            for (const x of batch) { x.tries += 1; x.next = Date.now() + Math.min(60_000, 2000 * 2 ** Math.min(x.tries, 5)); }
            setOffline(true);
          } finally { persist(); }
        }));
      }
    } finally { syncing.current = false; }
  };
  useEffect(() => {
    void sync();
    const t = setInterval(() => void sync(), 2000), online = () => { for (const x of outbox.current.values()) x.next = 0; void sync(); };
    addEventListener("online", online);
    return () => { clearInterval(t); removeEventListener("online", online); };
  }, []);
  // Marks are already safe in this browser, but say so if someone closes the tab before they reach the server.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (outbox.current.size) { e.preventDefault(); e.returnValue = ""; } };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, []);

  const statusNow = () => {
    if (!lateAfter) return { status: "present", minutesLate: 0 };
    const now = new Date(), [h, m] = lateAfter.split(":").map(Number), cutoff = new Date(now); cutoff.setHours(h || 0, m || 0, 0, 0);
    const late = Math.floor((now.getTime() - cutoff.getTime()) / 60000);
    return late > 0 ? { status: "late", minutesLate: late } : { status: "present", minutesLate: 0 };
  };

  /** Marks the learner on screen at once and queues the save; nothing waits for the server. */
  const record = (l: Learner, status?: string) => {
    if (!canWrite) { setFlash({ tone: "warning", text: "You can look up learners, but marking attendance needs the school:write permission." }); return; }
    if (!l.classId) { setFlash({ tone: "danger", text: `${l.name} has no current class, so there is no register to add them to. Set their class in Students first.` }); return; }
    const existing = marks.get(l.id);
    if (!status && existing) {
      setFlash({ tone: "success", text: `${l.name} is already in today (${words(existing.status)}${existing.at ? `, ${hm(existing.at)}` : ""}).` });
      setQuery(""); input.current?.focus(); return;
    }
    const auto = statusNow(), chosen = status ?? auto.status, arrived = chosen === "present" || chosen === "late";
    outbox.current.set(pendingKey({ day, studentId: l.id }), { studentId: l.id, classId: l.classId, className: l.className, name: l.name, day, status: chosen,
      checkInAt: arrived ? existing?.at ?? new Date().toISOString() : null, minutesLate: chosen === "late" ? (status ? 0 : auto.minutesLate) : 0, tries: 0, next: 0 });
    persist();
    setRecent(r => [l.id, ...r.filter(x => x !== l.id)].slice(0, 50));
    setFlash({ tone: "success", text: status ? `${l.name}: changed to ${words(chosen)}.` : `${l.name} · ${l.className} marked ${words(chosen)}${chosen === "late" ? ` (${auto.minutesLate} min)` : ""}.` });
    if (!status) { setQuery(""); input.current?.focus(); }
    void sync();
  };
  const retry = (id: string) => { const x = outbox.current.get(pendingKey({ day, studentId: id })); if (x) { sessions.current.delete(`${x.day}|${x.classId}`); delete x.error; x.tries = 0; x.next = 0; persist(); void sync(); } };
  const discard = (id: string) => { outbox.current.delete(pendingKey({ day, studentId: id })); persist(); };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, Math.max(0, suggestions.length - 1))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const l = suggestions[active]; if (l) record(l); }
    else if (e.key === "Escape") { setQuery(""); }
  };

  const counts: R = {}; for (const m of marks.values()) counts[m.status] = (counts[m.status] || 0) + 1;
  const recentList = (recent.length ? [...recent, ...failed.map(x => x.studentId).filter(id => !recent.includes(id))] : [...failed.map(x => x.studentId), ...[...marks.values()].sort((a, b) => String(b.at).localeCompare(String(a.at))).map(m => m.studentId)]).slice(0, 40);
  const startingUp = loading && !learners.length;

  return <div className="qc-page">
    <div className="school-page-head"><div><span className="eyebrow">Attendance</span><h1>Quick check-in</h1><p>Type a learner's name and pick them. They are marked at once and saved in the background to today's register for their class; registers open themselves.</p></div>
      <div className="heading-actions">
        <span className={`qc-sync${failedAll.length ? " qc-sync--bad" : waiting ? " qc-sync--busy" : ""}`} role="status">{failedAll.length ? <><AlertTriangle size={15}/> {failedAll.length} not saved</> : waiting ? <><CloudUpload size={15}/> {offline ? `Offline · ${waiting} waiting` : `Saving ${waiting}…`}</> : <><CheckCircle2 size={15}/> All saved</>}</span>
        <label className="qc-late"><Clock3 size={15}/> Late after <input type="time" value={lateAfter} onChange={e => setLateAfter(e.target.value)} aria-label="Mark learners late after this time"/></label>
        <Button variant="secondary" onClick={() => void load()}><RefreshCw size={15}/> Refresh</Button></div></div>

    {failedAll.filter(x => x.day !== day).map(x => <Notice key={pendingKey(x)} tone="danger">
      {x.name} ({x.day}): {x.error}
      <Button variant="ghost" onClick={() => { sessions.current.delete(`${x.day}|${x.classId}`); delete x.error; x.tries = 0; x.next = 0; persist(); void sync(); }}>Retry</Button>
    </Notice>)}

    <Card className="qc-card">
      <div className={`qc-search${query ? " has-query" : ""}`}>
        <Search size={22}/>
        <input ref={input} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onKey} placeholder={startingUp ? "Loading learners…" : "Start typing a learner's name or admission number"} disabled={startingUp}
          role="combobox" aria-expanded={suggestions.length > 0} aria-controls="qc-suggestions" aria-activedescendant={suggestions[active] ? `qc-opt-${suggestions[active]!.id}` : undefined} aria-label="Learner name" autoComplete="off" spellCheck={false}/>
      </div>
      {query && <ul className="qc-suggestions" id="qc-suggestions" role="listbox">
        {suggestions.map((l, i) => { const m = marks.get(l.id); return <li key={l.id} id={`qc-opt-${l.id}`} role="option" aria-selected={i === active} className={i === active ? "active" : ""} onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); record(l); }}>
          <span className="qc-avatar">{l.name.split(" ").map(w => w[0]).slice(0, 2).join("")}</span>
          <span className="qc-who"><b><Highlight text={l.name} query={query}/></b><small>{[l.admissionNumber, l.className, l.streamName].filter(Boolean).join(" · ") || "No class"}</small></span>
          {m ? <Badge tone={m.status === "present" ? "success" : m.status === "late" ? "warning" : "neutral"}>In · {words(m.status)}{m.at ? ` ${hm(m.at)}` : ""}</Badge> : <span className="qc-enter">{i === active ? "Enter ↵" : ""}</span>}
        </li>; })}
        {!suggestions.length && <li className="qc-none">No learner matches “{query}”. Try fewer letters, another name, or the admission number.</li>}
      </ul>}
      {flash && <Notice tone={flash.tone}>{flash.text}</Notice>}
      {loadError && <Notice tone={learners.length ? "warning" : "danger"}>{learners.length ? `Using the saved learner list: ${loadError}` : loadError}</Notice>}
      {!canWrite && <Notice tone="warning">You can search, but marking attendance needs the school:write permission.</Notice>}
      {startingUp ? <Spinner label="Loading learners"/> : <p className="qc-hint">{learners.length} active learners{loading ? " (refreshing…)" : ""} · ↑ ↓ to choose · Enter to mark · Esc to clear</p>}
    </Card>

    <div className="qc-stats">
      <div><b>{marks.size}</b><span>checked in today</span></div>
      <div><b>{counts.present || 0}</b><span>present</span></div>
      <div><b>{counts.late || 0}</b><span>late</span></div>
      <div><b>{(counts.absent || 0) + (counts.excused || 0) + (counts.sick || 0) + (counts.permission || 0)}</b><span>absent / excused</span></div>
    </div>

    <Card className="qc-card">
      <div className="school-panel-head"><div><h2><UserCheck size={18}/> Today, {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</h2><p>Latest first. Change a status here if a learner was marked by mistake.</p></div></div>
      {recentList.length ? <ul className="qc-recent">{recentList.map(id => { const l = byId.get(id), m = marks.get(id), q = outbox.current.get(pendingKey({ day, studentId: id })); if (!l || !m) return null; return <li key={id} className={q?.error ? "qc-failed" : ""}>
        {q?.error ? <AlertTriangle size={16} className="qc-tick qc-tick--absent"/> : <CheckCircle2 size={16} className={`qc-tick qc-tick--${m.status}${q ? " qc-tick--pending" : ""}`}/>}
        <span className="qc-who"><b>{l.name}</b><small>{[l.className, l.streamName].filter(Boolean).join(" · ")}{m.at ? ` · ${hm(m.at)}` : ""}{q && !q.error ? " · saving…" : ""}</small>{q?.error && <small className="qc-error">{q.error}</small>}</span>
        {q?.error ? <span className="qc-row-actions"><Button variant="ghost" onClick={() => retry(id)}><RotateCcw size={14}/> Retry</Button><Button variant="ghost" onClick={() => discard(id)}><X size={14}/> Remove</Button></span>
          : canWrite ? <select value={m.status} onChange={e => record(l, e.target.value)} aria-label={`Status for ${l.name}`}>{STATUSES.map(s => <option key={s} value={s}>{words(s)}</option>)}</select> : <Badge>{words(m.status)}</Badge>}
      </li>; })}</ul> : <p className="school-muted">Nobody has been checked in yet today.</p>}
    </Card>
  </div>;
}

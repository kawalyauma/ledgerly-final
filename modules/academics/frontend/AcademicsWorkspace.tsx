import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  BarChart3,
  BookMarked,
  BookOpenCheck,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Clock3,
  Eye,
  FileText,
  GraduationCap,
  Plus,
  Printer,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Upload,
  Users,
} from "lucide-react";
import {
  ApiError,
  errorText,
  get,
  post,
  uploadFile,
} from "../../../web/api";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Modal,
  Notice,
  Spinner,
} from "../../../web/components/ui";
import * as XLSX from "xlsx";
import { LearningCycleWorkspace } from "./LearningCycleWorkspace";

const base = "/academics";
type R = Record<string, any>;
type Setup = {
  years: R[];
  terms: R[];
  classes: R[];
  streams: R[];
  subjects: R[];
  teachers: R[];
  teacherAllocations: R[];
};
const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const words = (v: any) =>
  String(v ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
const val = (f: FormData, k: string) => String(f.get(k) || "").trim();
function useLoad<T>(path: string, initial: T) {
  const [data, setData] = useState(initial),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setData(await get<T>(path));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [path]);
  return { data, setData, loading, error, load };
}
function Head({
  title,
  text,
  actions,
}: {
  title: string;
  text: string;
  actions?: ReactNode;
}) {
  return (
    <div className="acad-head">
      <div>
        <small>ACADEMICS</small>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {actions && <div className="acad-head-actions">{actions}</div>}
    </div>
  );
}
function Status({ value }: { value: any }) {
  const v = String(value || "draft"),
    tone =
      v.includes("approved") ||
      ["published", "taught", "covered", "closed", "resolved"].includes(v)
        ? "success"
        : v.includes("rejected") || v === "missing" || v === "failed"
          ? "danger"
          : v.includes("submitted") || v === "follow_up_due" || v === "partial"
            ? "warning"
            : "neutral";
  return <Badge tone={tone as any}>{words(v)}</Badge>;
}
function Select({
  name,
  items,
  labelKey = "name",
  valueKey = "id",
  required = false,
  value,
  defaultValue = "",
  onChange,
}: {
  name: string;
  items: R[];
  labelKey?: string;
  valueKey?: string;
  required?: boolean;
  value?: string;
  defaultValue?: string;
  onChange?: (v: string) => void;
}) {
  return (
    <select
      name={name}
      required={required}
      value={value}
      defaultValue={value === undefined ? defaultValue : undefined}
      onChange={(e) => onChange?.(e.target.value)}
    >
      <option value="">Select…</option>
      {items.map((x) => (
        <option key={x[valueKey]} value={x[valueKey]}>
          {x[labelKey]}
        </option>
      ))}
    </select>
  );
}
const currentYear = (setup: Setup) =>
  setup.years.find((x) => x.isCurrent)?.id || "";
function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: any;
  icon: any;
}) {
  return (
    <Card className="acad-metric">
      <span>
        <Icon size={19} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </Card>
  );
}
function BasicModal({
  title,
  children,
  close,
  onSubmit,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  onSubmit: (f: FormData) => Promise<void>;
  wide?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title={title} onClose={close} locked={busy}>
      <form
        className={`acad-modal-body ${wide ? "acad-wide" : ""}`}
        onSubmit={async (e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await onSubmit(new FormData(e.currentTarget));
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="acad-modal-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function useSetup() {
  return useLoad<Setup>(`${base}/setup`, {
    years: [],
    terms: [],
    classes: [],
    streams: [],
    subjects: [],
    teachers: [],
    teacherAllocations: [],
  });
}
function Evidence({
  entityType,
  entityId,
}: {
  entityType: "scheme_lesson_plan" | "scheme_lesson_delivery" | "observation" | "record_inspection";
  entityId: string;
}) {
  const [message, setMessage] = useState("");
  return (
    <Field label="Evidence attachment">
      <input
        type="file"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const up = await uploadFile<R>("/school/files", file, "academic-evidence");
            await post(`${base}/attachments`, {
              entityType,
              entityId,
              fileId: up.id,
              caption: file.name,
            });
            setMessage(`Attached ${file.name}`);
          } catch (err) {
            setMessage(errorText(err));
          }
        }}
      />
      {message && <small>{message}</small>}
    </Field>
  );
}

export function AcademicsWorkspace() {
  const [view, setView] = useState(
    () => sessionStorage.getItem("ledgerly.academics.view") || "dashboard",
  );
  const choose = (v: string) => {
    sessionStorage.setItem("ledgerly.academics.view", v);
    setView(v);
  };
  const items = [
    ["dashboard", "Dashboard", BarChart3],
    ["schemes", "Schemes & lessons", BookMarked],
    ["timetables", "Timetables", CalendarClock],
    ["supervision", "Supervision", UserCheck],
    ["imports", "Imports", Upload],
  ] as const;
  return (
    <div className="acad-shell">
      <aside className="acad-sidebar">
        <div className="acad-brand">
          <BookOpenCheck size={22} />
          <div>
            <b>Academics</b>
            <small>Teaching & supervision</small>
          </div>
        </div>
        <nav>
          {items.map(([k, l, I]) => (
            <button key={k} className={view === k ? "active" : ""} onClick={() => choose(k)}>
              <I size={17} />
              <span>{l}</span>
            </button>
          ))}
        </nav>
        <div className="acad-sidebar-foot">
          <small>Depends on</small>
          <b>School Management</b>
          <span>Exams remain separate</span>
        </div>
      </aside>
      <section className="acad-work">
        {view === "dashboard" ? (
          <Dashboard />
        ) : view === "schemes" ? (
          <LearningCycleWorkspace />
        ) : view === "timetables" ? (
          <Timetables />
        ) : view === "supervision" ? (
          <Supervision />
        ) : (
          <ImportsTab />
        )}
      </section>
    </div>
  );
}

function Dashboard() {
  const x = useLoad<R>(`${base}/dashboard`, {} as R);
  return (
    <div className="acad-page">
      <Head
        title="Academic dashboard"
        text="One workspace for teaching preparation, delivery, coverage, timetabling and supervision."
        actions={
          <Button variant="secondary" onClick={x.load}>
            <RefreshCw size={15} /> Refresh
          </Button>
        }
      />
      {x.loading ? (
        <Spinner />
      ) : (
        <>
          <div className="acad-metrics">
            <Metric label="Schemes" value={x.data.schemes || 0} icon={BookMarked} />
            <Metric label="Topics" value={x.data.topics || 0} icon={FileText} />
            <Metric label="Lessons" value={x.data.lessons || 0} icon={BookOpenCheck} />
            <Metric label="Lesson plans" value={x.data.plans || 0} icon={FileText} />
            <Metric label="Assessed lessons" value={x.data.assessed || 0} icon={ClipboardCheck} />
            <Metric label="Coverage" value={`${x.data.coveragePercent || 0}%`} icon={GraduationCap} />
            <Metric label="Timetables" value={x.data.timetables || 0} icon={CalendarClock} />
            <Metric label="Rooms" value={x.data.rooms || 0} icon={Building2} />
            <Metric label="Today's lessons" value={x.data.todaysLessons || 0} icon={Clock3} />
            <Metric label="Open observations" value={x.data.openObservations || 0} icon={Eye} />
            <Metric label="Open inspections" value={x.data.openInspections || 0} icon={ClipboardCheck} />
            <Metric label="Pending scheme approvals" value={x.data.pendingSchemeApprovals || 0} icon={ShieldCheck} />
            <Metric label="Pending plan approvals" value={x.data.pendingPlanApprovals || 0} icon={ShieldCheck} />
          </div>
          <div className="acad-grid-2">
            <Card>
              <h2>Academic control cycle</h2>
              <div className="acad-flow">
                <span>Scheme</span><i>→</i>
                <span>Topic</span><i>→</i>
                <span>Lesson</span><i>→</i>
                <span>Plan</span><i>→</i>
                <span>Delivery</span><i>→</i>
                <span>Marks</span>
              </div>
              <p>
                A scheme is the term's curriculum. Lesson plans are created against a scheme's topics, then
                delivered and assessed — coverage compares planned work against what was actually taught.
              </p>
            </Card>
            <Card>
              <h2>Supervision cycle</h2>
              <div className="acad-flow">
                <span>Observe</span><i>→</i>
                <span>Feedback</span><i>→</i>
                <span>Acknowledge</span><i>→</i>
                <span>Follow-up</span>
              </div>
              <p>
                HODs, DOS and school leaders review lesson preparation, classroom delivery and teacher
                academic records, with photographic evidence attached.
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Timetables() {
  const setup = useSetup(),
    rooms = useLoad<R[]>(`${base}/rooms`, []),
    schemes = useLoad<R[]>(`${base}/schemes`, []),
    t = useLoad<R[]>(`${base}/timetables`, []),
    [selected, setSelected] = useState(""),
    [entries, setEntries] = useState<R[]>([]),
    [workload, setWorkload] = useState<R[]>([]),
    [modal, setModal] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [conflicts, setConflicts] = useState<R[]>([]),
    [filter, setFilter] = useState({ type: "class", id: "" });
  const table = t.data.find((x) => x.id === selected);
  const loadEntries = async (id = selected) => {
    if (!id) {
      setEntries([]);
      setWorkload([]);
      return;
    }
    setEntries(await get<R[]>(`${base}/timetables/${id}/entries`));
    setWorkload(await get<R[]>(`${base}/timetables/${id}/workload`));
  };
  useEffect(() => {
    void loadEntries();
  }, [selected]);
  const filtered = entries.filter((e) =>
    !filter.id
      ? true
      : filter.type === "teacher"
        ? e.teacherStaffId === filter.id
        : e.classId === filter.id,
  );
  const workflow = async (action: string) => {
    await post(`${base}/timetables/${selected}/workflow`, { action });
    await t.load();
    setMessage(`${words(action)} completed.`);
  };
  return (
    <div className="acad-page">
      <Head
        title="Timetable management"
        text="Class and teacher timetables with rooms, teacher availability, conflict checking, curriculum linkage, approval workflow and workload."
        actions={
          <>
            <Button variant="secondary" onClick={() => setModal("room")}>
              <Building2 size={15} /> Rooms
            </Button>
            <Button variant="secondary" onClick={() => setModal("availability")}>
              <Users size={15} /> Availability
            </Button>
            <Button variant="secondary" onClick={() => setModal("allocations")}>
              <BookOpenCheck size={15} /> Teacher allocations
            </Button>
            <Button onClick={() => setModal("timetable")}>
              <Plus size={15} /> New timetable
            </Button>
          </>
        }
      />
      {message && <Notice tone="success">{message}</Notice>}
      <Card>
        <div className="acad-toolbar">
          <Field label="Timetable">
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select timetable…</option>
              {t.data.map((x) => (
                <option value={x.id} key={x.id}>
                  {x.name} · {x.termName} · {words(x.status)}
                </option>
              ))}
            </select>
          </Field>
          {table && (
            <>
              <Status value={table.status} />
              {table.status === "draft" && (
                <Button variant="secondary" onClick={() => workflow("submit")}>Submit</Button>
              )}
              {table.status === "submitted" && (
                <Button variant="secondary" onClick={() => workflow("approve")}>Approve</Button>
              )}
              {table.status === "approved" && (
                <Button onClick={() => workflow("publish")}>Publish</Button>
              )}
              <Button variant="secondary" onClick={() => printTimetable(filtered, table.name)}>
                <Printer size={15} /> Print
              </Button>
              <Button
                onClick={() => setModal("entry")}
                disabled={table.status === "published" || table.status === "archived"}
              >
                <Plus size={15} /> Add lesson
              </Button>
            </>
          )}
        </div>
      </Card>
      {selected && (
        <>
          <Card>
            <div className="acad-toolbar">
              <Field label="View">
                <select value={filter.type} onChange={(e) => setFilter({ type: e.target.value, id: "" })}>
                  <option value="class">Class timetable</option>
                  <option value="teacher">Teacher timetable</option>
                </select>
              </Field>
              <Field label={words(filter.type)}>
                <select value={filter.id} onChange={(e) => setFilter({ ...filter, id: e.target.value })}>
                  <option value="">All</option>
                  {(filter.type === "teacher" ? setup.data.teachers : setup.data.classes).map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              </Field>
            </div>
            <TimetableGrid entries={filtered} />
          </Card>
          <Card>
            <h2>Teacher workload analysis</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Teacher</th><th>Lessons</th><th>Weekly minutes</th></tr>
                </thead>
                <tbody>
                  {workload.map((x) => (
                    <tr key={x.teacherStaffId}>
                      <td>{x.teacherName}</td>
                      <td>{x.lessons}</td>
                      <td>{x.minutes}</td>
                    </tr>
                  ))}
                  {!workload.length && (
                    <tr><td colSpan={3}>No lessons scheduled yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      {modal === "timetable" && (
        <BasicModal
          title="New timetable"
          close={() => setModal(null)}
          onSubmit={async (f) => {
            const yearId = val(f, "year");
            await post(`${base}/timetables`, {
              academicYearId: yearId,
              termId: val(f, "term"),
              name: val(f, "name"),
            });
            setModal(null);
            await t.load();
          }}
        >
          <Field label="Academic year">
            <Select name="year" items={setup.data.years} defaultValue={currentYear(setup.data)} required />
          </Field>
          <Field label="Term">
            <Select name="term" items={setup.data.terms} required />
          </Field>
          <Field label="Name">
            <input name="name" required placeholder="Term 1 Master Timetable" />
          </Field>
        </BasicModal>
      )}
      {modal === "entry" && table && (
        <EntryModal
          setup={setup.data}
          rooms={rooms.data}
          schemes={schemes.data}
          yearId={table.academicYearId}
          conflicts={conflicts}
          close={() => {
            setModal(null);
            setConflicts([]);
          }}
          submit={async (d) => {
            try {
              await post(`${base}/timetables/${selected}/entries`, d);
              setModal(null);
              setConflicts([]);
              await loadEntries();
            } catch (e) {
              if (e instanceof ApiError && e.code === "TIMETABLE_CONFLICT") {
                setConflicts([{ message: e.message }]);
              } else throw e;
            }
          }}
        />
      )}
      {modal === "room" && (
        <RoomsModal rooms={rooms.data} close={() => { setModal(null); void rooms.load(); }} />
      )}
      {modal === "availability" && (
        <AvailabilityModal setup={setup.data} close={() => setModal(null)} />
      )}
      {modal === "allocations" && (
        <AllocationsModal setup={setup.data} close={() => setModal(null)} />
      )}
    </div>
  );
}
function TimetableGrid({ entries }: { entries: R[] }) {
  if (!entries.length)
    return <EmptyState title="No timetable lessons" description="Add lessons or change the selected view." />;
  return (
    <div className="table-wrap">
      <table className="acad-table">
        <thead>
          <tr>
            <th>Day</th><th>Time</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Room</th><th>Scheme</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{DAYS[Number(e.weekday) - 1]}</td>
              <td>{e.startsAt}–{e.endsAt}</td>
              <td>{e.className}{e.streamName ? ` · ${e.streamName}` : ""}</td>
              <td>{e.subjectName}</td>
              <td>{e.teacherName}</td>
              <td>{e.roomName || "—"}</td>
              <td>{e.schemeId ? <Badge tone="success">Linked</Badge> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function printTimetable(entries: R[], name: string) {
  const w = open("", "_blank", "width=1100,height=800");
  if (!w) return;
  w.document.write(
    `<html><head><title>${name}</title><style>body{font:13px Arial;padding:28px;color:#17212b}h1{margin:0 0 4px}p{color:#667085}table{border-collapse:collapse;width:100%;margin-top:18px}th,td{border:1px solid #cfd7df;padding:7px;text-align:left}th{background:#f2f5f7}@media print{button{display:none}}</style></head><body><h1>${name}</h1><p>Official academic timetable · Printed ${new Date().toLocaleString()}</p><table><thead><tr><th>Day</th><th>Time</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Room</th></tr></thead><tbody>${entries.map((e) => `<tr><td>${DAYS[e.weekday - 1]}</td><td>${e.startsAt}–${e.endsAt}</td><td>${e.className}</td><td>${e.subjectName}</td><td>${e.teacherName || ""}</td><td>${e.roomName || ""}</td></tr>`).join("")}</tbody></table><script>print()</script></body></html>`,
  );
  w.document.close();
}
function RoomsModal({ rooms, close }: { rooms: R[]; close: () => void }) {
  const [items, setItems] = useState(rooms);
  return (
    <Modal title="Rooms & learning spaces" onClose={close}>
      <div className="acad-modal-body">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Capacity</th></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}><td>{r.code}</td><td>{r.name}</td><td>{r.capacity || "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="acad-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const created = await post<R>(`${base}/rooms`, {
              code: val(f, "code"),
              name: val(f, "name"),
              capacity: Number(val(f, "capacity") || 0) || null,
            });
            e.currentTarget.reset();
            setItems((x) => [...x, created]);
          }}
        >
          <input name="code" placeholder="Code" required />
          <input name="name" placeholder="Room name" required />
          <input name="capacity" type="number" placeholder="Capacity" />
          <Button type="submit">Add</Button>
        </form>
      </div>
    </Modal>
  );
}
function AvailabilityModal({ setup, close }: { setup: Setup; close: () => void }) {
  const x = useLoad<R[]>(`${base}/teacher-availability`, []);
  return (
    <Modal title="Teacher availability" onClose={close}>
      <div className="acad-modal-body">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Teacher</th><th>Day</th><th>Time</th><th>State</th><th>Notes</th></tr></thead>
            <tbody>
              {x.data.map((a) => (
                <tr key={a.id}>
                  <td>{a.teacherName}</td>
                  <td>{DAYS[a.weekday - 1]}</td>
                  <td>{a.startsAt}–{a.endsAt}</td>
                  <td><Badge tone={a.available ? "success" : "danger"}>{a.available ? "Available" : "Unavailable"}</Badge></td>
                  <td>{a.notes || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="acad-inline-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            await post(`${base}/teacher-availability`, {
              teacherStaffId: val(f, "teacher"),
              weekday: Number(val(f, "day")),
              startsAt: val(f, "starts"),
              endsAt: val(f, "ends"),
              available: val(f, "state") === "available",
              notes: val(f, "notes"),
            });
            await x.load();
          }}
        >
          <Select name="teacher" items={setup.teachers} required />
          <select name="day">
            {DAYS.map((d, i) => (<option value={i + 1} key={d}>{d}</option>))}
          </select>
          <input type="time" name="starts" required />
          <input type="time" name="ends" required />
          <select name="state">
            <option value="unavailable">Unavailable</option>
            <option value="available">Available</option>
          </select>
          <input name="notes" placeholder="Notes" />
          <Button type="submit">Save</Button>
        </form>
      </div>
    </Modal>
  );
}
function AllocationsModal({ setup, close }: { setup: Setup; close: () => void }) {
  return (
    <Modal title="Teacher allocations" onClose={close}>
      <div className="acad-modal-body">
        <Notice tone="info">
          Allocations are managed in the Staff module so there is one source of truth for who teaches what.
        </Notice>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Class</th><th>Subject</th><th>Teacher</th></tr></thead>
            <tbody>
              {setup.teacherAllocations.map((a) => (
                <tr key={a.id}>
                  <td>{setup.classes.find((c) => c.id === a.classId)?.name || "—"}</td>
                  <td>{setup.subjects.find((s) => s.id === a.subjectId)?.name || "—"}</td>
                  <td>{setup.teachers.find((t) => t.id === a.teacherStaffId)?.name || "—"}</td>
                </tr>
              ))}
              {!setup.teacherAllocations.length && (
                <tr><td colSpan={3}>No allocations recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="acad-modal-actions">
          <Button variant="secondary" onClick={() => { location.hash = "school"; }}>
            Manage in Staff
          </Button>
          <Button onClick={close}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
function EntryModal({
  setup,
  rooms,
  schemes,
  yearId,
  conflicts,
  close,
  submit,
}: {
  setup: Setup;
  rooms: R[];
  schemes: R[];
  yearId: string;
  conflicts: R[];
  close: () => void;
  submit: (d: R) => Promise<void>;
}) {
  const [classId, setClassId] = useState(""),
    [streamId, setStreamId] = useState(""),
    [subjectId, setSubjectId] = useState(""),
    [teacherId, setTeacherId] = useState(""),
    [schemeId, setSchemeId] = useState(""),
    [topics, setTopics] = useState<R[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const classes = setup.classes.filter((x) => !yearId || x.academicYearId === yearId);
  const streams = setup.streams.filter((x) => x.classId === classId);
  const matchingSchemes = schemes.filter(
    (s) => s.classId === classId && s.subjectId === subjectId && (!streamId || !s.streamId || s.streamId === streamId),
  );
  useEffect(() => {
    const a = setup.teacherAllocations.find(
      (x) => x.classId === classId && x.subjectId === subjectId && (!x.streamId || x.streamId === streamId),
    );
    setTeacherId(a?.teacherStaffId || "");
  }, [classId, subjectId, streamId]);
  useEffect(() => {
    setSchemeId("");
    setTopics([]);
  }, [classId, streamId, subjectId]);
  useEffect(() => {
    if (!schemeId) { setTopics([]); return; }
    void get<R>(`${base}/schemes/${schemeId}`).then((d) => setTopics(d.topics || []));
  }, [schemeId]);
  return (
    <Modal title="Add timetable lesson" onClose={close} locked={busy}>
      <form
        className="acad-modal-body"
        onSubmit={async (e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await submit({
              classId,
              streamId: streamId || null,
              subjectId,
              teacherStaffId: teacherId,
              roomId: val(f, "room") || null,
              weekday: Number(val(f, "weekday")),
              startsAt: val(f, "starts"),
              endsAt: val(f, "ends"),
              schemeId: schemeId || null,
              defaultTopicId: val(f, "topic") || null,
            });
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="acad-form-grid">
          <Field label="Class">
            <select value={classId} required onChange={(e) => { setClassId(e.target.value); setStreamId(""); }}>
              <option value="">Select…</option>
              {classes.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
            </select>
          </Field>
          <Field label="Stream">
            <select value={streamId} onChange={(e) => setStreamId(e.target.value)}>
              <option value="">All streams</option>
              {streams.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
            </select>
          </Field>
          <Field label="Subject">
            <select value={subjectId} required onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Select…</option>
              {setup.subjects.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
            </select>
          </Field>
          <Field label="Teacher">
            <select value={teacherId} required onChange={(e) => setTeacherId(e.target.value)}>
              <option value="">{classId && subjectId ? "No allocation — select teacher" : "Select class and subject first"}</option>
              {setup.teachers.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
            </select>
          </Field>
          <Field label="Room">
            <select name="room" defaultValue="">
              <option value="">No room</option>
              {rooms.map((x) => (<option key={x.id} value={x.id}>{x.name}</option>))}
            </select>
          </Field>
          <Field label="Day">
            <select name="weekday" required>
              {DAYS.map((d, i) => (<option value={i + 1} key={d}>{d}</option>))}
            </select>
          </Field>
          <Field label="Start"><input name="starts" type="time" required /></Field>
          <Field label="End"><input name="ends" type="time" required /></Field>
          <Field label="Scheme (curriculum for this slot)">
            <select value={schemeId} onChange={(e) => setSchemeId(e.target.value)} disabled={!classId || !subjectId}>
              <option value="">{classId && subjectId ? "No linked scheme" : "Select class and subject first"}</option>
              {matchingSchemes.map((x) => (<option key={x.id} value={x.id}>{x.title}</option>))}
            </select>
          </Field>
          {schemeId && (
            <Field label="Default topic">
              <select name="topic" defaultValue="">
                <option value="">No default topic</option>
                {topics.map((x: R) => (<option key={x.id} value={x.id}>{x.title}</option>))}
              </select>
            </Field>
          )}
        </div>
        {conflicts.length > 0 && (
          <Notice tone="danger">
            <span>
              <b>Conflict detected:</b>
              {conflicts.map((x, i) => (<small key={i} className="acad-conflict">{x.message}</small>))}
            </span>
          </Notice>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="acad-modal-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Supervision() {
  const setup = useSetup(),
    observations = useLoad<R[]>(`${base}/supervision/observations`, []),
    inspections = useLoad<R[]>(`${base}/record-inspections`, []),
    [tab, setTab] = useState<"observations" | "inspections">("observations"),
    [modal, setModal] = useState<string | null>(null),
    [open, setOpen] = useState<R | null>(null);
  return (
    <div className="acad-page">
      <Head
        title="Supervision"
        text="Observe teaching, review teacher academic records, and track follow-up actions to close-out."
        actions={
          tab === "observations" ? (
            <Button onClick={() => setModal("observation")}><Plus size={15} /> Record observation</Button>
          ) : undefined
        }
      />
      <div className="acad-tabs">
        <button className={tab === "observations" ? "active" : ""} onClick={() => setTab("observations")}>
          Lesson observations
        </button>
        <button className={tab === "inspections" ? "active" : ""} onClick={() => setTab("inspections")}>
          Record inspections
        </button>
      </div>
      {tab === "observations" ? (
        <Card>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Teacher</th><th>Class</th><th>Observed on</th><th>Status</th><th /></tr></thead>
              <tbody>
                {observations.data.map((o) => (
                  <tr key={o.id}>
                    <td>{o.teacherName}</td>
                    <td>{setup.data.classes.find((c) => c.id === o.classId)?.name || "—"}</td>
                    <td>{o.observedOn}</td>
                    <td><Status value={o.status} /></td>
                    <td><button onClick={() => setOpen(o)}>Open</button></td>
                  </tr>
                ))}
                {!observations.data.length && (<tr><td colSpan={5}>No observations recorded yet.</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Teacher</th><th>Record</th><th>Status</th><th>Follow up</th></tr></thead>
              <tbody>
                {inspections.data.map((i) => (
                  <tr key={i.id}>
                    <td>{i.teacherName}</td>
                    <td>{i.recordTitle} · {words(i.recordType)}</td>
                    <td><Status value={i.status} /></td>
                    <td>{i.followUpOn || "—"}</td>
                  </tr>
                ))}
                {!inspections.data.length && (<tr><td colSpan={4}>No record inspections yet.</td></tr>)}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {modal === "observation" && (
        <BasicModal
          title="Record observation"
          close={() => setModal(null)}
          onSubmit={async (f) => {
            await post(`${base}/supervision/observations`, {
              teacherStaffId: val(f, "teacher"),
              classId: val(f, "class") || null,
              observedOn: val(f, "date"),
              observationType: "lesson_observation",
              preparationScore: Number(val(f, "prep") || 0) || null,
              deliveryScore: Number(val(f, "delivery") || 0) || null,
              strengths: val(f, "strengths"),
              improvementAreas: val(f, "improvements"),
            });
            setModal(null);
            await observations.load();
          }}
        >
          <div className="acad-form-grid">
            <Field label="Teacher"><Select name="teacher" items={setup.data.teachers} required /></Field>
            <Field label="Class"><Select name="class" items={setup.data.classes} /></Field>
            <Field label="Observed on"><input name="date" type="date" required /></Field>
            <Field label="Preparation (0–5)"><input name="prep" type="number" min="0" max="5" /></Field>
            <Field label="Delivery (0–5)"><input name="delivery" type="number" min="0" max="5" /></Field>
          </div>
          <Field label="Strengths"><textarea name="strengths" rows={2} /></Field>
          <Field label="Areas for improvement"><textarea name="improvements" rows={2} /></Field>
        </BasicModal>
      )}
      {open && (
        <Modal title={`Observation · ${open.teacherName}`} onClose={() => setOpen(null)}>
          <div className="acad-modal-body">
            <Status value={open.status} />
            <p><b>Strengths:</b> {open.strengths || "—"}</p>
            <p><b>Areas for improvement:</b> {open.improvementAreas || "—"}</p>
            <Evidence entityType="observation" entityId={open.id} />
            <div className="acad-modal-actions">
              {open.status === "open" && (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await post(`${base}/supervision/observations/${open.id}/acknowledge`, {});
                    setOpen(null);
                    await observations.load();
                  }}
                >
                  Acknowledge
                </Button>
              )}
              {(open.status === "acknowledged" || open.status === "follow_up_due") && (
                <Button
                  onClick={async () => {
                    await post(`${base}/supervision/observations/${open.id}/close`, {});
                    setOpen(null);
                    await observations.load();
                  }}
                >
                  Close
                </Button>
              )}
              <Button variant="secondary" onClick={() => setOpen(null)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}
function parseCsv(text: string, columns: string[]): R[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const looksLikeHeader = header.some((h) => columns.includes(h));
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;
  const useColumns = looksLikeHeader ? header : columns;
  return dataLines.map((line) => {
    const cells = parseCsvLine(line), row: R = {};
    useColumns.forEach((col, i) => { if (cells[i] !== undefined && cells[i] !== "") row[col] = cells[i]; });
    return row;
  });
}
function resolveByName(value: string, items: R[]): string {
  const match = items.find((x) => String(x.name).toLowerCase() === value.toLowerCase());
  return match ? match.id : value;
}
async function loadSchemeReference(schemeId: string, mode: "topics" | "lessons"): Promise<{ name: string; rows: R[] }[]> {
  const detail = await get<R>(`${base}/schemes/${schemeId}`);
  const topics: R[] = detail.topics ?? [];
  if (mode === "topics") {
    return [{ name: "Existing topics", rows: topics.map((t) => ({ Theme: t.theme || "", Topic: t.title, Lessons: t.lessons?.length ?? 0 })) }];
  }
  const rows: R[] = [];
  for (const t of topics) for (const l of t.lessons ?? []) rows.push({ Topic: t.title, Lesson: l.title, HasPlan: l.lessonPlanId ? "yes" : "no", Competencies: l.competencies?.length ?? 0 });
  return [{ name: "Existing lessons", rows }];
}

function ImportsTab() {
  const setup = useSetup();
  const schemes = useLoad<R[]>(`${base}/schemes`, []);
  return (
    <div className="acad-page">
      <Head
        title="Bulk imports"
        text="Bring in existing schemes, term topics/lessons, or already-written lesson plans in one paste instead of one form at a time."
      />
      <BulkImportCard
        title="Schemes"
        description="One row per scheme. Academic year / term / class / stream / subject / teacher can be an exact name (see the Reference sheet in the template) or an ID."
        columns={["academicYear", "term", "class", "stream", "subject", "teacher", "title"]}
        templateFileName="ledgerly-schemes-import-template.xlsx"
        templateExampleRow={{ academicYear: setup.data.years.find((y) => y.isCurrent)?.name || "2026", term: setup.data.terms[0]?.name || "Term 1", class: setup.data.classes[0]?.name || "P6", stream: "", subject: setup.data.subjects[0]?.name || "Mathematics", teacher: "", title: "" }}
        referenceSheets={[
          { name: "Academic Years", rows: setup.data.years.map((x) => ({ Name: x.name })) },
          { name: "Terms", rows: setup.data.terms.map((x) => ({ Name: x.name, AcademicYear: setup.data.years.find((y) => y.id === x.academicYearId)?.name || "" })) },
          { name: "Classes", rows: setup.data.classes.map((x) => ({ Name: x.name })) },
          { name: "Streams", rows: setup.data.streams.map((x) => ({ Name: x.name, Class: setup.data.classes.find((c) => c.id === x.classId)?.name || "" })) },
          { name: "Subjects", rows: setup.data.subjects.map((x) => ({ Name: x.name })) },
          { name: "Teachers", rows: setup.data.teachers.map((x) => ({ Name: x.name })) },
        ]}
        resolveRow={(row) => ({
          academicYearId: row.academicYear ? resolveByName(row.academicYear, setup.data.years) : undefined,
          termId: row.term ? resolveByName(row.term, setup.data.terms) : undefined,
          classId: row.class ? resolveByName(row.class, setup.data.classes) : undefined,
          streamId: row.stream ? resolveByName(row.stream, setup.data.streams) : undefined,
          subjectId: row.subject ? resolveByName(row.subject, setup.data.subjects) : undefined,
          teacherStaffId: row.teacher ? resolveByName(row.teacher, setup.data.teachers) : undefined,
          title: row.title,
        })}
        submit={async (rows) => {
          const result = await post<R>(`${base}/schemes/bulk-import`, { rows });
          await schemes.load();
          return { summary: `Created ${result.created} scheme${result.created === 1 ? "" : "s"}.`, errors: result.errors ?? [] };
        }}
      />
      <BulkImportCard
        title="Scheme items (topics & lessons)"
        description="One row per lesson. Rows are grouped into one topic per unique topicTitle, with each row becoming a lesson under it — a topic can have as many lesson rows as it needs (e.g. one per week/period, even under the same theme and sub-topic)."
        columns={["topicTitle", "theme", "weekFrom", "weekTo", "lessonTitle", "subtopic", "plannedDate", "durationMinutes", "learningOutcomes", "teachingMethods", "learningResources", "assessmentStrategy"]}
        templateFileName="ledgerly-scheme-items-import-template.xlsx"
        templateExampleRow={{ topicTitle: "The people of Africa", theme: "Living Together in Africa", weekFrom: 1, weekTo: 4, lessonTitle: "Ethnic groups in Africa", subtopic: "", plannedDate: "", durationMinutes: 40, learningOutcomes: "The learner identifies different ethnic groups in Africa", teachingMethods: "Story telling, discussion", learningResources: "Map of Africa", assessmentStrategy: "" }}
        needsScheme
        schemes={schemes.data}
        referenceLoader={(schemeId) => loadSchemeReference(schemeId, "topics")}
        resolveRow={(row) => ({
          ...row,
          weekFrom: row.weekFrom !== undefined && row.weekFrom !== "" ? Number(row.weekFrom) : undefined,
          weekTo: row.weekTo !== undefined && row.weekTo !== "" ? Number(row.weekTo) : undefined,
          durationMinutes: row.durationMinutes !== undefined && row.durationMinutes !== "" ? Number(row.durationMinutes) : undefined,
        })}
        submit={async (rows, schemeId) => {
          const result = await post<R>(`${base}/schemes/${schemeId}/topics/bulk-import`, { rows });
          return { summary: `Created ${result.topicsCreated} topic${result.topicsCreated === 1 ? "" : "s"} and ${result.lessonsCreated} lesson${result.lessonsCreated === 1 ? "" : "s"}.`, errors: result.errors ?? [] };
        }}
      />
      <BulkImportCard
        title="Lesson plans"
        description="One row per lesson plan, matched to an existing lesson by its topicTitle + lessonTitle. The lesson must already have at least one competency and no existing plan."
        columns={["topicTitle", "lessonTitle", "lessonDate", "priorKnowledge", "introductionText", "lessonDevelopment", "teacherActivities", "learnerActivities", "differentiatedInstruction", "specialNeedsAccommodations", "lessonConclusion", "homework"]}
        templateFileName="ledgerly-lesson-plans-import-template.xlsx"
        templateExampleRow={{ topicTitle: "The people of Africa", lessonTitle: "Ethnic groups in Africa", lessonDate: "2026-02-03", priorKnowledge: "", introductionText: "Recap yesterday's discussion on clouds", lessonDevelopment: "", teacherActivities: "", learnerActivities: "", differentiatedInstruction: "", specialNeedsAccommodations: "", lessonConclusion: "", homework: "" }}
        needsScheme
        schemes={schemes.data}
        referenceLoader={(schemeId) => loadSchemeReference(schemeId, "lessons")}
        submit={async (rows, schemeId) => {
          const result = await post<R>(`${base}/schemes/${schemeId}/lesson-plans/bulk-import`, { rows });
          return { summary: `Created ${result.created} lesson plan${result.created === 1 ? "" : "s"}.`, errors: result.errors ?? [] };
        }}
      />
    </div>
  );
}

function BulkImportCard({
  title, description, columns, templateFileName, templateExampleRow, referenceSheets, referenceLoader,
  needsScheme = false, schemes = [], resolveRow, submit,
}: {
  title: string;
  description: string;
  columns: string[];
  templateFileName: string;
  templateExampleRow: R;
  referenceSheets?: Array<{ name: string; rows: R[] }>;
  referenceLoader?: (schemeId: string) => Promise<Array<{ name: string; rows: R[] }>>;
  needsScheme?: boolean;
  schemes?: R[];
  resolveRow?: (row: R) => R;
  submit: (rows: R[], schemeId?: string) => Promise<{ summary: string; errors: Array<{ row: number; message: string }> }>;
}) {
  const [schemeId, setSchemeId] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ summary: string; errors: Array<{ row: number; message: string }> } | null>(null);
  const preview = useMemo(() => {
    const rows = parseCsv(text, columns);
    return resolveRow ? rows.map(resolveRow) : rows;
  }, [text]);

  async function chooseFile(file: File) {
    setError(""); setResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const book = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = book.Sheets[book.SheetNames[0]];
      if (!sheet) throw new Error("The workbook does not contain a readable worksheet.");
      const rows = XLSX.utils.sheet_to_json<R>(sheet, { defval: "", raw: false });
      if (!rows.length) throw new Error("The selected file has no data rows.");
      const asCsv = [columns.join(","), ...rows.map((row) => columns.map((c) => String(row[c] ?? "").replace(/"/g, '""')).map((v) => v.includes(",") ? `"${v}"` : v).join(","))].join("\n");
      setText(asCsv); setFileName(file.name);
    } catch (e) { setError(e instanceof Error ? e.message : errorText(e)); }
  }

  async function downloadTemplate() {
    setDownloading(true);
    try {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet([templateExampleRow], { header: columns });
      XLSX.utils.book_append_sheet(wb, ws, "Import");
      const sheets = referenceLoader && schemeId ? await referenceLoader(schemeId) : referenceSheets;
      for (const sheet of sheets ?? []) {
        if (!sheet.rows.length) continue;
        const refWs = XLSX.utils.json_to_sheet(sheet.rows);
        XLSX.utils.book_append_sheet(wb, refWs, sheet.name.slice(0, 31));
      }
      if (needsScheme && !schemeId) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Select a scheme above first, then download again to see its existing topics/lessons here."]]), "Reference");
      }
      XLSX.writeFile(wb, templateFileName);
    } catch (e) { setError(e instanceof Error ? e.message : errorText(e)); }
    finally { setDownloading(false); }
  }

  return (
    <Card className="acad-import-card">
      <div className="acad-import-head">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <Button variant="secondary" disabled={downloading} onClick={() => void downloadTemplate()}>
          {downloading ? "Preparing…" : "Download template"}
        </Button>
      </div>
      {needsScheme && (
        <Field label="Scheme">
          <select value={schemeId} onChange={(e) => setSchemeId(e.target.value)}>
            <option value="">Select a scheme…</option>
            {schemes.map((s) => (<option key={s.id} value={s.id}>{s.title}</option>))}
          </select>
        </Field>
      )}
      <Field label="Upload a filled-in .xlsx/.csv, or paste CSV below">
        <input type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(e) => { const f = e.target.files?.[0]; if (f) void chooseFile(f); e.target.value = ""; }} />
      </Field>
      {fileName && <Notice tone="info">Loaded {fileName} — review the rows below before importing.</Notice>}
      <Field label={`CSV data (columns: ${columns.join(", ")})`}>
        <textarea rows={6} value={text} onChange={(e) => { setText(e.target.value); setResult(null); setFileName(""); }} placeholder={columns.join(",")} />
      </Field>
      {preview.length > 0 && !result && <Notice tone="info">{preview.length} row{preview.length === 1 ? "" : "s"} ready to import.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {result && <Notice tone={result.errors.length ? "warning" : "success"}>
        {result.summary}
        {!!result.errors.length && <> {result.errors.length} row{result.errors.length === 1 ? "" : "s"} skipped: {result.errors.map((e) => `row ${e.row + 1}: ${e.message}`).join("; ")}</>}
      </Notice>}
      <div className="acad-modal-actions">
        {!result ? (
          <Button
            disabled={busy || !preview.length || (needsScheme && !schemeId)}
            onClick={async () => {
              setBusy(true); setError("");
              try { setResult(await submit(preview, schemeId || undefined)); }
              catch (e) { setError(errorText(e)); }
              finally { setBusy(false); }
            }}
          >
            {busy ? "Importing…" : `Import ${preview.length} row${preview.length === 1 ? "" : "s"}`}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => { setText(""); setFileName(""); setResult(null); }}>Import more</Button>
        )}
      </div>
    </Card>
  );
}

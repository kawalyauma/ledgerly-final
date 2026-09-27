import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Eye, EyeOff, LayoutGrid, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { can, del, get, put, type Principal } from "../../../web/api";
import { useAuth } from "../../../web/auth";
import { Button, Notice, Spinner } from "../../../web/components/ui";
import { ModulesPage } from "../../../web/pages/ModulesPage";
import { appNavigation } from "../../frontend-registry";
import type { FrontendNavigationGroup, FrontendNavigationItem } from "../../frontend-types";
import { arrangeGroups, editableSections, NAVIGATION_CHANGED, SCHOOL_DEFAULT_SECTIONS, useNavigationSettings, type SectionSetting } from "../../../web/navigationSettings";
import "./overview.css";

type Point = { label: string; value: number };
type Overview = {
  generatedAt: string;
  students: { active: number; total: number; male: number; female: number; byClass: Point[] } | null;
  staff: { total: number; teachers: number } | null;
  fees: { billedMinor: number; collectedMinor: number; outstandingMinor: number; collectionRate: number } | null;
  collections: Point[] | null;
  exams: Point[] | null;
  attendance: { marked: number; present: number; absent: number } | null;
  finance: { revenueMinor: number; expensesMinor: number; cashMinor: number } | null;
  monthly: Array<{ label: string; revenue: number; expenses: number }> | null;
  tasks: { open: number; overdue: number } | null;
  admissions: Point[] | null;
};

const fmtInt = (n: number) => Math.round(n).toLocaleString();
const money = (minor: number) => {
  const v = minor / 100, abs = Math.abs(v);
  const text = abs >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : abs >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : abs >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : v.toFixed(0);
  return `UGX ${text}`;
};
const moneyFull = (minor: number) => `UGX ${Math.round(minor / 100).toLocaleString()}`;
const words = (v: string) => v.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
const allowedItem = (i: FrontendNavigationItem, p: Principal | null) => (!i.scope || can(p, i.scope)) && (!i.admin || !!p && ["owner", "admin"].includes(p.role));

function useOverview() {
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); setError(""); get<Overview>("/workspace/overview").then(setData).catch(e => setError(e.message)).finally(() => setLoading(false)); };
  useEffect(load, []);
  return { data, error, loading, load };
}

function useIdentity(principal: Principal | null) {
  const [org, setOrg] = useState(""), [name, setName] = useState("");
  useEffect(() => {
    get<Array<{ id: string; name: string }>>("/organizations").then(x => setOrg(x.find(o => o.id === principal?.organizationId)?.name || "")).catch(() => {});
    if (can(principal, "admin:read")) get<Array<{ userId: string; displayName: string }>>("/admin/memberships").then(x => setName(x.find(m => m.userId === principal?.userId)?.displayName || "")).catch(() => {});
  }, [principal]);
  return { org, name };
}

/* ---------------------------------------------------------------- charts */

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return <article className="ov-tile"><span>{label}</span><strong className={tone ? `ov-${tone}` : ""}>{value}</strong>{hint && <small>{hint}</small>}</article>;
}

/** Single-series column chart with a per-bar hover tooltip. */
function Columns({ points, format, ariaLabel }: { points: Point[]; format: (n: number) => string; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.map(p => p.value)), W = 960, H = 150, pad = 0, gap = 2;
  const bw = (W - pad) / points.length - gap;
  if (!points.some(p => p.value)) return <p className="ov-empty">No activity in this period yet.</p>;
  return <div className="ov-chart">
    <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
      <line x1={0} x2={W} y1={H} y2={H} className="ov-axis" />
      <line x1={0} x2={W} y1={16} y2={16} className="ov-grid-line" />
      <text x={0} y={11} className="ov-tick">{format(max)}</text>
      {points.map((p, i) => {
        const h = (p.value / max) * (H - 16), x = pad + i * (bw + gap) + gap / 2;
        return <g key={p.label} onMouseEnter={() => setHover(i)}>
          <rect x={x - gap / 2} y={0} width={bw + gap} height={H} fill="transparent" />
          {h > 0 && <path className={`ov-bar ${hover === i ? "is-hover" : ""}`} d={`M${x},${H} V${H - h + Math.min(4, h)} q0,-4 4,-4 h${Math.max(0, bw - 8)} q4,0 4,4 V${H} Z`} />}
        </g>;
      })}
      <text x={pad} y={H + 16} className="ov-tick">{points[0]?.label}</text>
      <text x={W} y={H + 16} className="ov-tick" textAnchor="end">{points.at(-1)?.label}</text>
    </svg>
    {hover !== null && <div className="ov-tooltip" style={{ left: `${((pad + hover * (bw + gap) + bw / 2) / W) * 100}%` }}><b>{format(points[hover]!.value)}</b><span>{points[hover]!.label}</span></div>}
  </div>;
}

/** Revenue vs expenses: two series, grouped bars, legend + tooltip (never colour alone). */
function MonthlyBars({ rows }: { rows: NonNullable<Overview["monthly"]> }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.flatMap(r => [r.revenue, r.expenses])), W = 960, H = 150, pad = 8;
  const slot = (W - pad * 2) / rows.length, bw = Math.min(28, slot / 3);
  if (!rows.some(r => r.revenue || r.expenses)) return <p className="ov-empty">No posted income or expenses in the last six months.</p>;
  const bar = (x: number, v: number, cls: string) => { const h = (v / max) * (H - 10); return h > 0 ? <path className={cls} d={`M${x},${H} V${H - h + Math.min(4, h)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${H} Z`} /> : null; };
  return <div className="ov-chart">
    <div className="ov-legend"><span><i className="ov-sw ov-sw-rev" />Income</span><span><i className="ov-sw ov-sw-exp" />Expenses</span></div>
    <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label="Income and expenses by month" onMouseLeave={() => setHover(null)}>
      <line x1={0} x2={W} y1={H} y2={H} className="ov-axis" />
      {rows.map((r, i) => {
        const cx = pad + slot * i + slot / 2;
        return <g key={r.label} onMouseEnter={() => setHover(i)} className={hover === i ? "is-hover" : ""}>
          <rect x={cx - slot / 2} y={0} width={slot} height={H} fill="transparent" />
          {bar(cx - bw - 1, r.revenue, "ov-bar-rev")}
          {bar(cx + 1, r.expenses, "ov-bar-exp")}
          <text x={cx} y={H + 16} className="ov-tick" textAnchor="middle">{r.label.slice(0, 3)}</text>
        </g>;
      })}
    </svg>
    {hover !== null && <div className="ov-tooltip" style={{ left: `${((pad + slot * hover + slot / 2) / W) * 100}%` }}><span>{rows[hover]!.label}</span><b>Income {moneyFull(rows[hover]!.revenue)}</b><b>Expenses {moneyFull(rows[hover]!.expenses)}</b></div>}
  </div>;
}

/** Horizontal bars for a category breakdown (students per class, exams by status). */
function Breakdown({ points, format = fmtInt }: { points: Point[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...points.map(p => p.value));
  if (!points.length) return <p className="ov-empty">Nothing recorded yet.</p>;
  return <ul className="ov-breakdown">{points.map(p => <li key={p.label} title={`${p.label}: ${format(p.value)}`}>
    <span className="ov-bd-label">{p.label}</span>
    <span className="ov-bd-track"><span className="ov-bd-fill" style={{ width: `${(p.value / max) * 100}%` }} /></span>
    <span className="ov-bd-value">{format(p.value)}</span>
  </li>)}</ul>;
}

/* ---------------------------------------------------------------- dashboard */

export function OverviewDashboard() {
  const { data, error, loading, load } = useOverview();
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const collected30 = useMemo(() => (data?.collections ?? []).reduce((n, p) => n + p.value, 0), [data]);
  return <div className="page ov-page">
    <div className="ov-head"><div><h1>Dashboard</h1><p>{today}</p></div><Button variant="secondary" onClick={load} disabled={loading}><RefreshCw size={15} /> Refresh</Button></div>
    {error && <Notice tone="danger">{error}</Notice>}
    {loading && !data ? <Spinner label="Loading statistics" /> : data && <>
      <div className="ov-tiles">
        {data.students && <Tile label="Active students" value={fmtInt(data.students.active)} hint={`${fmtInt(data.students.total)} on record`} />}
        {data.staff && <Tile label="Staff" value={fmtInt(data.staff.total)} hint={`${fmtInt(data.staff.teachers)} teachers`} />}
        {data.fees && <Tile label="Fees collected" value={money(data.fees.collectedMinor)} hint={`of ${money(data.fees.billedMinor)} billed`} tone="good" />}
        {data.fees && <Tile label="Fees outstanding" value={money(data.fees.outstandingMinor)} hint={`${Math.round(data.fees.collectionRate * 100)}% collection rate`} tone={data.fees.outstandingMinor > 0 ? "bad" : undefined} />}
        {data.finance && <Tile label="Cash & bank" value={money(data.finance.cashMinor)} />}
        {data.attendance && <Tile label="Attendance today" value={data.attendance.marked ? `${Math.round((data.attendance.present / data.attendance.marked) * 100)}%` : "—"} hint={data.attendance.marked ? `${fmtInt(data.attendance.absent)} absent` : "No register marked yet"} />}
        {data.tasks && (data.tasks.open > 0 || data.tasks.overdue > 0) && <Tile label="Open tasks" value={fmtInt(data.tasks.open)} hint={`${fmtInt(data.tasks.overdue)} overdue`} tone={data.tasks.overdue ? "bad" : undefined} />}
      </div>
      <div className="ov-grid">
        {data.collections && <section className="ov-card ov-wide"><header><h2>Fee collections · last 30 days</h2><span>{moneyFull(collected30)}</span></header><Columns points={data.collections} format={money} ariaLabel="Fee collections per day for the last 30 days" /></section>}
        {data.monthly && <section className="ov-card ov-wide"><header><h2>Income vs expenses · last 6 months</h2>{data.finance && <span>Net {moneyFull(data.finance.revenueMinor - data.finance.expensesMinor)}</span>}</header><MonthlyBars rows={data.monthly} /></section>}
        {data.students && <section className="ov-card"><header><h2>Students per class</h2><span>{fmtInt(data.students.active)} active</span></header><Breakdown points={data.students.byClass} /></section>}
        {data.exams && <section className="ov-card"><header><h2>Examinations</h2><a href="#exams">Open</a></header><Breakdown points={data.exams.map(p => ({ ...p, label: words(p.label) }))} /></section>}
        {data.admissions && data.admissions.length > 0 && <section className="ov-card"><header><h2>Admissions</h2><a href="#school/admissions">Open</a></header><Breakdown points={data.admissions.map(p => ({ ...p, label: words(p.label) }))} /></section>}
      </div>
      <p className="ov-foot">Figures update automatically from your records · last refreshed {new Date(data.generatedAt).toLocaleTimeString()}</p>
    </>}
  </div>;
}

/* ---------------------------------------------------------------- welcome */

export function WelcomePage() {
  const { principal } = useAuth();
  const layout = useNavigationSettings(principal?.organizationId);
  const { org, name } = useIdentity(principal);
  const { data } = useOverview();
  const isAdmin = !!principal && ["owner", "admin"].includes(principal.role);
  const hour = new Date().getHours(), greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const sections = useMemo(() => layout === undefined ? [] : arrangeGroups(appNavigation, layout)
    .map(g => ({ group: g, items: g.items.filter(i => allowedItem(i, principal)) })).filter(g => g.items.length), [layout, principal]);
  return <div className="page ov-page">
    <section className="ov-hero">
      <div>
        <span className="ov-eyebrow"><Sparkles size={14} /> Welcome to Ledgerly</span>
        <h1>{greeting}{name ? `, ${name.split(" ")[0]}` : ""}</h1>
        <p>{org ? `${org} · ` : ""}{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
      </div>
      <Button onClick={() => { location.hash = "dashboards"; }}>Open dashboard <ArrowRight size={15} /></Button>
    </section>
    {data && <div className="ov-tiles">
      {data.students && <Tile label="Active students" value={fmtInt(data.students.active)} />}
      {data.fees && <Tile label="Fees collected" value={money(data.fees.collectedMinor)} tone="good" />}
      {data.fees && <Tile label="Outstanding" value={money(data.fees.outstandingMinor)} tone={data.fees.outstandingMinor > 0 ? "bad" : undefined} />}
      {data.staff && <Tile label="Staff" value={fmtInt(data.staff.total)} />}
    </div>}
    <h2 className="ov-section-title">Your workspace</h2>
    <div className="ov-launch">
      {sections.map(({ group, items }) => { const Icon = group.icon; return <button key={group.key} className="ov-launch-card" onClick={() => { location.hash = items[0]!.path; }}>
        <span className="ov-launch-icon"><Icon size={20} /></span>
        <strong>{group.label}</strong>
        <small>{items.length === 1 ? items[0]!.label : `${items.length} pages · ${items.slice(0, 3).map(i => i.label).join(", ")}${items.length > 3 ? "…" : ""}`}</small>
      </button>; })}
      {isAdmin && <button className="ov-launch-card ov-launch-muted" onClick={() => { location.hash = "workspace-settings"; }}>
        <span className="ov-launch-icon"><LayoutGrid size={20} /></span>
        <strong>Add more modules</strong>
        <small>Choose which sections appear in the sidebar and their order.</small>
      </button>}
    </div>
  </div>;
}

/* ---------------------------------------------------------------- modules & sections */

export function WorkspaceSettingsPage() {
  const { principal } = useAuth();
  const layout = useNavigationSettings(principal?.organizationId);
  const [tab, setTab] = useState<"sections" | "modules">("sections");
  const [rows, setRows] = useState<SectionSetting[] | null>(null), [saving, setSaving] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const groups = useMemo(() => new Map(appNavigation.map(g => [g.key!, g])), []);
  useEffect(() => { if (layout !== undefined) setRows(editableSections(appNavigation.map(g => g.key!), layout)); }, [layout]);
  const move = (i: number, d: -1 | 1) => setRows(r => { if (!r) return r; const n = [...r], j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const toggle = (i: number) => setRows(r => r && r.map((x, k) => k === i ? { ...x, visible: !x.visible } : x));
  const done = (text: string) => { setMessage(text); setError(""); dispatchEvent(new Event(NAVIGATION_CHANGED)); };
  async function save() { if (!rows) return; setSaving(true); try { await put("/workspace/navigation", { sections: rows }); done("Sidebar saved. Everyone in this organization now sees this layout."); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } }
  async function schoolDefault() { setSaving(true); try { await del("/workspace/navigation"); done("Reset to the school default: Dashboard, School, Examinations."); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } }
  async function showAll() { setSaving(true); try { await put("/workspace/navigation", { showAll: true }); done("Every module section is now shown."); } catch (e) { setError((e as Error).message); } finally { setSaving(false); } }
  const visibleCount = rows?.filter(r => r.visible).length ?? 0;
  return <div className="page ov-page">
    <div className="ov-head"><div><h1>Modules &amp; sections</h1><p>Choose which modules appear in the sidebar for this organization, and in what order.</p></div></div>
    <div className="ov-tabs" role="tablist">
      <button role="tab" aria-selected={tab === "sections"} className={tab === "sections" ? "active" : ""} onClick={() => setTab("sections")}>Sidebar sections</button>
      <button role="tab" aria-selected={tab === "modules"} className={tab === "modules" ? "active" : ""} onClick={() => setTab("modules")}>Installed modules</button>
    </div>
    {tab === "modules" ? <ModulesPage /> : <>
      {message && <Notice tone="success">{message}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      <section className="ov-card">
        <header><h2>Sidebar layout</h2><span>{visibleCount} shown</span></header>
        {!rows ? <Spinner /> : <ul className="ov-sections">{rows.map((r, i) => { const g = groups.get(r.key) as FrontendNavigationGroup | undefined; if (!g) return null; const Icon = g.icon; return <li key={r.key} className={r.visible ? "" : "is-hidden"}>
          <span className="ov-order">{r.visible ? rows.slice(0, i + 1).filter(x => x.visible).length : "—"}</span>
          <span className="ov-launch-icon"><Icon size={18} /></span>
          <span className="ov-sec-name"><strong>{g.label}</strong><small>{g.items.length === 1 ? g.items[0]!.label : `${g.items.length} pages`}{SCHOOL_DEFAULT_SECTIONS.includes(r.key) ? " · school default" : ""}</small></span>
          <span className="ov-sec-actions">
            <button aria-label={`Move ${g.label} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
            <button aria-label={`Move ${g.label} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
            <button className={`ov-visible ${r.visible ? "on" : ""}`} aria-pressed={r.visible} onClick={() => toggle(i)}>{r.visible ? <><Eye size={15} /> Shown</> : <><EyeOff size={15} /> Hidden</>}</button>
          </span>
        </li>; })}</ul>}
        <div className="ov-actions">
          <Button onClick={save} disabled={saving || !rows}>Save layout</Button>
          <Button variant="secondary" onClick={schoolDefault} disabled={saving}><RotateCcw size={15} /> Use school default</Button>
          <Button variant="secondary" onClick={showAll} disabled={saving}>Show every module</Button>
        </div>
      </section>
      <p className="ov-foot">Hidden sections only leave the sidebar; their pages and data stay intact. Owners and administrators can always reach this page from the account menu.</p>
    </>}
  </div>;
}

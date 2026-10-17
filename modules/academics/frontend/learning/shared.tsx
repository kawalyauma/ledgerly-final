import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, authStore, errorText, get } from "../../../../web/api";

/* Shared plumbing for the Learning Engine screens (backend: /api/v1/learn, node-backend/src/features/learning-engine). */

export type R = Record<string, any>;
export type Tone = "success" | "warning" | "danger" | "neutral";

/** The signed-in staff member's view (GET /learn/me) plus the school setup lists used by filters and forms. */
export type Me = {
  user: { id: string; name: string; email: string | null; role: string };
  school: string | null;
  term: { id: string; name: string; week: number | null; inTerm: boolean; startsOn: string; endsOn: string } | null;
  today: string; now: string;
  can: { write: boolean; capture: boolean; manage: boolean; admin: boolean };
  classes: Array<{ id: string; name: string }>; subjects: Array<{ id: string; name: string }>; allClasses: boolean;
  todayPlan: R[]; nowPeriod: R | null; nextPeriod: R | null;
  week: { from: string; to: string; planned: number; taught: number };
  stats: { lessonsTaught: number; pagesScanned: number; pagesToReview: number; schemesPublished: number; schemesToReview: number };
};
export type Setup = { terms: R[]; classes: R[]; subjects: R[] };
export type Ctx = { me: Me; setup: Setup; go: (...parts: Array<string | undefined>) => void };

/** GET with loading/error state; `poll` (ms) refreshes quietly in the background while the page is visible. */
export function useLoad<T>(url: string | null, initial: T, poll?: number) {
  const [data, setData] = useState<T>(initial), [loading, setLoading] = useState(Boolean(url)), [error, setError] = useState("");
  const seq = useRef(0);
  const load = useCallback(async (quiet = false) => {
    if (!url) { setLoading(false); return; }
    const mine = ++seq.current;
    if (!quiet) { setLoading(true); setError(""); }
    try { const next = await get<T>(url); if (mine === seq.current) { setData(next); setError(""); } }
    catch (e) { if (mine === seq.current && (!quiet || !(e instanceof ApiError && e.status === 0))) setError(errorText(e)); }
    finally { if (mine === seq.current) setLoading(false); }
  }, [url]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!poll || !url) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(true); }, poll);
    return () => clearInterval(t);
  }, [poll, url, load]);
  return { data, setData, loading, error, reload: load };
}

/** Runs an action with a busy flag and an error message, then an optional follow-up. */
export function useAction() {
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [done, setDone] = useState("");
  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key); setError(""); setDone("");
    try { await fn(); if (success) setDone(success); return true; }
    catch (e) { setError(errorText(e)); return false; }
    finally { setBusy(""); }
  };
  return { busy, error, done, run, clear: () => { setError(""); setDone(""); } };
}

export const words = (v: unknown) => String(v ?? "").replace(/[._]/g, " ").replace(/^\w/, c => c.toUpperCase());

const GOOD = new Set(["published", "written", "reviewed", "succeeded", "answered", "closed", "done", "analyzed", "taught", "used", "active", "ready", "imported", "passed"]);
const BUSY = new Set(["review", "writing", "outlining", "sourcing", "queued", "running", "pending", "requested", "open", "reopened", "to_publish", "needs_review", "paused", "planned", "draft", "submitted", "uploaded", "skipped", "processing", "analyzing", "generating"]);
const BAD = new Set(["failed", "stopped", "missed", "rejected", "error", "duplicate"]);
export function tone(status: unknown): Tone {
  const s = String(status ?? "").toLowerCase();
  return GOOD.has(s) ? "success" : BAD.has(s) ? "danger" : BUSY.has(s) ? "warning" : "neutral";
}

export function ago(iso?: string | null) {
  if (!iso) return "—";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "—";
  if (s < 45) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d} d ago`;
  return new Date(iso).toLocaleDateString();
}
export const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
export const num = (v: unknown) => Number(v ?? 0).toLocaleString();
export function duration(ms?: number | string | null) {
  const n = Number(ms ?? 0); if (!n) return "—";
  if (n < 1000) return `${n} ms`;
  const s = Math.round(n / 1000); if (s < 90) return `${s}s`;
  const m = Math.round(s / 60); return m < 90 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
}

/** API asset URLs come back as /api/v1/...; the api helpers want them without the prefix. */
export const apiPath = (url: string) => url.replace(/^\/api\/v1/, "");

async function authedBlob(path: string) {
  const res = await fetch(`/api/v1${apiPath(path)}`, { headers: { Authorization: `Bearer ${authStore.getAccess() || ""}` } });
  if (!res.ok) throw new Error(`Could not load (${res.status})`);
  return res.blob();
}

/** <img> for protected API images: they need the bearer token, so the bytes are fetched and shown from a blob URL. */
export function AuthImage({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  const [url, setUrl] = useState(""), [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoke = "", live = true;
    setUrl(""); setFailed(false);
    authedBlob(src).then(b => { if (!live) return; revoke = URL.createObjectURL(b); setUrl(revoke); }).catch(() => live && setFailed(true));
    return () => { live = false; if (revoke) URL.revokeObjectURL(revoke); };
  }, [src]);
  if (failed) return <div className={`le-img le-img--empty ${className}`}>No image</div>;
  if (!url) return <div className={`le-img le-img--loading ${className}`} aria-label={`Loading ${alt}`} />;
  return <img className={`le-img ${className}`} src={url} alt={alt} loading="lazy" />;
}

/** Opens a protected HTML page (e.g. a printable lesson) in a new tab. */
export async function openAuthed(path: string) {
  const tab = window.open("", "_blank");
  try {
    const blob = await authedBlob(path);
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url; else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) { tab?.close(); throw e; }
}

/* ---------- a small, safe Markdown renderer for lesson notes (React elements only, no HTML injection) ---------- */

function inline(text: string, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|`[^`]+`)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith("**") || t.startsWith("__")) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const NOTE_HEADING = /^(?:note|nb|n\.b\.?)\s*:?$/i;

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0, note = false;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || /^\s*<!--.*-->\s*$/.test(line)) { i++; continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      note = NOTE_HEADING.test(h[2]!.trim());
      const level = Math.min(6, h[1]!.length + 1); const Tag = `h${level}` as "h2";
      blocks.push(<Tag key={i}>{inline(note ? "Note:" : h[2]!, `h${i}`)}</Tag>); i++; continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) {
        const cells = lines[i]!.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        if (!cells.every(c => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(<div className="le-md-table" key={`t${i}`}><table><thead><tr>{head?.map((c, k) => <th key={k}>{inline(c)}</th>)}</tr></thead>
        <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*([-*+❖•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+❖•]|\d+[.)])\s+/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\s*([-*+❖•]|\d+[.)])\s+/, "")); i++; }
      const List = ordered ? "ol" : "ul";
      // Notebook style: ticks under "Note:", and short name lists (examples, districts) in two columns.
      const cls = ordered ? undefined : [note ? "le-md-note" : "", items.length >= 4 && items.every(it => it.split(/\s+/).length <= 4) ? "le-md-cols" : ""].filter(Boolean).join(" ") || undefined;
      blocks.push(<List key={`l${i}`} className={cls}>{items.map((it, k) => <li key={k}>{inline(it, `l${i}-${k}`)}</li>)}</List>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,6}\s|\s*\||\s*([-*+❖•]|\d+[.)])\s+)/.test(lines[i]!)) { para.push(lines[i]!); i++; }
    blocks.push(<p key={`p${i}`}>{para.map((p, k) => <Fragment key={k}>{k > 0 && <br />}{inline(p, `p${i}-${k}`)}</Fragment>)}</p>);
  }
  return <div className="le-md">{blocks}</div>;
}

/* ---------- layout bits ---------- */

export function PageHead({ eyebrow = "Learning engine", title, lead, actions, back }: { eyebrow?: string; title: ReactNode; lead?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return <header className="le-head">
    <div>{back}<small>{eyebrow}</small><h1>{title}</h1>{lead && <p>{lead}</p>}</div>
    {actions && <div className="le-head-actions">{actions}</div>}
  </header>;
}

export function Stat({ label, value, hint, icon, tone: t = "neutral", onClick }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: Tone | "brand"; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return <Tag className={`le-stat le-stat--${t}`} onClick={onClick} type={onClick ? "button" : undefined}>
    {icon && <span className="le-stat__icon">{icon}</span>}
    <span className="le-stat__body"><small>{label}</small><b>{value}</b>{hint && <em>{hint}</em>}</span>
  </Tag>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return <div className="le-seg" role="tablist" aria-label={label}>
    {options.map(([v, text]) => <button key={v} type="button" role="tab" aria-selected={value === v} className={value === v ? "active" : ""} onClick={() => onChange(v)}>{text}</button>)}
  </div>;
}

export function Progress({ value, total, tone: t = "brand" }: { value: number; total: number; tone?: Tone | "brand" }) {
  const pct = total ? Math.min(100, Math.round(value / total * 100)) : 0;
  return <span className={`le-progress le-progress--${t}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></span>;
}

export const optionsOf = (rows: R[], all?: string) => [...(all ? [["", all]] : []), ...rows.map(r => [r.id, r.name])] as Array<[string, string]>;

export function Select({ value, onChange, options, label, disabled }: { value: string; onChange: (v: string) => void; options: Array<[string, string]>; label: string; disabled?: boolean }) {
  return <select className="le-select" aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
    {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
  </select>;
}

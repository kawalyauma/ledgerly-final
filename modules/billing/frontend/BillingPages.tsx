import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, CircleAlert, Crown, KeyRound, Loader2, PlugZap, RefreshCw, Smartphone, Wallet } from "lucide-react";
import { get, post, put } from "../../../web/api";
import { useAuth } from "../../../web/auth";
import { Button, Field, Modal, Notice, Spinner } from "../../../web/components/ui";
import { BILLING_CHANGED, PLANS, type PlanKey, ugx } from "../../../web/plans";

type Invoice = { id: string; periodLabel: string; plan: PlanKey; rateUgx: number; students: number; amountUgx: number; paidUgx: number; balanceUgx: number; status: string; createdAt: string };
type Payment = { id: string; provider: "ssentezo" | "manual"; reference: string; msisdn?: string; amountUgx: number; status: string; failureReason?: string; note?: string; createdAt: string; completedAt?: string; organizationName?: string };
type Usage = {
  plan: PlanKey; planName: string; rateUgx: number; status: "active" | "suspended";
  period: { label: string; startsOn?: string; endsOn?: string }; activeStudents: number; current: Invoice | null;
  totals: { billedUgx: number; paidUgx: number; balanceUgx: number };
  invoices: Invoice[]; payments: Payment[]; paymentsConfigured: boolean; paymentsEnvironment: "sandbox" | "live";
  limits: { minUgx: number; maxUgx: number }; isPlatformAdmin: boolean;
};

const date = (v?: string) => v ? new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
const words = (v: string) => v.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
function StatusChip({ value }: { value: string }) {
  const tone = ["paid", "succeeded", "active"].includes(value) ? "good" : ["failed", "suspended", "void"].includes(value) ? "bad" : "wait";
  return <span className={`bl-chip bl-${tone}`}>{words(value)}</span>;
}
const RANK: Record<PlanKey, number> = { free: 0, standard: 1, premium: 2 };

/* ---------------------------------------------------------------- Plan & usage (every school) */

export function UsagePage() {
  const { principal } = useAuth();
  const [data, setData] = useState<Usage | null>(null), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [upgrade, setUpgrade] = useState<PlanKey | null>(null), [busy, setBusy] = useState(false);
  const isAdmin = !!principal && ["owner", "admin"].includes(principal.role);
  const load = () => get<Usage>("/billing/usage").then(d => { setData(d); setError(""); }).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function confirmUpgrade() {
    if (!upgrade) return; setBusy(true);
    try { await post("/billing/plan", { plan: upgrade }); setNotice(`Your school is now on ${PLANS.find(p => p.key === upgrade)?.name}. The new modules are in the sidebar.`); setUpgrade(null); dispatchEvent(new Event(BILLING_CHANGED)); await load(); }
    catch (e) { setError((e as Error).message); setUpgrade(null); } finally { setBusy(false); }
  }

  if (!data) return <div className="page bl-page">{error ? <Notice tone="danger">{error}</Notice> : <Spinner label="Loading plan & usage" />}</div>;
  const cur = data.current, pct = cur && cur.amountUgx ? Math.min(100, Math.round((cur.paidUgx / cur.amountUgx) * 100)) : 0;
  return <div className="page bl-page">
    <div className="bl-head"><div><h1>Plan &amp; usage</h1><p>Your school's Ledgerly plan, this term's usage and payment standing.</p></div>
      {data.isPlatformAdmin && <Button variant="secondary" onClick={() => { location.hash = "platform-admin"; }}><Crown size={15} /> Platform admin</Button>}</div>
    {error && <Notice tone="danger">{error}</Notice>}
    {notice && <Notice tone="success">{notice}</Notice>}
    {data.status === "suspended" && <Notice tone="danger">This subscription is suspended. Pay this term's balance, or contact Ledgerly support, to restore access.</Notice>}

    <div className="bl-grid">
      <section className="bl-card bl-standing">
        <header><span className="bl-plan-badge">{data.planName} plan</span><StatusChip value={data.status} /></header>
        <h2>{data.period.label}</h2>
        <p className="bl-muted">{data.period.startsOn ? `${date(data.period.startsOn)} – ${date(data.period.endsOn)}` : "Current term"}</p>
        {data.plan === "free" ? <div className="bl-free"><CheckCircle2 size={20} /><div><b>Nothing to pay</b><span>The Free plan covers Dashboard, School and Examinations for any number of students.</span></div></div> : cur && <>
          <div className="bl-stats">
            <div><small>Students billed</small><b>{cur.students.toLocaleString()}</b><span>{data.activeStudents.toLocaleString()} active now</span></div>
            <div><small>Rate</small><b>{ugx(cur.rateUgx)}</b><span>per student / term</span></div>
            <div><small>This term</small><b>{ugx(cur.amountUgx)}</b><span>{cur.students} × {ugx(cur.rateUgx)}</span></div>
          </div>
          <div className="bl-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Share of this term paid"><span style={{ width: `${pct}%` }} /></div>
          <div className="bl-paid"><span>Paid <b>{ugx(cur.paidUgx)}</b></span><span className={cur.balanceUgx ? "bl-due" : "bl-clear"}>{cur.balanceUgx ? <>Balance <b>{ugx(cur.balanceUgx)}</b></> : <><CheckCircle2 size={15} /> Fully paid</>}</span></div>
        </>}
        <p className="bl-foot">Billing uses the highest number of active students during the term. All terms: billed {ugx(data.totals.billedUgx)} · paid {ugx(data.totals.paidUgx)} · balance {ugx(data.totals.balanceUgx)}.</p>
      </section>

      {cur && cur.balanceUgx > 0 && <PayCard usage={data} canPay={isAdmin} onPaid={() => { setNotice("Payment received. Thank you!"); void load(); }} />}
    </div>

    <section className="bl-card">
      <header><h2>Plans</h2><span className="bl-muted">Per active student, per term</span></header>
      <div className="bl-plans">{PLANS.map(p => {
        const current = p.key === data.plan, higher = RANK[p.key] > RANK[data.plan];
        return <article key={p.key} className={current ? "is-current" : ""}>
          <h3>{p.name}{current && <span>Current</span>}</h3>
          <b className="bl-rate">{p.rateUgx ? ugx(p.rateUgx) : "Free"}</b>
          <p className="bl-muted">{p.rateUgx ? `≈ ${ugx(p.rateUgx * Math.max(data.activeStudents, 1))} per term for your ${data.activeStudents} students` : "No charge"}</p>
          <ul>{p.features.map(f => <li key={f}><CheckCircle2 size={14} />{f}</li>)}</ul>
          {higher && isAdmin && <Button onClick={() => setUpgrade(p.key)}>Upgrade to {p.name}</Button>}
          {!higher && !current && <small className="bl-muted">Contact Ledgerly support to move to a lower plan.</small>}
        </article>;
      })}</div>
    </section>

    <section className="bl-card">
      <header><h2>Terms</h2></header>
      {!data.invoices.length ? <p className="bl-muted">No billed terms yet.</p> : <div className="table-wrap"><table className="bl-table"><thead><tr><th>Term</th><th>Plan</th><th>Students</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead>
        <tbody>{data.invoices.map(i => <tr key={i.id}><td>{i.periodLabel}</td><td>{words(i.plan)}</td><td>{i.students}</td><td>{ugx(i.amountUgx)}</td><td>{ugx(i.paidUgx)}</td><td>{ugx(i.balanceUgx)}</td><td><StatusChip value={i.status} /></td></tr>)}</tbody></table></div>}
    </section>

    <section className="bl-card">
      <header><h2>Payments</h2></header>
      {!data.payments.length ? <p className="bl-muted">No payments yet.</p> : <div className="table-wrap"><table className="bl-table"><thead><tr><th>Date</th><th>Method</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead>
        <tbody>{data.payments.map(p => <tr key={p.id}><td>{date(p.createdAt)}</td><td>{p.provider === "manual" ? (p.note || "Recorded by Ledgerly") : `Mobile Money ${p.msisdn ? `· ${p.msisdn.replace(/^256/, "0")}` : ""}`}</td><td>{ugx(p.amountUgx)}</td><td><StatusChip value={p.status} />{p.failureReason && <small className="bl-err">{p.failureReason}</small>}</td><td className="bl-mono">{p.reference}</td></tr>)}</tbody></table></div>}
    </section>

    {upgrade && <Modal title={`Upgrade to ${PLANS.find(p => p.key === upgrade)?.name}`} onClose={() => setUpgrade(null)}>
      <p>This term's bill becomes <b>{ugx((PLANS.find(p => p.key === upgrade)?.rateUgx ?? 0) * Math.max(data.activeStudents, cur?.students ?? 0))}</b> ({Math.max(data.activeStudents, cur?.students ?? 0)} students × {ugx(PLANS.find(p => p.key === upgrade)?.rateUgx ?? 0)}). The new modules unlock immediately.</p>
      <div className="bl-actions"><Button onClick={confirmUpgrade} disabled={busy}>{busy ? "Upgrading…" : "Confirm upgrade"}</Button><Button variant="secondary" onClick={() => setUpgrade(null)}>Cancel</Button></div>
    </Modal>}
  </div>;
}

/** Mobile-money payment: start a Ssentezo collection, then poll until the payer approves. */
function PayCard({ usage, canPay, onPaid }: { usage: Usage; canPay: boolean; onPaid: () => void }) {
  const balance = usage.current!.balanceUgx, max = Math.min(balance, usage.limits.maxUgx);
  const [phone, setPhone] = useState(""), [amount, setAmount] = useState(String(max)), [payment, setPayment] = useState<Payment | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearInterval(timer.current), []);
  const poll = (p: Payment) => {
    let tries = 0;
    window.clearInterval(timer.current);
    timer.current = window.setInterval(async () => {
      tries++;
      try {
        const next = await post<Payment>(`/billing/payments/${p.id}/refresh`, {});
        setPayment(next);
        if (next.status === "succeeded") { window.clearInterval(timer.current); onPaid(); }
        if (next.status === "failed" || tries > 36) window.clearInterval(timer.current);
      } catch { if (tries > 36) window.clearInterval(timer.current); }
    }, 5000);
  };
  async function pay(e: FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try { const p = await post<Payment>("/billing/pay", { msisdn: phone, amountUgx: Number(amount) }); setPayment(p); poll(p); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <section className="bl-card bl-pay">
    <header><h2><Smartphone size={18} /> Pay with Mobile Money</h2>{usage.paymentsEnvironment === "sandbox" && usage.paymentsConfigured && <span className="bl-chip bl-wait">Test mode</span>}</header>
    {!usage.paymentsConfigured ? <Notice tone="warning">Mobile money payments are being set up. Contact Ledgerly support to pay this term's balance.</Notice>
      : !canPay ? <p className="bl-muted">Ask your school's owner or an administrator to pay the balance of {ugx(balance)}.</p>
      : payment && payment.status !== "failed" ? <div className={`bl-progress-note ${payment.status}`}>
          {payment.status === "succeeded" ? <><CheckCircle2 size={22} /><div><b>Payment received</b><span>{ugx(payment.amountUgx)} has been applied to this term.</span></div></>
            : <><Loader2 size={22} className="bl-spin" /><div><b>Check your phone</b><span>Approve the {ugx(payment.amountUgx)} prompt with your Mobile Money PIN. This page updates on its own.</span></div></>}
        </div>
      : <form onSubmit={pay} className="bl-form">
          {payment?.status === "failed" && <Notice tone="danger">{payment.failureReason || "The payment was not completed."} You can try again.</Notice>}
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="MTN or Airtel number"><input required inputMode="tel" placeholder="0772 123456" value={phone} onChange={e => setPhone(e.target.value)} /></Field>
          <Field label={`Amount (UGX, up to ${max.toLocaleString()})`}><input required type="number" min={usage.limits.minUgx} max={max} step={1} value={amount} onChange={e => setAmount(e.target.value)} /></Field>
          <Button type="submit" disabled={busy}><Wallet size={15} /> {busy ? "Sending prompt…" : `Pay ${ugx(Number(amount) || 0)}`}</Button>
          {balance > usage.limits.maxUgx && <small className="bl-muted">Mobile money allows up to {ugx(usage.limits.maxUgx)} per payment, so larger balances are paid in parts.</small>}
        </form>}
  </section>;
}

/* ---------------------------------------------------------------- Platform admin portal */

type AdminOrg = { id: string; name: string; ownerEmail?: string; members: number; createdAt: string; plan: PlanKey; status: "active" | "suspended"; notes?: string; activeStudents: number; period: string; current: Invoice | null; billedUgx: number; paidUgx: number; balanceUgx: number };
type AdminData = { summary: { organizations: number; byPlan: Record<PlanKey, number>; suspended: number; students: number; billedUgx: number; paidUgx: number }; organizations: AdminOrg[]; paymentsConfigured: boolean; paymentsEnvironment: string };
type PaySettings = { environment: "sandbox" | "live"; apiUser: string; hasApiKey: boolean; publicUrl: string; source: string; configured: boolean };

export function PlatformAdminPage() {
  const [data, setData] = useState<AdminData | null>(null), [payments, setPayments] = useState<Payment[]>([]), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"schools" | "payments" | "settings">("schools"), [query, setQuery] = useState(""), [recordFor, setRecordFor] = useState<AdminOrg | null>(null);
  const load = () => Promise.all([get<AdminData>("/platform/organizations"), get<Payment[]>("/platform/payments")]).then(([d, p]) => { setData(d); setPayments(p); setError(""); }).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function change(org: AdminOrg, patch: Partial<Pick<AdminOrg, "plan" | "status">>) {
    try { await put(`/platform/organizations/${org.id}/subscription`, patch); setNotice(`${org.name} updated.`); await load(); }
    catch (e) { setError((e as Error).message); }
  }
  if (!data) return <div className="page bl-page">{error ? <Notice tone="danger">{error}</Notice> : <Spinner label="Loading platform admin" />}</div>;
  const s = data.summary, shown = data.organizations.filter(o => !query || `${o.name} ${o.ownerEmail ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="page bl-page">
    <div className="bl-head"><div><h1>Platform admin</h1><p>Every school and organization on Ledgerly: plans, usage, payments and payment settings.</p></div><Button variant="secondary" onClick={() => void load()}><RefreshCw size={15} /> Refresh</Button></div>
    {error && <Notice tone="danger">{error}</Notice>}
    {notice && <Notice tone="success">{notice}</Notice>}
    {!data.paymentsConfigured && <Notice tone="warning">Mobile money is not configured yet. Add your Ssentezo API credentials under Payment settings so schools can pay.</Notice>}
    <div className="bl-tiles">
      <div><small>Organizations</small><b>{s.organizations}</b><span>{s.byPlan.free} free · {s.byPlan.standard} standard · {s.byPlan.premium} premium</span></div>
      <div><small>Active students</small><b>{s.students.toLocaleString()}</b><span>across all schools</span></div>
      <div><small>Billed</small><b>{ugx(s.billedUgx)}</b><span>all terms</span></div>
      <div><small>Collected</small><b className="bl-good-t">{ugx(s.paidUgx)}</b><span>{ugx(Math.max(0, s.billedUgx - s.paidUgx))} outstanding</span></div>
    </div>
    <div className="bl-tabs" role="tablist">
      {(["schools", "payments", "settings"] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>{t === "schools" ? "Schools & organizations" : t === "payments" ? "Payments" : "Payment settings"}</button>)}
    </div>

    {tab === "schools" && <section className="bl-card">
      <header><h2>Schools &amp; organizations</h2><input className="bl-search" placeholder="Search name or owner…" value={query} onChange={e => setQuery(e.target.value)} /></header>
      <div className="table-wrap"><table className="bl-table"><thead><tr><th>Organization</th><th>Plan</th><th>Status</th><th>Students</th><th>This term</th><th>Balance</th><th /></tr></thead>
        <tbody>{shown.map(o => <tr key={o.id}>
          <td><b>{o.name}</b><small className="bl-block">{o.ownerEmail ?? "No owner"} · {o.members} users · joined {date(o.createdAt)}</small></td>
          <td><select value={o.plan} onChange={e => void change(o, { plan: e.target.value as PlanKey })}>{PLANS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select></td>
          <td><select value={o.status} onChange={e => void change(o, { status: e.target.value as AdminOrg["status"] })}><option value="active">Active</option><option value="suspended">Suspended</option></select></td>
          <td>{o.activeStudents.toLocaleString()}</td>
          <td>{o.current ? <>{ugx(o.current.amountUgx)}<small className="bl-block">{o.period} · paid {ugx(o.current.paidUgx)}</small></> : <span className="bl-muted">Free</span>}</td>
          <td className={o.balanceUgx ? "bl-due" : ""}>{ugx(o.balanceUgx)}</td>
          <td>{o.current && <Button variant="secondary" onClick={() => setRecordFor(o)}>Record payment</Button>}</td>
        </tr>)}</tbody></table></div>
    </section>}

    {tab === "payments" && <section className="bl-card">
      <header><h2>Payments</h2></header>
      {!payments.length ? <p className="bl-muted">No payments yet.</p> : <div className="table-wrap"><table className="bl-table"><thead><tr><th>Date</th><th>Organization</th><th>Method</th><th>Amount</th><th>Status</th><th /></tr></thead>
        <tbody>{payments.map(p => <tr key={p.id}><td>{date(p.createdAt)}</td><td>{p.organizationName}</td><td>{p.provider === "manual" ? `Recorded${p.note ? ` · ${p.note}` : ""}` : `Mobile Money · ${p.msisdn?.replace(/^256/, "0") ?? ""}`}</td><td>{ugx(p.amountUgx)}</td><td><StatusChip value={p.status} />{p.failureReason && <small className="bl-err">{p.failureReason}</small>}</td>
          <td>{["pending", "indeterminate"].includes(p.status) && <Button variant="secondary" onClick={async () => { await post(`/platform/payments/${p.id}/refresh`, {}).catch(() => {}); void load(); }}>Check status</Button>}</td></tr>)}</tbody></table></div>}
    </section>}

    {tab === "settings" && <PaymentSettings onSaved={() => { setNotice("Payment settings saved."); void load(); }} />}

    {recordFor && <RecordPayment org={recordFor} onClose={() => setRecordFor(null)} onDone={() => { setRecordFor(null); setNotice("Payment recorded."); void load(); }} />}
  </div>;
}

function RecordPayment({ org, onClose, onDone }: { org: AdminOrg; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(org.current?.balanceUgx || "")), [note, setNote] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); setBusy(true); try { await post(`/platform/organizations/${org.id}/payments`, { amountUgx: Number(amount), note: note || undefined }); onDone(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }
  return <Modal title={`Record payment · ${org.name}`} onClose={onClose}><form onSubmit={submit} className="bl-form">
    {error && <Notice tone="danger">{error}</Notice>}
    <p className="bl-muted">For cash, bank or other payments received outside Ledgerly. Applied to {org.period}.</p>
    <Field label="Amount received (UGX)"><input required type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)} /></Field>
    <Field label="Note"><input placeholder="e.g. Bank deposit, Stanbic ref 12345" value={note} onChange={e => setNote(e.target.value)} /></Field>
    <div className="bl-actions"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record payment"}</Button><Button variant="secondary" onClick={onClose}>Cancel</Button></div>
  </form></Modal>;
}

function PaymentSettings({ onSaved }: { onSaved: () => void }) {
  const [s, setS] = useState<PaySettings | null>(null), [apiKey, setApiKey] = useState(""), [error, setError] = useState(""), [test, setTest] = useState(""), [busy, setBusy] = useState(false);
  const load = () => get<PaySettings>("/platform/payment-settings").then(x => setS({ ...x, publicUrl: x.publicUrl || location.origin })).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);
  async function save(e: FormEvent) {
    e.preventDefault(); if (!s) return; setBusy(true); setError(""); setTest("");
    try { await put("/platform/payment-settings", { environment: s.environment, apiUser: s.apiUser, apiKey: apiKey || undefined, publicUrl: s.publicUrl }); setApiKey(""); await load(); onSaved(); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function runTest() { setBusy(true); setError(""); setTest(""); try { const r = await post<{ environment: string; balance: string | null }>("/platform/payment-settings/test", {}); setTest(`Connected to Ssentezo ${r.environment}. Wallet balance: UGX ${r.balance ?? "—"}.`); } catch (err) { setError((err as Error).message); } finally { setBusy(false); } }
  if (!s) return error ? <Notice tone="danger">{error}</Notice> : <Spinner />;
  return <section className="bl-card bl-settings">
    <header><h2><KeyRound size={18} /> Ssentezo Wallet</h2>{s.configured ? <span className="bl-chip bl-good">Configured · {s.environment}</span> : <span className="bl-chip bl-bad">Not configured</span>}</header>
    <p className="bl-muted">Schools pay their Ledgerly subscription through these credentials. Generate them under <b>API Access</b> in your Ssentezo Wallet account. The API key is stored encrypted and is never shown again.</p>
    {error && <Notice tone="danger">{error}</Notice>}
    {test && <Notice tone="success">{test}</Notice>}
    <form onSubmit={save} className="bl-form">
      <Field label="Environment"><select value={s.environment} onChange={e => setS({ ...s, environment: e.target.value as PaySettings["environment"] })}><option value="sandbox">Sandbox (test money)</option><option value="live">Live (real money)</option></select></Field>
      <Field label="API user"><input required autoComplete="off" value={s.apiUser} onChange={e => setS({ ...s, apiUser: e.target.value })} /></Field>
      <Field label="API key"><input type="password" autoComplete="new-password" placeholder={s.hasApiKey ? "Saved: leave blank to keep the current key" : "Paste the API key"} value={apiKey} onChange={e => setApiKey(e.target.value)} /></Field>
      <Field label="Public Ledgerly address (for payment callbacks)"><input type="url" value={s.publicUrl} onChange={e => setS({ ...s, publicUrl: e.target.value })} /></Field>
      <div className="bl-actions"><Button type="submit" disabled={busy}>Save settings</Button><Button variant="secondary" onClick={runTest} disabled={busy || !s.configured}><PlugZap size={15} /> Test connection</Button></div>
    </form>
    {s.source === "server" && <p className="bl-muted"><CircleAlert size={14} /> Currently using credentials from the server configuration. Saving here overrides them.</p>}
  </section>;
}

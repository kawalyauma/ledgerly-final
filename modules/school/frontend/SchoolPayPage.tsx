import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, CreditCard, History, RefreshCw, RotateCcw, Send, Smartphone } from "lucide-react";
import { can, errorText, get, post } from "../../../web/api";
import { useAuth } from "../../../web/auth";
import { Badge, Button, Card, EmptyState, Field, Notice, SearchableSelect, Spinner } from "../../../web/components/ui";

type R = Record<string, any>;
type Intent = {
  id: string;
  studentPaymentCode: string;
  method: "register" | "request";
  eventType: "SCHOOL_FEES" | "OTHER_FEES";
  externalReference: string;
  paymentReference: string | null;
  amountMinor: number;
  phoneNumber: string | null;
  firstName: string;
  lastName: string;
  reason: string;
  status: "initiating" | "pending" | "paid" | "posting_failed" | "failed";
  providerStatus: string | null;
  receiptNumber: string | null;
  transactionId: string | null;
  channelName: string | null;
  error: string | null;
  lastCheckedAt?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  duplicate?: boolean;
};

type Student = { id: string; admissionNumber?: string; studentNumber?: string; firstName?: string; middleName?: string; lastName?: string };
type Tab = "collect" | "payments" | "events" | "reconciliation";

const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-UG", { maximumFractionDigits: 0 });
const when = (value: unknown) => value ? new Date(String(value)).toLocaleString("en-UG") : "—";
const nameOf = (student: Student) => [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ") || "Student";
const statusTone = (status: unknown): "success" | "warning" | "danger" | "neutral" => {
  const value = String(status || "").toLowerCase();
  if (["paid", "posted", "completed", "success"].includes(value)) return "success";
  if (["failed", "posting_failed", "rejected"].includes(value)) return "danger";
  if (["pending", "initiating", "processing"].includes(value)) return "warning";
  return "neutral";
};
const reference = (studentId: string) => `WEB-${Date.now()}-${studentId.slice(-8)}-${Math.random().toString(36).slice(2, 8)}`.slice(0, 250);

export function SchoolPayPage() {
  const { principal } = useAuth();
  const write = can(principal, "school:write");
  const [tab, setTab] = useState<Tab>("collect");
  const [students, setStudents] = useState<Student[]>([]);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [events, setEvents] = useState<R[]>([]);
  const [reconciliations, setReconciliations] = useState<R[]>([]);
  const [diagnostics, setDiagnostics] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [reason, setReason] = useState("School fees payment");
  const [eventType, setEventType] = useState<"SCHOOL_FEES" | "OTHER_FEES">("SCHOOL_FEES");
  const [method, setMethod] = useState<"request" | "register">("request");
  const [attemptReference, setAttemptReference] = useState("");
  const [reconcileDate, setReconcileDate] = useState(() => new Date().toISOString().slice(0, 10));

  const studentOptions = useMemo(() => students.map(student => ({
    value: student.id,
    label: `${student.admissionNumber || student.studentNumber || "No admission no."} · ${nameOf(student)}`,
    keywords: `${student.admissionNumber || ""} ${student.studentNumber || ""} ${nameOf(student)}`,
  })), [students]);

  const changePayment = (change: () => void) => { setAttemptReference(""); change(); };

  async function load() {
    setLoading(true); setError("");
    try {
      const [studentRows, paymentRows, eventRows, reconciliationRows, health] = await Promise.all([
        get<Student[]>("/school/student-management/students?status=active&limit=500"),
        get<Intent[]>("/schoolpay/adhoc?limit=100"),
        get<R[]>("/schoolpay/events?limit=100"),
        get<R[]>("/schoolpay/reconciliations?limit=50"),
        get<R>("/schoolpay/health"),
      ]);
      setStudents(studentRows); setIntents(paymentRows); setEvents(eventRows); setReconciliations(reconciliationRows); setDiagnostics(health);
    } catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!write) return;
    const wholeAmount = Number(amount.replaceAll(",", "").trim());
    if (!studentId) return setError("Select a student first.");
    if (!Number.isSafeInteger(wholeAmount) || wholeAmount <= 0) return setError("Enter a positive whole UGX amount.");
    if (!reason.trim()) return setError("Enter the payment reason.");
    if (method === "request" && phone.trim().length < 7) return setError("Enter the payer phone number for an instant debit request.");
    const externalReference = attemptReference || reference(studentId);
    if (!attemptReference) setAttemptReference(externalReference);
    setBusy(true); setError(""); setMessage("");
    try {
      const base = { studentPaymentCode: studentId, externalReference, amount: wholeAmount, reason: reason.trim(), eventType };
      const created = method === "request"
        ? await post<Intent>("/schoolpay/adhoc/request", { ...base, phoneNumber: phone.trim() })
        : await post<Intent>("/schoolpay/adhoc/register", base);
      setMessage(method === "request"
        ? `SchoolPay debit request sent${created.paymentReference ? ` · ${created.paymentReference}` : ""}. Confirm the prompt on the payer phone.`
        : `SchoolPay payment registered${created.paymentReference ? ` · ${created.paymentReference}` : ""}.`);
      setAmount(""); setAttemptReference("");
      await load();
      setTab("payments");
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  async function checkStatus(row: Intent) {
    if (!row.paymentReference || !write) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await get<R>(`/schoolpay/adhoc/${encodeURIComponent(row.paymentReference)}/status`);
      setMessage(`SchoolPay status: ${String(result.status || result.providerStatus || "checked").replaceAll("_", " ")}.`);
      await load();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  async function recoverPending() {
    if (!write) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await post<R>("/schoolpay/adhoc/recover", {});
      setMessage(`Recovery finished${result.checked != null ? ` · ${result.checked} checked` : ""}.`);
      await load();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  async function reconcile() {
    if (!write) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await post<R>("/schoolpay/reconcile", { fromDate: reconcileDate, toDate: reconcileDate });
      setMessage(`SchoolPay reconciliation completed for ${reconcileDate}.`);
      await load();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  return <div className="page">
    <div className="school-page-head"><div><span className="eyebrow">School management · payments</span><h1>SchoolPay</h1><p>Request, verify and reconcile SchoolPay collections against Ledgerly student fees.</p></div><div className="heading-actions"><Button variant="secondary" onClick={() => void load()} disabled={loading || busy}><RefreshCw size={16}/> Refresh</Button></div></div>

    {diagnostics && <Card><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><strong>SchoolPay connection</strong><p style={{margin:"4px 0 0"}}>Realtime collection, status checks and recovery are handled by the Node server.</p></div><Badge tone={diagnostics.ok === false || diagnostics.status === "error" ? "danger" : "success"}>{diagnostics.status || (diagnostics.ok === false ? "attention" : "connected")}</Badge></div></Card>}
    {error && <Notice tone="danger">{error}</Notice>}
    {message && <Notice tone="success">{message}</Notice>}

    <div className="heading-actions" style={{margin:"16px 0",justifyContent:"flex-start",flexWrap:"wrap"}}>
      <Button variant={tab === "collect" ? "primary" : "secondary"} onClick={() => setTab("collect")}><Smartphone size={16}/> Collect</Button>
      <Button variant={tab === "payments" ? "primary" : "secondary"} onClick={() => setTab("payments")}><CreditCard size={16}/> Payments</Button>
      <Button variant={tab === "events" ? "primary" : "secondary"} onClick={() => setTab("events")}><History size={16}/> Provider events</Button>
      <Button variant={tab === "reconciliation" ? "primary" : "secondary"} onClick={() => setTab("reconciliation")}><RotateCcw size={16}/> Reconciliation</Button>
    </div>

    {loading ? <Spinner label="Loading SchoolPay"/> : tab === "collect" ? <Card>
      <form onSubmit={submitPayment}>
        <div className="school-page-head" style={{marginBottom:16}}><div><h2>Collect with SchoolPay</h2><p>Instant debit sends a prompt to the payer phone. Register payment creates a SchoolPay reference without a phone debit prompt.</p></div></div>
        {!write && <Notice tone="warning">Your account can view SchoolPay activity but needs the school:write permission to initiate a collection.</Notice>}
        <div className="form-grid">
          <Field label="Student"><SearchableSelect value={studentId} onChange={value => changePayment(() => setStudentId(value))} options={studentOptions} placeholder="Select student…" searchPlaceholder="Search name or admission number" ariaLabel="Student"/></Field>
          <Field label="Amount (UGX)" hint="SchoolPay accepts whole Uganda shilling amounts."><input inputMode="numeric" value={amount} onChange={e => changePayment(() => setAmount(e.target.value.replace(/[^0-9]/g, "")))} placeholder="e.g. 150000"/></Field>
          <Field label="Collection method"><select value={method} onChange={e => changePayment(() => setMethod(e.target.value as "request" | "register"))}><option value="request">Instant debit request</option><option value="register">Register SchoolPay payment</option></select></Field>
          <Field label="Fee type"><select value={eventType} onChange={e => changePayment(() => setEventType(e.target.value as "SCHOOL_FEES" | "OTHER_FEES"))}><option value="SCHOOL_FEES">School fees</option><option value="OTHER_FEES">Other / supplementary fee</option></select></Field>
          {method === "request" && <Field label="Payer phone number" hint="Use the number that should receive the SchoolPay payment prompt."><input type="tel" value={phone} onChange={e => changePayment(() => setPhone(e.target.value))} placeholder="e.g. 0772 123 456"/></Field>}
          <Field label="Reason"><input value={reason} onChange={e => changePayment(() => setReason(e.target.value))} maxLength={500}/></Field>
        </div>
        <div className="heading-actions" style={{marginTop:16,justifyContent:"flex-start"}}><Button type="submit" disabled={!write || busy}>{method === "request" ? <><Send size={16}/> {busy ? "Sending…" : "Send debit request"}</> : <><CheckCircle2 size={16}/> {busy ? "Registering…" : "Register payment"}</>}</Button></div>
      </form>
    </Card> : tab === "payments" ? <Card>
      <div className="school-page-head"><div><h2>SchoolPay payments</h2><p>Latest initiated payments and their verified provider/posting status.</p></div>{write && <Button variant="secondary" onClick={() => void recoverPending()} disabled={busy}><RotateCcw size={16}/> Recover pending</Button>}</div>
      {!intents.length ? <EmptyState title="No SchoolPay payments yet" description="Initiated SchoolPay collections will appear here."/> : <div className="table-scroll"><table><thead><tr><th>Student</th><th>Reference</th><th>Amount</th><th>Method</th><th>Status</th><th>Receipt</th><th>Created</th><th></th></tr></thead><tbody>{intents.map(row => <tr key={row.id}><td><strong>{[row.firstName,row.lastName].filter(Boolean).join(" ") || row.studentPaymentCode}</strong><br/><small>{row.studentPaymentCode}</small></td><td>{row.paymentReference || row.externalReference}</td><td>UGX {fmt(row.amountMinor)}</td><td>{row.method === "request" ? "Instant debit" : "Registered"}</td><td><Badge tone={statusTone(row.status)}>{row.status.replaceAll("_", " ")}</Badge>{row.providerStatus && <><br/><small>{row.providerStatus}</small></>}</td><td>{row.receiptNumber || "—"}</td><td>{when(row.createdAt)}</td><td>{row.paymentReference && row.status !== "paid" && write ? <Button variant="ghost" onClick={() => void checkStatus(row)} disabled={busy}><RefreshCw size={14}/> Check</Button> : null}</td></tr>)}</tbody></table></div>}
    </Card> : tab === "events" ? <Card>
      <div className="school-page-head"><div><h2>Provider events</h2><p>Realtime SchoolPay callbacks and the resulting Ledgerly posting state.</p></div></div>
      {!events.length ? <EmptyState title="No SchoolPay events" description="Verified SchoolPay callbacks will appear here."/> : <div className="table-scroll"><table><thead><tr><th>Receipt / reference</th><th>Student</th><th>Amount</th><th>Status</th><th>Received</th></tr></thead><tbody>{events.map((row, index) => <tr key={row.id || index}><td>{row.schoolpayReceiptNumber || row.receiptNumber || row.paymentReference || row.id || "—"}</td><td>{row.studentName || row.studentPaymentCode || "—"}</td><td>{row.amountMinor != null ? `UGX ${fmt(row.amountMinor)}` : row.amount != null ? `UGX ${fmt(row.amount)}` : "—"}</td><td><Badge tone={statusTone(row.status || row.postingStatus)}>{String(row.status || row.postingStatus || "received").replaceAll("_", " ")}</Badge></td><td>{when(row.createdAt || row.receivedAt || row.paymentDateAndTime)}</td></tr>)}</tbody></table></div>}
    </Card> : <Card>
      <div className="school-page-head"><div><h2>Reconciliation</h2><p>Ask the Node server to compare SchoolPay transactions for a date and recover any payment missed by realtime callbacks.</p></div></div>
      <div className="form-grid"><Field label="Transaction date"><input type="date" value={reconcileDate} onChange={e => setReconcileDate(e.target.value)}/></Field></div>
      <div className="heading-actions" style={{margin:"12px 0",justifyContent:"flex-start"}}><Button onClick={() => void reconcile()} disabled={!write || busy}><RotateCcw size={16}/> {busy ? "Reconciling…" : "Reconcile date"}</Button></div>
      {!write && <Notice tone="warning">Reconciliation requires school:write permission.</Notice>}
      {!reconciliations.length ? <EmptyState title="No reconciliation runs" description="Completed SchoolPay reconciliation runs will appear here."/> : <div className="table-scroll"><table><thead><tr><th>Date / range</th><th>Status</th><th>Checked</th><th>Recovered</th><th>Created</th></tr></thead><tbody>{reconciliations.map((row,index) => <tr key={row.id || index}><td>{row.fromDate ? `${row.fromDate}${row.toDate && row.toDate !== row.fromDate ? ` → ${row.toDate}` : ""}` : row.date || "—"}</td><td><Badge tone={statusTone(row.status)}>{String(row.status || "completed").replaceAll("_", " ")}</Badge></td><td>{row.checked ?? row.transactionCount ?? "—"}</td><td>{row.recovered ?? row.imported ?? row.posted ?? "—"}</td><td>{when(row.createdAt || row.completedAt)}</td></tr>)}</tbody></table></div>}
    </Card>}
  </div>;
}

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Copy, CreditCard, History, RefreshCw, RotateCcw, Send, Settings2, Smartphone } from "lucide-react";
import { can, errorText, get, post, put } from "../../../web/api";
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
type SchoolPayConfig =
  | { configured: false }
  | {
      configured: true;
      schoolCode: string;
      bankAccountId: string;
      controlAccountId: string;
      importStartDate: string;
      enabled: boolean;
      autoAllocate: boolean;
      webhookPath: string;
      lastWebhookAt: string | null;
      lastReconciledAt: string | null;
    };
type Tab = "configuration" | "collect" | "payments" | "events" | "reconciliation";

const fmt = (value: unknown) => Number(value || 0).toLocaleString("en-UG", { maximumFractionDigits: 0 });
const when = (value: unknown) => value ? new Date(String(value)).toLocaleString("en-UG") : "—";
const today = () => new Date().toISOString().slice(0, 10);
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
  const [tab, setTab] = useState<Tab>("configuration");
  const [config, setConfig] = useState<SchoolPayConfig | null>(null);
  const [configSchoolCode, setConfigSchoolCode] = useState("");
  const [configApiPassword, setConfigApiPassword] = useState("");
  const [configBankAccountId, setConfigBankAccountId] = useState("");
  const [configControlAccountId, setConfigControlAccountId] = useState("");
  const [configImportStartDate, setConfigImportStartDate] = useState(today);
  const [configEnabled, setConfigEnabled] = useState(true);
  const [configAutoAllocate, setConfigAutoAllocate] = useState(true);
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
  const [reconcileDate, setReconcileDate] = useState(today);

  const studentOptions = useMemo(() => students.map(student => ({
    value: student.id,
    label: `${student.admissionNumber || student.studentNumber || "No admission no."} · ${nameOf(student)}`,
    keywords: `${student.admissionNumber || ""} ${student.studentNumber || ""} ${nameOf(student)}`,
  })), [students]);

  const webhookUrl = useMemo(() => {
    if (!config?.configured || !config.webhookPath) return "";
    if (typeof window === "undefined") return config.webhookPath;
    try { return new URL(config.webhookPath, window.location.origin).toString(); }
    catch { return config.webhookPath; }
  }, [config]);

  const changePayment = (change: () => void) => { setAttemptReference(""); change(); };

  async function load() {
    setLoading(true); setError("");
    try {
      const [configRow, studentRows, paymentRows, eventRows, reconciliationRows, health] = await Promise.all([
        get<SchoolPayConfig>("/schoolpay/config"),
        get<Student[]>("/school/student-management/students?status=active&limit=500"),
        get<Intent[]>("/schoolpay/adhoc?limit=100"),
        get<R[]>("/schoolpay/events?limit=100"),
        get<R[]>("/schoolpay/reconciliations?limit=50"),
        get<R>("/schoolpay/health"),
      ]);
      setConfig(configRow);
      if (configRow.configured) {
        setConfigSchoolCode(configRow.schoolCode);
        setConfigBankAccountId(configRow.bankAccountId);
        setConfigControlAccountId(configRow.controlAccountId);
        setConfigImportStartDate(configRow.importStartDate);
        setConfigEnabled(configRow.enabled);
        setConfigAutoAllocate(configRow.autoAllocate);
        setReconcileDate(current => current < configRow.importStartDate ? configRow.importStartDate : current);
      } else {
        setConfigSchoolCode("");
        setConfigBankAccountId("");
        setConfigControlAccountId("");
        setConfigImportStartDate(today());
        setConfigEnabled(true);
        setConfigAutoAllocate(true);
      }
      setConfigApiPassword("");
      setStudents(studentRows); setIntents(paymentRows); setEvents(eventRows); setReconciliations(reconciliationRows); setDiagnostics(health);
    } catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function saveConfiguration(event: FormEvent) {
    event.preventDefault();
    if (!write) return;
    if (!configSchoolCode.trim()) return setError("Enter the SchoolPay school code.");
    if (!configApiPassword.trim()) return setError("Enter the SchoolPay API password / token. The saved secret is never returned to the web app.");
    if (!configBankAccountId.trim()) return setError("Enter the Ledgerly cash/bank posting account ID.");
    if (!configControlAccountId.trim()) return setError("Enter the Ledgerly fees receivable control account ID.");
    if (!configImportStartDate) return setError("Choose the SchoolPay Go-Live / Import Start Date.");
    setBusy(true); setError(""); setMessage("");
    try {
      const configured = await put<SchoolPayConfig>("/schoolpay/config", {
        schoolCode: configSchoolCode.trim(),
        apiPassword: configApiPassword.trim(),
        bankAccountId: configBankAccountId.trim(),
        controlAccountId: configControlAccountId.trim(),
        importStartDate: configImportStartDate,
        enabled: configEnabled,
        autoAllocate: configAutoAllocate,
      });
      setConfig(configured);
      setConfigApiPassword("");
      setReconcileDate(current => configured.configured && current < configured.importStartDate ? configured.importStartDate : current);
      setMessage("SchoolPay configuration saved. Transactions before the import start date are protected from posting, and the API secret was encrypted and cleared from this form.");
      setDiagnostics(await get<R>("/schoolpay/health"));
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  async function copyWebhook() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setMessage("SchoolPay webhook URL copied.");
      setError("");
    } catch {
      setError("Could not copy the webhook automatically. Select the URL and copy it manually.");
    }
  }

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
    if (config?.configured && reconcileDate < config.importStartDate) {
      return setError(`Reconciliation cannot run before the SchoolPay import start date ${config.importStartDate}.`);
    }
    setBusy(true); setError(""); setMessage("");
    try {
      await post<R>("/schoolpay/reconcile", { fromDate: reconcileDate, toDate: reconcileDate });
      setMessage(`SchoolPay reconciliation completed for ${reconcileDate}.`);
      await load();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }

  return <div className="page">
    <div className="school-page-head"><div><span className="eyebrow">School management · payments</span><h1>SchoolPay</h1><p>Configure this school's SchoolPay connection, then request, verify and reconcile collections against Ledgerly student fees.</p></div><div className="heading-actions"><Button variant="secondary" onClick={() => void load()} disabled={loading || busy}><RefreshCw size={16}/> Refresh</Button></div></div>

    {diagnostics && <Card><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><strong>SchoolPay connection</strong><p style={{margin:"4px 0 0"}}>Realtime collection, status checks and recovery are handled by the Node server.</p></div><Badge tone={diagnostics.ok === false || diagnostics.status === "error" ? "danger" : "success"}>{diagnostics.status || (diagnostics.ok === false ? "attention" : "connected")}</Badge></div></Card>}
    {error && <Notice tone="danger">{error}</Notice>}
    {message && <Notice tone="success">{message}</Notice>}

    <div className="heading-actions" style={{margin:"16px 0",justifyContent:"flex-start",flexWrap:"wrap"}}>
      <Button variant={tab === "configuration" ? "primary" : "secondary"} onClick={() => setTab("configuration")}><Settings2 size={16}/> Configuration</Button>
      <Button variant={tab === "collect" ? "primary" : "secondary"} onClick={() => setTab("collect")}><Smartphone size={16}/> Collect</Button>
      <Button variant={tab === "payments" ? "primary" : "secondary"} onClick={() => setTab("payments")}><CreditCard size={16}/> Payments</Button>
      <Button variant={tab === "events" ? "primary" : "secondary"} onClick={() => setTab("events")}><History size={16}/> Provider events</Button>
      <Button variant={tab === "reconciliation" ? "primary" : "secondary"} onClick={() => setTab("reconciliation")}><RotateCcw size={16}/> Reconciliation</Button>
    </div>

    {loading ? <Spinner label="Loading SchoolPay"/> : tab === "configuration" ? <Card>
      <form onSubmit={saveConfiguration}>
        <div className="school-page-head" style={{marginBottom:16}}><div><h2>SchoolPay configuration</h2><p>Each school keeps its own SchoolPay code, encrypted API secret, Ledgerly posting accounts, import boundary and unique webhook.</p></div><Badge tone={config?.configured && config.enabled ? "success" : "warning"}>{config?.configured ? (config.enabled ? "enabled" : "configured · disabled") : "not configured"}</Badge></div>
        {!write && <Notice tone="warning">You can view the SchoolPay configuration, but school:write permission is required to change it.</Notice>}
        <div className="form-grid">
          <Field label="SchoolPay school code" hint="Use the school code issued by SchoolPay."><input value={configSchoolCode} onChange={e => setConfigSchoolCode(e.target.value)} placeholder="SchoolPay school code" disabled={!write}/></Field>
          <Field label="API password / token" hint={config?.configured ? "For security the stored secret is never returned. Re-enter it whenever you save configuration changes." : "The backend encrypts this secret before storing it."}><input type="password" autoComplete="new-password" value={configApiPassword} onChange={e => setConfigApiPassword(e.target.value)} placeholder={config?.configured ? "Re-enter secret to save changes" : "SchoolPay API password / token"} disabled={!write}/></Field>
          <Field label="Ledgerly cash / bank account ID" hint="Must be an active cash posting account belonging to this school."><input value={configBankAccountId} onChange={e => setConfigBankAccountId(e.target.value)} placeholder="Account receiving SchoolPay collections" disabled={!write}/></Field>
          <Field label="Fees receivable control account ID" hint="Must be an active receivable posting account belonging to this school."><input value={configControlAccountId} onChange={e => setConfigControlAccountId(e.target.value)} placeholder="School fees receivable account" disabled={!write}/></Field>
          <Field label="SchoolPay Go-Live / Import Start Date" hint="Choose the first date Ledgerly should accept SchoolPay transactions. Earlier dates are treated as historical and will not be posted."><input type="date" value={configImportStartDate} onChange={e => setConfigImportStartDate(e.target.value)} disabled={!write}/></Field>
          <Field label="Integration status"><select value={configEnabled ? "enabled" : "disabled"} onChange={e => setConfigEnabled(e.target.value === "enabled")} disabled={!write}><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></Field>
          <Field label="Matched payment allocation"><select value={configAutoAllocate ? "automatic" : "manual"} onChange={e => setConfigAutoAllocate(e.target.value === "automatic")} disabled={!write}><option value="automatic">Automatically allocate to student fees</option><option value="manual">Keep matched payments for manual allocation</option></select></Field>
        </div>

        <Notice tone="warning">Historical transaction protection: set the import start date to the first SchoolPay transaction date that was not already covered by your migrated Ledgerly transactions. Reconciliation, callbacks and retries dated before it are blocked from posting.</Notice>

        <div style={{marginTop:16,padding:16,border:"1px solid var(--border)",borderRadius:16}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><strong>School-specific webhook</strong><p style={{margin:"4px 0 0"}}>Save the configuration first, then copy this exact URL into SchoolPay's webhook/callback settings.</p></div>{config?.configured && <Badge tone="success">generated</Badge>}</div>
          {webhookUrl ? <div style={{display:"flex",gap:8,alignItems:"center",marginTop:12,flexWrap:"wrap"}}><input readOnly value={webhookUrl} style={{flex:"1 1 440px"}}/><Button type="button" variant="secondary" onClick={() => void copyWebhook()}><Copy size={16}/> Copy webhook</Button></div> : <p style={{margin:"12px 0 0"}}>No webhook yet. Save this school's SchoolPay configuration to generate one.</p>}
          {config?.configured && <p style={{margin:"10px 0 0"}}><small>Import starts: {config.importStartDate} · Last webhook: {when(config.lastWebhookAt)} · Last reconciliation: {when(config.lastReconciledAt)}</small></p>}
        </div>

        <p style={{margin:"14px 0 0"}}><small>The SchoolPay API password/token is write-only in the web interface. Ledgerly encrypts it server-side and never returns the stored value to the browser.</small></p>
        <div className="heading-actions" style={{marginTop:16,justifyContent:"flex-start"}}><Button type="submit" disabled={!write || busy}><CheckCircle2 size={16}/> {busy ? "Saving…" : config?.configured ? "Save configuration" : "Configure SchoolPay"}</Button></div>
      </form>
    </Card> : tab === "collect" ? <Card>
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
      {config?.configured && <Notice tone="warning">Historical protection is active. Ledgerly will not reconcile or post SchoolPay transactions before {config.importStartDate}.</Notice>}
      <div className="form-grid"><Field label="Transaction date" hint={config?.configured ? `Import starts ${config.importStartDate}. Earlier dates are blocked.` : undefined}><input type="date" min={config?.configured ? config.importStartDate : undefined} value={reconcileDate} onChange={e => setReconcileDate(e.target.value)}/></Field></div>
      <div className="heading-actions" style={{margin:"12px 0",justifyContent:"flex-start"}}><Button onClick={() => void reconcile()} disabled={!write || busy}><RotateCcw size={16}/> {busy ? "Reconciling…" : "Reconcile date"}</Button></div>
      {!write && <Notice tone="warning">Reconciliation requires school:write permission.</Notice>}
      {!reconciliations.length ? <EmptyState title="No reconciliation runs" description="Completed SchoolPay reconciliation runs will appear here."/> : <div className="table-scroll"><table><thead><tr><th>Date / range</th><th>Status</th><th>Checked</th><th>Recovered</th><th>Created</th></tr></thead><tbody>{reconciliations.map((row,index) => <tr key={row.id || index}><td>{row.fromDate ? `${row.fromDate}${row.toDate && row.toDate !== row.fromDate ? ` → ${row.toDate}` : ""}` : row.date || "—"}</td><td><Badge tone={statusTone(row.status)}>{String(row.status || "completed").replaceAll("_", " ")}</Badge></td><td>{row.checked ?? row.transactionCount ?? "—"}</td><td>{row.recovered ?? row.imported ?? row.posted ?? "—"}</td><td>{when(row.createdAt || row.completedAt)}</td></tr>)}</tbody></table></div>}
    </Card>}
  </div>;
}

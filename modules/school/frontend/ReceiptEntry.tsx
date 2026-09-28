import { useEffect, useRef, useState } from "react";
import { get } from "../../../web/api";
import "./receipt-entry.css";

type Balance = { billedMinor: number; paidMinor: number; creditedMinor: number; balanceMinor: number; openInvoices: number };
const fmt = (minor: number) => Math.round(minor / 100).toLocaleString("en-UG");

/** Learner's current fee position on the receipt form, with a live "after this payment" preview. */
export function StudentBalancePanel({ studentId, amountMinor, onPayBalance }: { studentId: string; amountMinor: number; onPayBalance: (minor: number) => void }) {
  const [data, setData] = useState<Balance | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!studentId) { setData(null); return; }
    let live = true; setLoading(true); setError("");
    get<Balance>(`/school/fees/students/${studentId}/balance`).then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [studentId]);
  if (!studentId) return <div className="rx-balance rx-balance-empty">Choose a learner to see their fee balance.</div>;
  if (loading && !data) return <div className="rx-balance rx-balance-empty">Checking balance…</div>;
  if (error) return <div className="rx-balance rx-balance-empty">Balance unavailable: {error}</div>;
  if (!data) return null;
  const owes = data.balanceMinor > 0, after = data.balanceMinor - amountMinor;
  return <div className={`rx-balance ${owes ? "owes" : "clear"}`} aria-live="polite">
    <div className="rx-balance-main">
      <span>Current balance</span>
      <b>UGX {fmt(Math.abs(data.balanceMinor))}{data.balanceMinor < 0 ? " credit" : ""}</b>
      <small>{owes ? `${data.openInvoices} open invoice${data.openInvoices === 1 ? "" : "s"}` : data.balanceMinor < 0 ? "Learner has a credit" : "Fully paid"}</small>
    </div>
    <dl>
      <div><dt>Billed</dt><dd>{fmt(data.billedMinor)}</dd></div>
      <div><dt>Paid</dt><dd>{fmt(data.paidMinor)}</dd></div>
      <div><dt>Credits &amp; bursaries</dt><dd>{fmt(data.creditedMinor)}</dd></div>
    </dl>
    {amountMinor > 0 && <p className={`rx-after ${after > 0 ? "owes" : "clear"}`}>After this payment: <b>UGX {fmt(Math.abs(after))}{after < 0 ? " credit" : after === 0 ? " · cleared" : " remaining"}</b></p>}
    {owes && <button type="button" className="rx-fill" onClick={() => onPayBalance(data.balanceMinor)}>Pay full balance (UGX {fmt(data.balanceMinor)})</button>}
  </div>;
}

/**
 * Amount entry drawn as one box per digit, grouped in thousands. A transparent input sits on
 * top so typing, pasting, backspace and mobile number keyboards all work normally.
 */
export function AmountBoxes({ value, onChange, currency = "UGX", maxDigits = 11, label = "Amount" }: { value: string; onChange: (digits: string) => void; currency?: string; maxDigits?: number; label?: string }) {
  const ref = useRef<HTMLInputElement>(null), [focused, setFocused] = useState(false);
  const digits = String(value || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, maxDigits);
  const cells = digits.split("");
  // Group from the right: a gap before every block of three digits.
  const groupStart = (i: number) => i > 0 && (cells.length - i) % 3 === 0;
  return <div className={`rx-amount ${focused ? "focused" : ""}`} onClick={() => ref.current?.focus()}>
    <span className="rx-currency">{currency}</span>
    <div className="rx-cells" aria-hidden="true">
      {cells.length === 0 && !focused && <span className="rx-cell rx-placeholder">0</span>}
      {cells.map((d, i) => <span key={i} className={`rx-cell ${groupStart(i) ? "group" : ""}`}>{d}</span>)}
      {focused && cells.length < maxDigits && <span className={`rx-cell rx-caret ${cells.length && cells.length % 3 === 0 ? "group" : ""}`} />}
    </div>
    <input ref={ref} className="rx-input" aria-label={`${label} in ${currency}`} inputMode="numeric" autoComplete="off" required
      value={digits} onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, maxDigits))}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} pattern="[1-9][0-9]*" title="Enter the amount in whole shillings" />
    {digits && <span className="rx-words">{Number(digits).toLocaleString("en-UG")}</span>}
  </div>;
}

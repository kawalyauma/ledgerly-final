import { useEffect, useState } from "react";
import { BadgeCheck, CircleX, Loader2 } from "lucide-react";
import "./landing.css";

type Result = { valid: boolean; school?: string; receiptNumber?: string; paymentDate?: string; amount?: string; student?: string; status?: string };

/** Public page behind the QR code printed on school fee receipts. */
export function ReceiptVerifyPage({ token }: { token: string }) {
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    fetch(`/api/public/receipts/verify/${encodeURIComponent(token)}`)
      .then(r => r.json()).then(p => setResult(p.data ?? { valid: false }))
      .catch(() => setResult({ valid: false }));
  }, [token]);
  const genuine = result?.valid && result.status === "posted";
  return <div className="lx lx-verify">
    <header className="lx-nav"><a className="lx-logo" href="#"><span className="lx-mark">L</span>ledgerly</a></header>
    <main className="lx-verify-card">
      {!result ? <p className="lx-verify-wait"><Loader2 size={20} /> Checking receipt…</p>
        : genuine ? <>
          <BadgeCheck size={44} className="lx-verify-ok" />
          <h1>Genuine receipt</h1>
          <p>This receipt was issued by <b>{result.school}</b> through Ledgerly.</p>
          <dl>
            <div><dt>Receipt no.</dt><dd>{result.receiptNumber}</dd></div>
            <div><dt>Student</dt><dd>{result.student}</dd></div>
            <div><dt>Amount</dt><dd>{result.amount}</dd></div>
            <div><dt>Payment date</dt><dd>{result.paymentDate}</dd></div>
          </dl>
          <small>Check that these details match the printed receipt exactly.</small>
        </> : <>
          <CircleX size={44} className="lx-verify-bad" />
          <h1>{result.valid ? "Receipt not valid" : "Receipt not found"}</h1>
          <p>{result.valid ? `This receipt from ${result.school} has been ${result.status}. Contact the school's bursar.` : "We could not match this code to a receipt issued through Ledgerly. Contact the school's bursar before accepting it."}</p>
        </>}
    </main>
  </div>;
}

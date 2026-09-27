import { useState, type ElementType, type ReactNode } from "react";
import {
  ArrowRight, BarChart3, BookOpenCheck, Check, ChevronDown, ClipboardList, FileText, GraduationCap, Landmark,
  MessageSquareMore, Printer, ReceiptText, ScanFace, ShieldCheck, Smartphone, Sparkles, UsersRound, Wallet,
} from "lucide-react";
import { PLANS, ugx } from "../plans";
import "./landing.css";

const img = (name: string) => `/landing/${name}.jpg`;
const go = (hash: string) => { location.hash = hash; };
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

type Tab = { key: string; label: string; title: string; text: string; points: string[]; photo: string; card: ReactNode };
const TABS: Tab[] = [
  { key: "fees", label: "Fees & billing", title: "Every shilling billed, received and accounted for",
    text: "Set fee structures once, bill whole classes in a click and issue numbered receipts. Balances, defaulters and collections update the moment money comes in.",
    points: ["Fee structures, discounts & bursaries", "Receipts, refunds and payment plans", "Balances, defaulters & statements per student"], photo: "office-mobile-money",
    card: <div className="lx-ui"><div className="lx-ui-head"><ReceiptText size={16} /> Receipt RCT-000482</div><div className="lx-ui-row"><span>Nakato Grace · P.5 East</span><b>UGX 450,000</b></div><div className="lx-ui-row muted"><span>Term 3 tuition</span><span className="lx-ok">Paid</span></div><div className="lx-ui-bar"><span style={{ width: "72%" }} /></div><small>Class collection · 72% of term billed</small></div> },
  { key: "exams", label: "Examinations", title: "From marks entry to report cards, without the spreadsheets",
    text: "Teachers enter marks per class and subject. Ledgerly grades, ranks and works out aggregates and divisions, then prints report cards for the whole class.",
    points: ["Exam cycles, subjects & grading scales", "Aggregates, divisions & class positions", "Printable report cards & marksheets"], photo: "student-exam",
    card: <div className="lx-ui"><div className="lx-ui-head"><ClipboardList size={16} /> End of Term · P.7 East</div><div className="lx-ui-row"><span>Mathematics</span><b>D1 · 86</b></div><div className="lx-ui-row"><span>English</span><b>D2 · 78</b></div><div className="lx-ui-row"><span>Aggregate</span><b className="lx-accent">8 · Division 1</b></div></div> },
  { key: "attendance", label: "Attendance", title: "Know who is in school, every morning",
    text: "Mark class registers on the web or check students and staff in at an Android kiosk. Absences and late arrivals roll into daily and termly reports.",
    points: ["Student & staff registers", "Android kiosk check-in with offline sync", "Corrections, exceptions & reports"], photo: "students-compound",
    card: <div className="lx-ui"><div className="lx-ui-head"><ScanFace size={16} /> Today's attendance</div><div className="lx-ui-stats"><div><b>412</b><small>Present</small></div><div><b>9</b><small>Late</small></div><div><b>14</b><small>Absent</small></div></div></div> },
  { key: "messages", label: "Parent messages", title: "Keep parents informed by SMS and WhatsApp",
    text: "Send fee reminders, results and notices to the right parents straight from your records, with a delivery history for every message.",
    points: ["Fee balance reminders by class or term", "Results and attendance notices", "Delivery history for every send"], photo: "girls-books",
    card: <div className="lx-ui"><div className="lx-ui-head"><MessageSquareMore size={16} /> Fee reminder · Term 3</div><p className="lx-ui-msg">Dear parent, Grace's school fees balance is UGX 150,000. Thank you.</p><div className="lx-ui-row muted"><span>Sent to 128 parents</span><span className="lx-ok">Delivered</span></div></div> },
  { key: "accounting", label: "Accounting", title: "Proper books behind every receipt",
    text: "Fees, expenses, payroll and banking post into a real chart of accounts, so the bursar and the director see the same numbers.",
    points: ["Chart of accounts, journals & banking", "Expenses, suppliers & budgets", "Income statements & balance sheets"], photo: "teacher-board",
    card: <div className="lx-ui"><div className="lx-ui-head"><Landmark size={16} /> Income vs expenses</div><div className="lx-ui-chart">{[40, 62, 35, 70, 52, 84].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}</div><small>Last 6 months · updated automatically</small></div> },
];

const MODULES: Array<{ icon: ElementType; name: string; text: string }> = [
  { icon: BarChart3, name: "Dashboard", text: "Enrolment, collections, balances and income at a glance, with no setup." },
  { icon: GraduationCap, name: "Students & admissions", text: "Applications, admissions, class lists, promotions and discipline records." },
  { icon: Wallet, name: "Fees & billing", text: "Structures, billing, receipts, bursaries and balances for every student." },
  { icon: ClipboardList, name: "Examinations", text: "Marks, grading, divisions and report cards." },
  { icon: ScanFace, name: "Attendance", text: "Registers and kiosk check-in for students and staff." },
  { icon: MessageSquareMore, name: "Parent messages", text: "SMS and WhatsApp reminders, results and notices to parents." },
  { icon: BookOpenCheck, name: "Academics", text: "Schemes of work, lesson plans, timetables and supervision." },
  { icon: UsersRound, name: "HR & payroll", text: "Staff records, payroll runs, payslips and statutory deductions." },
  { icon: Landmark, name: "Accounting & banking", text: "Journals, expenses, banking, inventory and financial reports." },
  { icon: FileText, name: "Documents", text: "School files and letters stored and shared securely." },
  { icon: Printer, name: "Printerly", text: "Print and scan management across the school's printers." },
  { icon: Sparkles, name: "Ledgerly AI", text: "Ask questions about your school's data and automate routine work." },
];

const FAQ = [
  { q: "What is Ledgerly?", a: "Ledgerly is online school management and accounting software. It keeps students, fees, examinations, attendance and your school's books in one system that the whole team can use." },
  { q: "How much does it cost?", a: "The Free plan costs nothing for any number of students. Standard is UGX 2,000 and Premium is UGX 4,000 per active student, per term. A school of 300 students on Standard pays UGX 600,000 a term." },
  { q: "Which plan should our school choose?", a: "Start on Free to run admissions, fees and exams. Move to Standard when you want attendance, parent SMS, full accounting and payroll, and to Premium for Ledgerly AI, print management and security cameras." },
  { q: "How do we pay?", a: "From inside Ledgerly with MTN or Airtel Mobile Money. The bursar enters a phone number, approves the prompt with their PIN, and the payment is applied immediately." },
  { q: "Can we bring our existing records?", a: "Yes. Import students and opening fee balances from Excel, then carry on from where your old system stopped." },
  { q: "Is our data safe?", a: "Each school's data is kept separate and only people you invite can see it. Roles control who can view or change fees, marks and accounts. Your data stays yours whichever plan you are on." },
  { q: "Can we change plans later?", a: "Yes. Upgrading unlocks the extra modules straight away, and all your records stay in place." },
];

export function LandingPage() {
  const [tab, setTab] = useState(TABS[0]!.key);
  const [students, setStudents] = useState(300);
  const active = TABS.find(t => t.key === tab)!;
  return <div className="lx">
    <div className="lx-offer">
      <span><b>Start free.</b> Dashboard, School and Examinations cost nothing, for any number of students.</span>
      <button onClick={() => go("signup")}>Create your school</button>
    </div>

    <header className="lx-nav">
      <a className="lx-logo" href="#" onClick={e => { e.preventDefault(); scrollTo("lx-top"); }}><span className="lx-mark">L</span>ledgerly</a>
      <nav aria-label="Main">
        <button onClick={() => scrollTo("lx-features")}>Features</button>
        <button onClick={() => scrollTo("lx-modules")}>Modules</button>
        <button onClick={() => scrollTo("lx-pricing")}>Plans &amp; pricing</button>
        <button onClick={() => scrollTo("lx-faq")}>FAQs</button>
      </nav>
      <div className="lx-nav-cta">
        <button className="lx-signin" onClick={() => go("login")}>Sign in</button>
        <button className="lx-btn" onClick={() => go("signup")}>Get started</button>
      </div>
    </header>

    <section className="lx-hero" id="lx-top">
      <div className="lx-hero-copy">
        <h1>School office work, done right.</h1>
        <p>Admissions, fees, examinations and accounts in one place, so your bursar, teachers and head teacher always work from the same numbers.</p>
        <div className="lx-hero-cta">
          <button className="lx-btn lx-btn-lg" onClick={() => scrollTo("lx-pricing")}>See plans &amp; pricing</button>
          <button className="lx-btn-outline lx-btn-lg" onClick={() => go("signup")}>Start free <ArrowRight size={16} /></button>
        </div>
        <ul className="lx-hero-points"><li><Check size={16} /> Free plan for any size of school</li><li><Check size={16} /> Pay by Mobile Money</li><li><Check size={16} /> Import from Excel</li></ul>
      </div>
      <div className="lx-hero-visual">
        <img src={img("hero-classroom")} alt="Students reading in a classroom" />
        <div className="lx-float lx-float-a"><span className="lx-float-icon"><ReceiptText size={16} /></span><div><small>Fees received today</small><b>UGX 3,450,000</b></div></div>
        <div className="lx-float lx-float-b"><span className="lx-float-icon"><ClipboardList size={16} /></span><div><small>Report cards</small><b>P.7 East · ready to print</b></div></div>
        <div className="lx-float lx-float-c"><div className="lx-mini-chart">{[30, 48, 42, 60, 55, 78, 70].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}</div><small>Collections this term</small></div>
      </div>
    </section>

    <section className="lx-strip">
      <div><ShieldCheck size={20} /><span>Each school's data kept separate and secure</span></div>
      <div><Smartphone size={20} /><span>MTN &amp; Airtel Mobile Money</span></div>
      <div><UsersRound size={20} /><span>Unlimited users on every plan</span></div>
      <div><GraduationCap size={20} /><span>Made for schools in Uganda</span></div>
    </section>

    <section className="lx-section" id="lx-features">
      <div className="lx-section-head"><h2>Run more than just your fees</h2><p>The work of a school office, connected. Pick an area to see how it works.</p></div>
      <div className="lx-tabs" role="tablist">{TABS.map(t => <button key={t.key} role="tab" aria-selected={t.key === tab} className={t.key === tab ? "active" : ""} onClick={() => setTab(t.key)}>{t.label}</button>)}</div>
      <div className="lx-tab-panel" role="tabpanel">
        <div className="lx-tab-copy">
          <span className="lx-eyebrow">{active.label}</span>
          <h3>{active.title}</h3>
          <p>{active.text}</p>
          <ul>{active.points.map(p => <li key={p}><Check size={16} />{p}</li>)}</ul>
          <button className="lx-link" onClick={() => go("signup")}>Try it free <ArrowRight size={15} /></button>
        </div>
        <div className="lx-tab-visual"><img src={img(active.photo)} alt="" />{active.card}</div>
      </div>
    </section>

    <section className="lx-section lx-modules" id="lx-modules">
      <div className="lx-modules-grid">
        <div className="lx-modules-photo"><img src={img("teacher-board")} alt="A teacher explaining a lesson at the front of a classroom" /></div>
        <div>
          <div className="lx-section-head left"><h2>All new. All in one place.</h2><p>Turn modules on as your school grows. Everyone signs in to the same Ledgerly.</p></div>
          <ul className="lx-module-list">{MODULES.map(m => { const Icon = m.icon; return <li key={m.name}><span><Icon size={18} /></span><div><b>{m.name}</b><small>{m.text}</small></div></li>; })}</ul>
        </div>
      </div>
    </section>

    <section className="lx-section lx-pricing" id="lx-pricing">
      <div className="lx-section-head"><h2>Find a plan that's right for your school</h2><p>Priced per active student, per term. No contract, change plans any time.</p></div>
      <div className="lx-calc">
        <label htmlFor="lx-students">Number of students</label>
        <input id="lx-students" type="range" min={50} max={2000} step={10} value={students} onChange={e => setStudents(Number(e.target.value))} />
        <output>{students.toLocaleString()}</output>
      </div>
      <div className="lx-plans">{PLANS.map(plan => <article key={plan.key} className={plan.highlight ? "featured" : ""}>
        {plan.highlight && <span className="lx-ribbon">Most popular</span>}
        <h3>{plan.name}</h3>
        <p className="lx-plan-tag">{plan.tagline}</p>
        <div className="lx-plan-price">{plan.rateUgx ? <><b>{ugx(plan.rateUgx)}</b><span>/student/term</span></> : <><b>UGX 0</b><span>/forever</span></>}</div>
        <p className="lx-plan-total">{plan.rateUgx ? <>{ugx(plan.rateUgx * students)} per term for {students.toLocaleString()} students</> : <>No charge for any number of students</>}</p>
        <button className={plan.highlight ? "lx-btn" : "lx-btn-outline"} onClick={() => go("signup")}>{plan.rateUgx ? "Get started" : "Start free"}</button>
        <ul>{plan.features.map(f => <li key={f}><Check size={16} />{f}</li>)}</ul>
      </article>)}</div>
      <p className="lx-fineprint">Prices in Uganda shillings. Paid plans are billed each term on the highest number of active students during that term.</p>
    </section>

    <section className="lx-band">
      <img src={img("students-compound")} alt="Secondary school students on their school compound" />
      <div className="lx-band-copy">
        <h2>Built for how Ugandan schools work</h2>
        <ul>
          <li><Check size={18} /> Terms, streams, divisions and aggregates the way your school already uses them</li>
          <li><Check size={18} /> Uganda shillings, Mobile Money and SchoolPay-ready fee collection</li>
          <li><Check size={18} /> Parent messages by SMS and WhatsApp</li>
        </ul>
        <button className="lx-btn lx-btn-lg" onClick={() => go("signup")}>Create your school free</button>
      </div>
    </section>

    <section className="lx-section lx-faq" id="lx-faq">
      <div className="lx-section-head"><h2>FAQs</h2></div>
      <div className="lx-faq-list">{FAQ.map(f => <details key={f.q}><summary>{f.q}<ChevronDown size={18} /></summary><p>{f.a}</p></details>)}</div>
    </section>

    <footer className="lx-footer">
      <div className="lx-footer-cols">
        <div><a className="lx-logo lx-logo-light" href="#" onClick={e => { e.preventDefault(); scrollTo("lx-top"); }}><span className="lx-mark">L</span>ledgerly</a><p>School management and accounting for schools in Uganda.</p></div>
        <div><h4>Product</h4><button onClick={() => scrollTo("lx-features")}>Features</button><button onClick={() => scrollTo("lx-modules")}>Modules</button><button onClick={() => scrollTo("lx-pricing")}>Plans &amp; pricing</button></div>
        <div><h4>Get started</h4><button onClick={() => go("signup")}>Create your school</button><button onClick={() => go("login")}>Sign in</button><button onClick={() => scrollTo("lx-faq")}>FAQs</button></div>
        <div><h4>Plans</h4><span>Free · UGX 0</span><span>Standard · UGX 2,000</span><span>Premium · UGX 4,000</span></div>
      </div>
      <div className="lx-footer-legal"><span>© {new Date().getFullYear()} Ledgerly. All rights reserved.</span><span>Photos: Emmanuel Ikwuegbu, David Geneugelijk, Fatima Yusuf and Vitaly Gariev on Unsplash.</span></div>
    </footer>
  </div>;
}

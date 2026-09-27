import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import pg from "pg";
import XLSX from "xlsx";

const ORGANIZATION_ID = "org_056e6a51a5e34628b3874570ed0494e9";
const DEFAULT_CSV = "/home/umar/ledgerly final/data/schoolpay_transactions.csv";
const DEFAULT_SNAPSHOT = "/home/umar/ledgerly_modular_v9/tmp/students_balances.json";
const DEFAULT_ANALYSIS = "/home/umar/ledgerly_modular_v9/tmp/analyze_exams.py";
const PYTHON = "/home/umar/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
const BATCH = "lubowa-schoolpay-2026-09";

const apply = process.argv.includes("--apply");
const csvPath = valueAfter("--csv") ?? DEFAULT_CSV;
const snapshotPath = valueAfter("--snapshot") ?? DEFAULT_SNAPSHOT;
const analysisPath = valueAfter("--analysis") ?? DEFAULT_ANALYSIS;

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function id(prefix, key) {
  return `${prefix}_${createHash("sha256").update(`${BATCH}:${key}`).digest("hex").slice(0, 28)}`;
}

function money(value) {
  const normalized = String(value ?? "").replaceAll(",", "").trim();
  if (!normalized) return 0;
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error(`Invalid money value: ${value}`);
  const fraction = (match[3] ?? "").padEnd(2, "0");
  const amount = BigInt(match[2]) * 100n + BigInt(fraction || "0");
  return Number(match[1] ? -amount : amount);
}

function sourceRows(path) {
  const workbook = XLSX.readFile(path, { raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }).map((row, index) => ({
    rowNumber: index + 2,
    paymentCode: String(row.PaymentCode).trim(),
    studentName: String(row.StudentName).trim(),
    date: String(row.Date).slice(0, 10),
    narration: String(row.Narration).trim(),
    debitMinor: money(row.Debit),
    creditMinor: money(row.Credit),
    balanceMinor: money(row.Balance),
  }));
}

function withdrawnStudents(path) {
  const script = String.raw`
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('analysis',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
students,exams=m.load_students(),m.parse_exams()
matches,unmatched,_=m.match_all(students,exams)
matched={i:(j,score) for i,j,score,_ in matches}
out=[]
for i,s in enumerate(students):
    if i in unmatched: reason='absent_from_marksheet'
    elif exams[matched[i][0]]['x']: reason='exam_result_X'
    else: continue
    out.append({'studentNumber':s['student_number'],'reason':reason})
print(json.dumps(out))
`;
  return JSON.parse(execFileSync(PYTHON, ["-c", script, path], { encoding: "utf8" }));
}

function classify(row) {
  const narration = row.narration.toLowerCase();
  if (narration.includes("payment received via bank")) return { kind: "payment", contra: "1020", method: "bank" };
  if (narration.includes("payment received via cash")) return { kind: "payment", contra: "1010", method: "cash" };
  if (narration.startsWith("bursary:")) return { kind: "bursary", contra: "6200" };
  if (narration.startsWith("reversal:") || narration.startsWith("credit note:") || row.creditMinor > 0) {
    if (narration.includes("requirement")) return { kind: "credit", contra: "4110" };
    if (narration.includes("boarding")) return { kind: "credit", contra: "4120" };
    if (narration.includes("tuition")) return { kind: "credit", contra: "4100" };
    return { kind: "credit", contra: "4190" };
  }
  if (/\bb\/?f\b|balance from term|term 1 balance/.test(narration)) return { kind: "opening_balance", contra: "3900" };
  if (narration.includes("requirement")) return { kind: "charge", contra: "4110" };
  if (narration.includes("boarding")) return { kind: "charge", contra: "4120" };
  if (narration.includes("tuition") || narration.includes("school fees") || narration.includes("tution")) return { kind: "charge", contra: "4100" };
  return { kind: "charge", contra: "4130" };
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts.shift() || "Unknown", lastName: parts.join(" ") || "Unknown" };
}

const snapshotEnvelope = JSON.parse(await readFile(snapshotPath, "utf8"));
const roster = snapshotEnvelope[0]?.results ?? [];
if (roster.length !== 378) throw new Error(`Expected 378 verified roster learners, found ${roster.length}`);
const rows = sourceRows(csvPath);
if (rows.length !== 2224) throw new Error(`Expected 2,224 SchoolPay rows, found ${rows.length}`);
const withdrawals = withdrawnStudents(analysisPath);
if (withdrawals.length !== 141) throw new Error(`Expected 141 verified withdrawals, found ${withdrawals.length}`);
const withdrawalMap = new Map(withdrawals.map((row) => [row.studentNumber, row.reason]));
const rosterByNumber = new Map(roster.map((student) => [String(student.student_number), student]));

for (const row of rows) {
  if (!rosterByNumber.has(row.paymentCode)) {
    const name = splitName(row.studentName);
    rosterByNumber.set(row.paymentCode, {
      student_number: row.paymentCode,
      first_name: name.firstName,
      last_name: name.lastName,
      class_name: null,
      balance_minor: row.balanceMinor,
      provisional: true,
    });
  }
}
const students = [...rosterByNumber.values()];
const finalBalances = new Map(students.map((student) => [String(student.student_number), Number(student.balance_minor ?? 0)]));
for (const row of rows) finalBalances.set(row.paymentCode, row.balanceMinor);

const debitTotal = rows.reduce((sum, row) => sum + row.debitMinor, 0);
const creditTotal = rows.reduce((sum, row) => sum + row.creditMinor, 0);
const writeoffTotal = withdrawals.reduce((sum, row) => sum + Math.max(0, finalBalances.get(row.studentNumber) ?? 0), 0);
const paymentRows = rows.filter((row) => classify(row).kind === "payment");
const expected = {
  learners: 379,
  active: 238,
  withdrawn: 141,
  transactions: 2224,
  payments: 444,
  debitTotal: 8_169_100_100,
  creditTotal: 6_313_611_200,
  writeoffTotal: 631_900_000,
};
const observed = { learners: students.length, active: students.length - withdrawals.length, withdrawn: withdrawals.length, transactions: rows.length, payments: paymentRows.length, debitTotal, creditTotal, writeoffTotal };
for (const [key, value] of Object.entries(expected)) {
  if (observed[key] !== value) throw new Error(`Reconciliation failed for ${key}: expected ${value}, found ${observed[key]}`);
}

console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", organizationId: ORGANIZATION_ID, batch: BATCH, ...observed, closingReceivable: debitTotal - creditTotal - writeoffTotal }, null, 2));
if (!apply) {
  console.log("Dry run passed. Re-run with --apply to commit the migration.");
  process.exit(0);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query("BEGIN");
  const organization = await db.query("SELECT id,name FROM organizations WHERE id=$1 FOR UPDATE", [ORGANIZATION_ID]);
  if (!organization.rowCount) throw new Error(`Organization ${ORGANIZATION_ID} does not exist`);
  const owner = (await db.query("SELECT user_id FROM memberships WHERE organization_id=$1 AND role='owner' ORDER BY created_at LIMIT 1", [ORGANIZATION_ID])).rows[0]?.user_id;
  if (!owner) throw new Error("The school organization has no owner user");
  const existing = Number((await db.query("SELECT COUNT(*)::int AS count FROM school_students WHERE organization_id=$1 AND deleted_at IS NULL", [ORGANIZATION_ID])).rows[0].count);
  if (existing) throw new Error(`Refusing to mix this verified import with ${existing} existing learners. Remove them explicitly before retrying.`);

  await db.query(`INSERT INTO school_profiles(organization_id,school_code,school_type,ownership_type,education_level,curriculum,country,timezone,date_format,time_format,default_currency,multi_campus_enabled,branding,system_preferences)
    VALUES($1,'LMJS','day_boarding','private','Pre-primary and primary','Uganda Primary Curriculum','Uganda','Africa/Kampala','DD/MM/YYYY','24h','UGX',false,$2::jsonb,$3::jsonb)
    ON CONFLICT(organization_id) DO UPDATE SET school_code=EXCLUDED.school_code,school_type=EXCLUDED.school_type,ownership_type=EXCLUDED.ownership_type,education_level=EXCLUDED.education_level,curriculum=EXCLUDED.curriculum,country=EXCLUDED.country,timezone=EXCLUDED.timezone,date_format=EXCLUDED.date_format,time_format=EXCLUDED.time_format,default_currency=EXCLUDED.default_currency,system_preferences=school_profiles.system_preferences||EXCLUDED.system_preferences,updated_at=CURRENT_TIMESTAMP`, [ORGANIZATION_ID, JSON.stringify({ documentHeaderName: "LUBOWA MEMORIAL JUNIOR SCHOOL" }), JSON.stringify({ schoolPayImportBatch: BATCH, schoolPayImportedAt: new Date().toISOString() })]);

  const accountSpecs = [
    ["1010", "Cash on Hand", "asset", "cash", "debit"],
    ["1020", "SchoolPay Bank and Clearing", "asset", "cash", "debit"],
    ["1110", "School Fees Receivable", "asset", "school_fee_receivable", "debit"],
    ["3900", "Opening Balance Equity", "equity", "opening_balance", "credit"],
    ["4100", "Tuition Fees Income", "revenue", "school_fees", "credit"],
    ["4110", "Requirements Income", "revenue", "school_requirements", "credit"],
    ["4120", "Boarding Fees Income", "revenue", "boarding_fees", "credit"],
    ["4130", "Other School Income", "revenue", "school_other", "credit"],
    ["4190", "Fee Adjustments and Reversals", "revenue", "fee_adjustments", "debit"],
    ["6200", "Bursaries and Fee Concessions", "expense", "fee_concessions", "debit"],
    ["6210", "Bad Debts - School Fees", "expense", "bad_debts", "debit"],
  ];
  for (const [code, name, type, subtype, normal] of accountSpecs) {
    await db.query(`INSERT INTO accounts(id,organization_id,code,name,type,subtype,normal_balance,currency,allow_posting,active)
      VALUES($1,$2,$3,$4,$5,$6,$7,'UGX',true,true)
      ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,subtype=EXCLUDED.subtype,normal_balance=EXCLUDED.normal_balance,currency='UGX',allow_posting=true,active=true,updated_at=CURRENT_TIMESTAMP`, [id("acc", code), ORGANIZATION_ID, code, name, type, subtype, normal]);
  }
  const accountRows = await db.query("SELECT code,id FROM accounts WHERE organization_id=$1 AND code=ANY($2::text[])", [ORGANIZATION_ID, accountSpecs.map((row) => row[0])]);
  const accounts = new Map(accountRows.rows.map((row) => [row.code, row.id]));
  for (const [code, name, accountCode] of [["TUITION", "Tuition Fees", "4100"], ["REQUIREMENTS", "School Requirements", "4110"], ["BOARDING", "Boarding Fees", "4120"], ["OTHER", "Other School Charges", "4130"]]) {
    await db.query(`INSERT INTO school_fee_categories(id,organization_id,code,name,description,income_account_id,active) VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,income_account_id=EXCLUDED.income_account_id,active=true,updated_at=CURRENT_TIMESTAMP`, [id("fct", code), ORGANIZATION_ID, code, name, `Standard ${name.toLowerCase()} category`, accounts.get(accountCode)]);
  }

  const fiscalYearId = id("fy", "2026");
  await db.query(`INSERT INTO fiscal_years(id,organization_id,name,starts_on,ends_on,status) VALUES($1,$2,'2026','2026-01-01','2026-12-31','open') ON CONFLICT(organization_id,starts_on,ends_on) DO UPDATE SET name=EXCLUDED.name,status='open',updated_at=CURRENT_TIMESTAMP`, [fiscalYearId, ORGANIZATION_ID]);
  for (let month = 1; month <= 12; month++) {
    const starts = `2026-${String(month).padStart(2, "0")}-01`;
    const ends = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10);
    await db.query(`INSERT INTO fiscal_periods(id,organization_id,fiscal_year_id,name,starts_on,ends_on,status) VALUES($1,$2,$3,$4,$5,$6,'open') ON CONFLICT(organization_id,starts_on,ends_on) DO UPDATE SET fiscal_year_id=EXCLUDED.fiscal_year_id,name=EXCLUDED.name,status='open',updated_at=CURRENT_TIMESTAMP`, [id("fp", starts), ORGANIZATION_ID, fiscalYearId, new Date(`${starts}T00:00:00Z`).toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" }), starts, ends]);
  }

  const yearResult = await db.query(`INSERT INTO school_academic_years(id,organization_id,code,name,starts_on,ends_on,status,is_current) VALUES($1,$2,'2026','Academic Year 2026','2026-01-01','2026-12-31','active',true) ON CONFLICT(organization_id,code) DO UPDATE SET name='Academic Year 2026',status='active',is_current=true,updated_at=CURRENT_TIMESTAMP RETURNING id`, [id("say", "2026"), ORGANIZATION_ID]);
  const yearId = yearResult.rows[0].id;
  await db.query(`UPDATE school_terms SET is_current=false,status=CASE WHEN ends_on<CURRENT_DATE THEN 'closed' ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1`, [ORGANIZATION_ID]);
  await db.query(`UPDATE school_terms SET is_current=true,status='active',updated_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND academic_year_id=$2 AND code='T3'`, [ORGANIZATION_ID, yearId]);

  const levelRows = await db.query(`SELECT code,id FROM school_class_levels WHERE organization_id=$1 AND code=ANY($2::text[])`, [ORGANIZATION_ID, ["NURSERY", "LOWER_PRIMARY", "UPPER_PRIMARY"]]);
  const levelIds = new Map(levelRows.rows.map((row) => [row.code, row.id]));
  if (levelIds.size !== 3) throw new Error("Expected the school's Nursery, Lower Primary and Upper Primary class levels");
  const classNames = ["Baby Class 2026", "Middle Class 2026", "Top Class 2026", "Primary One 2026", "Primary Two 2026", "Primary Three 2026", "Primary Four 2026", "Primary Five 2026", "Primary Six 2026", "Primary Seven 2026"];
  const classIds = new Map();
  for (let index = 0; index < classNames.length; index++) {
    const name = classNames[index];
    const code = ["baby", "middle", "top", "p1", "p2", "p3", "p4", "p5", "p6", "p7"][index];
    const levelCode = index < 3 ? "NURSERY" : index < 7 ? "LOWER_PRIMARY" : "UPPER_PRIMARY";
    const levelId = levelIds.get(levelCode);
    const classResult = await db.query(`INSERT INTO school_classes(id,organization_id,academic_year_id,class_level_id,code,name,active) VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT(organization_id,academic_year_id,code) DO UPDATE SET class_level_id=EXCLUDED.class_level_id,name=EXCLUDED.name,active=true,updated_at=CURRENT_TIMESTAMP RETURNING id`, [id("cls", code), ORGANIZATION_ID, yearId, levelId, code, name]);
    const classId = classResult.rows[0].id;
    classIds.set(name, { classId, levelId });
  }

  const studentIds = new Map();
  const contactIds = new Map();
  for (const student of students) {
    const number = String(student.student_number);
    const studentId = id("stu", number);
    const contactId = id("con", number);
    const placement = classIds.get(student.class_name);
    const reason = withdrawalMap.get(number);
    const status = reason ? "withdrawn" : "active";
    studentIds.set(number, studentId);
    contactIds.set(number, contactId);
    await db.query(`INSERT INTO contacts(id,organization_id,type,code,name,payment_terms_days,custom_fields,active) VALUES($1,$2,'customer',$3,$4,0,$5::jsonb,true)`, [contactId, ORGANIZATION_ID, `STU-${number}`, `${student.first_name} ${student.last_name}`.trim(), JSON.stringify({ schoolStudentNumber: number, importBatch: BATCH })]);
    await db.query(`INSERT INTO school_students(id,organization_id,contact_id,admission_number,student_number,first_name,last_name,admission_date,admission_class_level_id,current_academic_year_id,current_class_id,status,student_category,residency_status,custom_fields,created_by,updated_by)
      VALUES($1,$2,$3,$4,$4,$5,$6,'2026-01-26',$7,$8,$9,$10,'standard','day',$11::jsonb,$12,$12)`, [studentId, ORGANIZATION_ID, contactId, number, student.first_name, student.last_name, placement?.levelId ?? null, yearId, placement?.classId ?? null, status, JSON.stringify({ importBatch: BATCH, source: "SchoolPay", provisional: student.provisional === true, withdrawalReason: reason ?? null }), owner]);
    if (placement) await db.query(`INSERT INTO school_enrollments(id,organization_id,student_id,academic_year_id,class_id,enrolled_on,status,created_by) VALUES($1,$2,$3,$4,$5,'2026-01-26',$6,$7)`, [id("enr", number), ORGANIZATION_ID, studentId, yearId, placement.classId, reason ? "withdrawn" : "active", owner]);
  }

  let expectedBalanceByStudent = new Map(students.map((student) => [String(student.student_number), 0]));
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const studentId = studentIds.get(row.paymentCode);
    const contactId = contactIds.get(row.paymentCode);
    if (!studentId || !contactId) throw new Error(`No learner account for SchoolPay code ${row.paymentCode}`);
    const classification = classify(row);
    const amount = row.debitMinor || row.creditMinor;
    if (amount <= 0 || (row.debitMinor > 0 && row.creditMinor > 0)) throw new Error(`Invalid debit/credit on source row ${row.rowNumber}`);
    const journalId = id("je", `source:${row.rowNumber}`);
    const entryNumber = `SP-${String(index + 1).padStart(6, "0")}`;
    await db.query(`INSERT INTO journal_entries(id,organization_id,entry_number,transaction_date,posting_date,description,reference,source_type,source_id,status,currency,exchange_rate_micros,posted_at,posted_by,idempotency_key,metadata)
      VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,'posted','UGX',1000000,CURRENT_TIMESTAMP,$9,$10,$11::jsonb)`, [journalId, ORGANIZATION_ID, entryNumber, row.date, row.narration, row.paymentCode, `schoolpay_${classification.kind}`, `${BATCH}:${row.rowNumber}`, owner, `${BATCH}:journal:${row.rowNumber}`, JSON.stringify({ importBatch: BATCH, sourceRow: row.rowNumber, paymentCode: row.paymentCode, sourceBalanceMinor: row.balanceMinor, classification: classification.kind })]);
    const receivableDebit = row.debitMinor;
    const receivableCredit = row.creditMinor;
    const dimensions = JSON.stringify({ schoolStudentId: studentId, schoolStudentNumber: row.paymentCode, importBatch: BATCH, sourceRow: row.rowNumber });
    await db.query(`INSERT INTO journal_lines(id,organization_id,journal_entry_id,account_id,description,debit_minor,credit_minor,base_debit_minor,base_credit_minor,contact_id,class_id,dimensions_json) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$7,$8,$9,$10::jsonb)`, [id("jl", `ar:${row.rowNumber}`), ORGANIZATION_ID, journalId, accounts.get("1110"), row.narration, receivableDebit, receivableCredit, contactId, classIds.get(rosterByNumber.get(row.paymentCode)?.class_name)?.classId ?? null, dimensions]);
    await db.query(`INSERT INTO journal_lines(id,organization_id,journal_entry_id,account_id,description,debit_minor,credit_minor,base_debit_minor,base_credit_minor,contact_id,class_id,dimensions_json) VALUES($1,$2,$3,$4,$5,$6,$7,$6,$7,$8,$9,$10::jsonb)`, [id("jl", `contra:${row.rowNumber}`), ORGANIZATION_ID, journalId, accounts.get(classification.contra), row.narration, receivableCredit, receivableDebit, contactId, classIds.get(rosterByNumber.get(row.paymentCode)?.class_name)?.classId ?? null, dimensions]);
    expectedBalanceByStudent.set(row.paymentCode, (expectedBalanceByStudent.get(row.paymentCode) ?? 0) + receivableDebit - receivableCredit);
    if (classification.kind === "payment") {
      const paymentId = id("pmt", `source:${row.rowNumber}`);
      const receiptNumber = `SPRCPT-${String(index + 1).padStart(6, "0")}`;
      await db.query(`INSERT INTO payments(id,organization_id,type,number,contact_id,bank_account_id,control_account_id,payment_date,currency,amount_minor,reference,status,journal_entry_id,idempotency_key) VALUES($1,$2,'receipt',$3,$4,$5,$6,$7,'UGX',$8,$9,'posted',$10,$11)`, [paymentId, ORGANIZATION_ID, receiptNumber, contactId, accounts.get(classification.contra), accounts.get("1110"), row.date, row.creditMinor, row.narration, journalId, `${BATCH}:payment:${row.rowNumber}`]);
      await db.query(`INSERT INTO school_fee_receipts(id,organization_id,student_id,payment_id,receipt_number,amount_minor,payment_date,reference,created_by,amount_in_words) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL)`, [id("sfr", `source:${row.rowNumber}`), ORGANIZATION_ID, studentId, paymentId, receiptNumber, row.creditMinor, row.date, row.narration, owner]);
    }
  }

  let writeoffIndex = 0;
  for (const withdrawal of withdrawals) {
    const balance = expectedBalanceByStudent.get(withdrawal.studentNumber) ?? 0;
    if (balance <= 0) continue;
    writeoffIndex++;
    const studentId = studentIds.get(withdrawal.studentNumber);
    const contactId = contactIds.get(withdrawal.studentNumber);
    const journalId = id("je", `writeoff:${withdrawal.studentNumber}`);
    const dimensions = JSON.stringify({ schoolStudentId: studentId, schoolStudentNumber: withdrawal.studentNumber, importBatch: BATCH, withdrawalReason: withdrawal.reason });
    const description = withdrawal.reason === "exam_result_X" ? "Bad-debt write-off: learner withdrawn after X result in last-term examinations" : "Bad-debt write-off: learner absent from last-term examination lists";
    await db.query(`INSERT INTO journal_entries(id,organization_id,entry_number,transaction_date,posting_date,description,reference,source_type,source_id,status,currency,exchange_rate_micros,posted_at,posted_by,idempotency_key,metadata) VALUES($1,$2,$3,'2026-09-12','2026-09-12',$4,$5,'school_fee_writeoff',$6,'posted','UGX',1000000,CURRENT_TIMESTAMP,$7,$8,$9::jsonb)`, [journalId, ORGANIZATION_ID, `WO-${String(writeoffIndex).padStart(4, "0")}`, description, withdrawal.studentNumber, studentId, owner, `${BATCH}:writeoff:${withdrawal.studentNumber}`, dimensions]);
    await db.query(`INSERT INTO journal_lines(id,organization_id,journal_entry_id,account_id,description,debit_minor,credit_minor,base_debit_minor,base_credit_minor,contact_id,dimensions_json) VALUES($1,$2,$3,$4,$5,$6,0,$6,0,$7,$8::jsonb),($9,$2,$3,$10,$5,0,$6,0,$6,$7,$8::jsonb)`, [id("jl", `writeoff-expense:${withdrawal.studentNumber}`), ORGANIZATION_ID, journalId, accounts.get("6210"), description, balance, contactId, dimensions, id("jl", `writeoff-ar:${withdrawal.studentNumber}`), accounts.get("1110")]);
    expectedBalanceByStudent.set(withdrawal.studentNumber, 0);
  }

  const journalCheck = await db.query(`SELECT COUNT(DISTINCT j.id)::int entries,COALESCE(SUM(debit_minor),0)::float8 debits,COALESCE(SUM(credit_minor),0)::float8 credits FROM journal_entries j JOIN journal_lines l ON l.journal_entry_id=j.id AND l.organization_id=j.organization_id WHERE j.organization_id=$1 AND j.metadata->>'importBatch'=$2`, [ORGANIZATION_ID, BATCH]);
  const learnerCheck = await db.query(`SELECT status,COUNT(*)::int count FROM school_students WHERE organization_id=$1 AND custom_fields->>'importBatch'=$2 GROUP BY status ORDER BY status`, [ORGANIZATION_ID, BATCH]);
  const balanceCheck = await db.query(`SELECT COALESCE(SUM(l.debit_minor-l.credit_minor),0)::float8 balance FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id WHERE l.organization_id=$1 AND l.account_id=$2 AND j.status='posted' AND j.metadata->>'importBatch'=$3`, [ORGANIZATION_ID, accounts.get("1110"), BATCH]);
  const checks = { journal: journalCheck.rows[0], learners: learnerCheck.rows, receivableBalance: Number(balanceCheck.rows[0].balance) };
  if (Number(checks.journal.debits) !== Number(checks.journal.credits)) throw new Error("Imported journal is not balanced");
  if (Number(checks.journal.entries) !== rows.length + 67) throw new Error(`Expected ${rows.length + 67} imported journals, found ${checks.journal.entries}`);
  if (checks.receivableBalance !== debitTotal - creditTotal - writeoffTotal) throw new Error(`Receivable reconciliation failed: ${checks.receivableBalance}`);
  await db.query("COMMIT");
  console.log(JSON.stringify({ committed: true, ...checks }, null, 2));
} catch (error) {
  await db.query("ROLLBACK");
  throw error;
} finally {
  await db.end();
}

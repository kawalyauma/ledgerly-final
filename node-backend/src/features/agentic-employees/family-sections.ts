function number(value: unknown) { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; }

export async function cumulativeAcademicSection(db: D1Database, organizationId: string, studentId: string, maxExamHistory = 24) {
  const limit = Math.max(1, Math.min(60, Math.floor(maxExamHistory || 24)));
  const cards = await db.prepare(`
    SELECT rc.exam_id AS examId,e.name AS examName,e.exam_type AS examType,
           ay.name AS academicYearName,t.name AS termName,c.name AS className,st.name AS streamName,
           rc.total_marks AS totalMarks,rc.max_possible_marks AS maxPossibleMarks,
           rc.subjects_sat AS subjectsSat,rc.subjects_missing AS subjectsMissing,
           rc.aggregate,rc.division,rc.grade_summary AS gradeSummary,
           rc.position_in_class AS positionInClass,rc.total_students_in_class AS totalStudentsInClass,
           rc.attendance_percent AS attendancePercent,rc.class_teacher_comment AS classTeacherComment,
           rc.head_teacher_comment AS headTeacherComment,rc.published_at AS publishedAt
    FROM exm_report_cards rc
    JOIN exm_exams e ON e.id=rc.exam_id AND e.organization_id=rc.organization_id
    LEFT JOIN school_academic_years ay ON ay.id=e.academic_year_id
    LEFT JOIN school_terms t ON t.id=e.term_id
    LEFT JOIN school_classes c ON c.id=rc.class_id
    LEFT JOIN school_streams st ON st.id=rc.stream_id
    WHERE rc.organization_id=? AND rc.student_id=? AND rc.is_published=true AND e.status='published'
    ORDER BY COALESCE(e.end_date,e.start_date,rc.published_at) DESC,rc.published_at DESC
    LIMIT ?
  `).bind(organizationId, studentId, limit).all<Record<string, unknown>>();

  const marks = await db.prepare(`
    SELECT m.exam_id AS examId,e.name AS examName,ay.name AS academicYearName,t.name AS termName,
           s.id AS subjectId,s.name AS subjectName,s.code AS subjectCode,
           m.marks_obtained AS marksObtained,m.percentage,m.grade,m.grade_points AS gradePoints,
           m.is_absent AS isAbsent,m.is_exempt AS isExempt
    FROM exm_marks m
    JOIN exm_exams e ON e.id=m.exam_id AND e.organization_id=m.organization_id
    JOIN exm_report_cards rc ON rc.organization_id=m.organization_id AND rc.exam_id=m.exam_id AND rc.student_id=m.student_id AND rc.is_published=true
    JOIN school_subjects s ON s.id=m.subject_id
    LEFT JOIN school_academic_years ay ON ay.id=e.academic_year_id
    LEFT JOIN school_terms t ON t.id=e.term_id
    WHERE m.organization_id=? AND m.student_id=? AND e.status='published'
    ORDER BY COALESCE(e.end_date,e.start_date,rc.published_at),s.name
  `).bind(organizationId, studentId).all<Record<string, unknown>>();

  const subjects = new Map<string, { subjectId: string; subjectName: string; attempts: number; totalPercentage: number; latestPercentage: number | null; latestGrade: string | null }>();
  for (const row of marks.results) {
    if (number(row.isAbsent) || number(row.isExempt) || row.percentage == null) continue;
    const id = String(row.subjectId), pct = number(row.percentage);
    const item = subjects.get(id) || { subjectId: id, subjectName: String(row.subjectName || ""), attempts: 0, totalPercentage: 0, latestPercentage: null, latestGrade: null };
    item.attempts += 1;
    item.totalPercentage += pct;
    item.latestPercentage = pct;
    item.latestGrade = row.grade == null ? null : String(row.grade);
    subjects.set(id, item);
  }
  const subjectTrends = [...subjects.values()].map(item => ({
    subjectId: item.subjectId,
    subjectName: item.subjectName,
    attempts: item.attempts,
    averagePercentage: item.attempts ? Math.round(item.totalPercentage / item.attempts * 10) / 10 : null,
    latestPercentage: item.latestPercentage,
    latestGrade: item.latestGrade,
  })).sort((a,b) => a.subjectName.localeCompare(b.subjectName));

  const examPercentages = cards.results.map(row => number(row.maxPossibleMarks) > 0 ? number(row.totalMarks) * 100 / number(row.maxPossibleMarks) : null).filter((v): v is number => v != null);
  return {
    sourcePolicy: "published-exams-only",
    publishedExamCount: cards.results.length,
    cumulativeAveragePercentage: examPercentages.length ? Math.round(examPercentages.reduce((a,b)=>a+b,0) / examPercentages.length * 10) / 10 : null,
    subjectTrends,
    examinations: cards.results.map(row => ({ ...row, gradeSummary: typeof row.gradeSummary === "string" ? safeJson(row.gradeSummary) : row.gradeSummary })),
  };
}

function safeJson(value: string) { try { return JSON.parse(value || "{}"); } catch { return {}; } }

export async function cumulativeAttendanceSection(db: D1Database, organizationId: string, studentId: string) {
  const overall = await db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN r.status='present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN r.status='late' THEN 1 ELSE 0 END) AS late,
      SUM(CASE WHEN r.status='absent' THEN 1 ELSE 0 END) AS absent,
      SUM(CASE WHEN r.status IN ('excused','sick','permission') THEN 1 ELSE 0 END) AS excused,
      SUM(COALESCE(r.minutes_late,0)) AS minutesLate,
      MIN(r.attendance_date) AS firstAttendanceDate,MAX(r.attendance_date) AS lastAttendanceDate
    FROM att_records r
    WHERE r.organization_id=? AND r.person_type='student' AND r.person_id=? AND r.official=1
  `).bind(organizationId, studentId).first<Record<string, unknown>>();
  const periods = await db.prepare(`
    SELECT ay.name AS academicYearName,t.name AS termName,COUNT(*) AS total,
      SUM(CASE WHEN r.status='present' THEN 1 ELSE 0 END) AS present,
      SUM(CASE WHEN r.status='late' THEN 1 ELSE 0 END) AS late,
      SUM(CASE WHEN r.status='absent' THEN 1 ELSE 0 END) AS absent,
      SUM(CASE WHEN r.status IN ('excused','sick','permission') THEN 1 ELSE 0 END) AS excused,
      SUM(COALESCE(r.minutes_late,0)) AS minutesLate
    FROM att_records r
    LEFT JOIN att_sessions ses ON ses.id=r.session_id AND ses.organization_id=r.organization_id
    LEFT JOIN school_academic_years ay ON ay.id=ses.academic_year_id
    LEFT JOIN school_terms t ON t.id=ses.term_id
    WHERE r.organization_id=? AND r.person_type='student' AND r.person_id=? AND r.official=1
    GROUP BY ses.academic_year_id,ses.term_id,ay.name,t.name
    ORDER BY ay.starts_on,t.starts_on
  `).bind(organizationId, studentId).all<Record<string, unknown>>();
  const summarize = (row: Record<string, unknown> | null) => {
    const total = number(row?.total), attended = number(row?.present) + number(row?.late) + number(row?.excused);
    return { ...(row || {}), total, present: number(row?.present), late: number(row?.late), absent: number(row?.absent), excused: number(row?.excused), minutesLate: number(row?.minutesLate), attendancePercentage: total ? Math.round(attended / total * 1000) / 10 : null };
  };
  return { overall: summarize(overall || {}), periods: periods.results.map(row => summarize(row)) };
}

export async function cumulativeFinanceSection(db: D1Database, organizationId: string, studentId: string) {
  const totals = await db.prepare(`
    SELECT COALESCE(SUM(c.total_minor),0) AS billedMinor,
      COALESCE(SUM(c.credited_minor),0) AS creditedMinor,
      COALESCE(SUM(c.written_off_minor),0) AS writtenOffMinor,
      COALESCE(SUM(COALESCE(p.paid_minor,0)),0) AS paidMinor,
      COALESCE(SUM(c.total_minor-c.credited_minor-c.written_off_minor-COALESCE(p.paid_minor,0)),0) AS outstandingMinor,
      COUNT(*) AS chargeCount
    FROM school_student_fee_charges c
    JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
    LEFT JOIN (SELECT organization_id,document_id,SUM(amount_minor) AS paid_minor FROM payment_allocations WHERE reversed_at IS NULL GROUP BY organization_id,document_id) p
      ON p.organization_id=c.organization_id AND p.document_id=c.document_id
    WHERE c.organization_id=? AND c.student_id=? AND c.status<>'voided' AND d.status IN ('open','partially_paid','paid')
  `).bind(organizationId, studentId).first<Record<string, unknown>>();
  const documents = await db.prepare(`
    SELECT d.id AS documentId,d.number,d.issue_date AS issueDate,d.due_date AS dueDate,d.status,
      c.total_minor AS billedMinor,c.credited_minor AS creditedMinor,c.written_off_minor AS writtenOffMinor,
      COALESCE(p.paid_minor,0) AS paidMinor,
      c.total_minor-c.credited_minor-c.written_off_minor-COALESCE(p.paid_minor,0) AS outstandingMinor
    FROM school_student_fee_charges c
    JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
    LEFT JOIN (SELECT organization_id,document_id,SUM(amount_minor) AS paid_minor FROM payment_allocations WHERE reversed_at IS NULL GROUP BY organization_id,document_id) p
      ON p.organization_id=c.organization_id AND p.document_id=c.document_id
    WHERE c.organization_id=? AND c.student_id=? AND c.status<>'voided' AND d.status IN ('open','partially_paid','paid')
    ORDER BY d.issue_date DESC,d.number DESC LIMIT 100
  `).bind(organizationId, studentId).all<Record<string, unknown>>();
  return {
    currencyBasis: "organization-base-currency-minor-units",
    totals: { billedMinor: number(totals?.billedMinor), creditedMinor: number(totals?.creditedMinor), writtenOffMinor: number(totals?.writtenOffMinor), paidMinor: number(totals?.paidMinor), outstandingMinor: number(totals?.outstandingMinor), chargeCount: number(totals?.chargeCount) },
    documents: documents.results,
  };
}

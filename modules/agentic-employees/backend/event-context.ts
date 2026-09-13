import type { AgentKey } from "./policy";

export type EventSettings = {
  enabled: boolean;
  attendanceWindowDays: number;
  attendanceAttentionCount: number;
  attendanceUrgentCount: number;
  booksLowStockThreshold: number;
  paymentReactionEnabled: boolean;
  attendanceReactionEnabled: boolean;
  hrReactionEnabled: boolean;
  booksReactionEnabled: boolean;
};

export type EventEnvelope = {
  id: string;
  organizationId: string;
  eventType: string;
  sourceModule: string;
  sourceRecordId: string;
  subjectType: string | null;
  subjectId: string | null;
  payloadJson: string;
  occurredAt: string;
};

export type EvaluatedEvent = {
  ignored?: boolean;
  ignoreReason?: string;
  agentKey?: AgentKey;
  secondaryAgentKey?: AgentKey;
  severity?: "info" | "attention" | "urgent";
  title?: string;
  facts?: Record<string, unknown>;
  fallbackSummary?: string;
  recommendedAction?: string;
};

export async function loadEventSettings(db: D1Database, organizationId: string): Promise<EventSettings> {
  const row = await db.prepare(`SELECT enabled,attendance_window_days AS attendanceWindowDays,
    attendance_attention_count AS attendanceAttentionCount,attendance_urgent_count AS attendanceUrgentCount,
    books_low_stock_threshold AS booksLowStockThreshold,payment_reaction_enabled AS paymentReactionEnabled,
    attendance_reaction_enabled AS attendanceReactionEnabled,hr_reaction_enabled AS hrReactionEnabled,
    books_reaction_enabled AS booksReactionEnabled FROM ae_event_settings WHERE organization_id=?`)
    .bind(organizationId).first<any>();
  return {
    enabled: row ? Boolean(row.enabled) : true,
    attendanceWindowDays: Number(row?.attendanceWindowDays || 7),
    attendanceAttentionCount: Number(row?.attendanceAttentionCount || 2),
    attendanceUrgentCount: Number(row?.attendanceUrgentCount || 3),
    booksLowStockThreshold: Number(row?.booksLowStockThreshold ?? 20),
    paymentReactionEnabled: row ? Boolean(row.paymentReactionEnabled) : true,
    attendanceReactionEnabled: row ? Boolean(row.attendanceReactionEnabled) : true,
    hrReactionEnabled: row ? Boolean(row.hrReactionEnabled) : true,
    booksReactionEnabled: row ? Boolean(row.booksReactionEnabled) : true,
  };
}

function parsePayload(value: string) {
  try { return JSON.parse(value || "{}"); } catch { return {}; }
}

function cutoffDate(days: number, occurredAt: string) {
  const base = new Date(occurredAt || Date.now());
  base.setUTCDate(base.getUTCDate() - Math.max(1, days));
  return base.toISOString().slice(0, 10);
}

export async function evaluateEvent(db: D1Database, event: EventEnvelope, settings: EventSettings): Promise<EvaluatedEvent> {
  if (!settings.enabled) return { ignored: true, ignoreReason: "Event reactions are disabled for this school" };
  const payload = parsePayload(event.payloadJson);

  if (event.eventType === "finance.payment_allocated") {
    if (!settings.paymentReactionEnabled) return { ignored: true, ignoreReason: "Payment reactions are disabled" };
    const row = await db.prepare(`SELECT pa.amount_minor AS amountMinor,pa.payment_id AS paymentId,pa.document_id AS documentId,
      p.number AS paymentNumber,p.payment_date AS paymentDate,p.currency,
      s.id AS studentId,s.admission_number AS admissionNumber,s.first_name||' '||s.last_name AS studentName,
      COALESCE(SUM(c.total_minor-c.credited_minor-c.written_off_minor-COALESCE(x.paid_minor,0)),0) AS balanceMinor
      FROM payment_allocations pa
      JOIN payments p ON p.id=pa.payment_id AND p.organization_id=pa.organization_id
      JOIN school_student_fee_charges target ON target.document_id=pa.document_id AND target.organization_id=pa.organization_id
      JOIN school_students s ON s.id=target.student_id AND s.organization_id=pa.organization_id
      LEFT JOIN school_student_fee_charges c ON c.student_id=s.id AND c.organization_id=s.organization_id AND c.status<>'voided'
      LEFT JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
      LEFT JOIN (SELECT organization_id,document_id,SUM(amount_minor) AS paid_minor FROM payment_allocations WHERE reversed_at IS NULL GROUP BY organization_id,document_id) x
        ON x.organization_id=c.organization_id AND x.document_id=c.document_id
      WHERE pa.id=? AND pa.organization_id=? AND (d.id IS NULL OR d.status IN ('open','partially_paid','paid'))
      GROUP BY pa.id,s.id`).bind(event.sourceRecordId,event.organizationId).first<any>();
    if (!row) return { ignored: true, ignoreReason: "Payment allocation is not linked to a school-fee charge" };
    const amount = Number(row.amountMinor || 0), balance = Number(row.balanceMinor || 0);
    return {
      agentKey: "bursar", severity: "info", title: `Payment received for ${row.studentName}`,
      facts: { ...row, amountMinor: amount, balanceMinor: balance },
      fallbackSummary: `${row.studentName} (${row.admissionNumber}) received a ${row.currency || "school currency"} payment allocation of ${amount} minor units. Current posted fee balance is ${balance} minor units.`,
      recommendedAction: balance > 0 ? "Review the remaining balance and follow up only if school policy requires it." : "No collection follow-up is needed unless the account requires reconciliation.",
    };
  }

  if (event.eventType === "attendance.student_absent") {
    if (!settings.attendanceReactionEnabled) return { ignored: true, ignoreReason: "Attendance reactions are disabled" };
    const student = await db.prepare(`SELECT s.id,s.admission_number AS admissionNumber,s.first_name||' '||s.last_name AS studentName,
      c.name AS className,st.name AS streamName FROM school_students s
      LEFT JOIN school_classes c ON c.id=s.current_class_id LEFT JOIN school_streams st ON st.id=s.current_stream_id
      WHERE s.id=? AND s.organization_id=?`).bind(event.subjectId,event.organizationId).first<any>();
    if (!student) return { ignored: true, ignoreReason: "Student no longer exists" };
    const cutoff = cutoffDate(settings.attendanceWindowDays,event.occurredAt);
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM att_records WHERE organization_id=? AND person_type='student' AND person_id=?
      AND official=1 AND status='absent' AND attendance_date>=? AND attendance_date<=?`).bind(event.organizationId,event.subjectId,cutoff,String(payload.attendanceDate || event.occurredAt).slice(0,10)).first<any>();
    const absences = Number(count?.n || 0);
    const severity = absences >= settings.attendanceUrgentCount ? "urgent" : absences >= settings.attendanceAttentionCount ? "attention" : "info";
    return {
      agentKey: "secretary", secondaryAgentKey: severity === "urgent" ? "headteacher" : undefined,
      severity, title: `${severity === "urgent" ? "Repeated absence" : "Student absence"}: ${student.studentName}`,
      facts: { ...student, attendanceDate: payload.attendanceDate, absencesInWindow: absences, windowDays: settings.attendanceWindowDays },
      fallbackSummary: `${student.studentName} (${student.admissionNumber}) is absent on ${payload.attendanceDate}. This is absence ${absences} within the configured ${settings.attendanceWindowDays}-day window.`,
      recommendedAction: severity === "urgent" ? "Review the attendance pattern with school leadership and decide whether guardian follow-up should be prepared for approval." : "Record the exception for front-office follow-up according to attendance policy.",
    };
  }

  if (event.eventType === "hr.leave_approved") {
    if (!settings.hrReactionEnabled) return { ignored: true, ignoreReason: "HR reactions are disabled" };
    const row = await db.prepare(`SELECT r.id,r.starts_on AS startsOn,r.ends_on AS endsOn,r.reason,t.name AS leaveType,
      e.employee_number AS employeeNumber,COALESCE(c.name,u.display_name,sp.first_name||' '||sp.last_name) AS employeeName
      FROM hr_leave_requests r JOIN hr_employees e ON e.id=r.employee_id JOIN hr_leave_types t ON t.id=r.leave_type_id
      LEFT JOIN contacts c ON c.id=e.contact_id LEFT JOIN users u ON u.id=e.user_id LEFT JOIN school_staff_profiles sp ON sp.id=e.school_staff_id
      WHERE r.id=? AND r.organization_id=?`).bind(event.sourceRecordId,event.organizationId).first<any>();
    if (!row) return { ignored: true, ignoreReason: "Leave request no longer exists" };
    return {
      agentKey: "hr", severity: "info", title: `Approved leave: ${row.employeeName}`,
      facts: row,
      fallbackSummary: `${row.employeeName} has approved ${row.leaveType} leave from ${row.startsOn} to ${row.endsOn}.`,
      recommendedAction: "Check handover, coverage and any onboarding or staffing dependencies. Do not change the approved leave automatically.",
    };
  }

  if (event.eventType === "books.stock_changed") {
    if (!settings.booksReactionEnabled) return { ignored: true, ignoreReason: "Books reactions are disabled" };
    const bookType = String(payload.bookType || event.subjectId || "");
    if (!bookType) return { ignored: true, ignoreReason: "Book type is unavailable" };
    const [movements, distributions] = await Promise.all([
      db.prepare(`SELECT COALESCE(SUM(CASE WHEN reversed_at IS NULL THEN quantity_delta ELSE 0 END),0) AS qty FROM bks_stock_movements WHERE organization_id=? AND book_type=?`).bind(event.organizationId,bookType).first<any>(),
      db.prepare(`SELECT COALESCE(SUM(CASE WHEN reversed_at IS NULL THEN quantity ELSE 0 END),0) AS qty FROM bks_distributions WHERE organization_id=? AND book_type=?`).bind(event.organizationId,bookType).first<any>(),
    ]);
    const receivedAdjusted = Number(movements?.qty || 0), distributed = Number(distributions?.qty || 0), available = receivedAdjusted - distributed;
    if (available > settings.booksLowStockThreshold) return { ignored: true, ignoreReason: `Stock remains above configured threshold (${settings.booksLowStockThreshold})` };
    const severity = available <= 0 ? "urgent" : "attention";
    return {
      agentKey: "librarian", severity, title: `${available <= 0 ? "Out of stock" : "Low stock"}: ${bookType}`,
      facts: { bookType, receivedAdjusted, distributed, available, threshold: settings.booksLowStockThreshold },
      fallbackSummary: `${bookType} has ${available} available after recorded stock movements and learner distributions. The configured low-stock threshold is ${settings.booksLowStockThreshold}.`,
      recommendedAction: "Review physical stock and procurement needs. Do not alter inventory records unless a staff member records a real transaction.",
    };
  }

  return { ignored: true, ignoreReason: `No event reaction policy for ${event.eventType}` };
}

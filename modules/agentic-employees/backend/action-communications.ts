import type { EventEnvelope, EvaluatedEvent } from "./event-context";
import type { ActionProposal } from "./action-policy";

export function communicationProposalForEvent(event: EventEnvelope, evaluated: EvaluatedEvent): ActionProposal | null {
  if (evaluated.ignored || !evaluated.agentKey || !evaluated.facts) return null;
  const f = evaluated.facts as Record<string, any>;

  if (event.eventType === "attendance.student_absent") {
    const studentId = String(f.id || event.subjectId || "");
    if (!studentId) return null;
    const repeated = Number(f.absencesInWindow || 0) > 1;
    return {
      agentKey: "secretary",
      actionType: "communication.campaign.send",
      title: `Attendance follow-up: ${f.studentName || "student"}`,
      summary: "Prepare an attendance message for the recorded primary guardian. Sending requires human approval.",
      requiredScope: "communications:write",
      payload: {
        audience: { kind: "students", studentIds: [studentId], recipientMode: "primary_guardian" },
        channels: ["sms"],
        subject: "Attendance follow-up",
        message: repeated
          ? `${f.studentName || "The learner"} has multiple recorded absences within the school's attendance review window. Please contact the school office for follow-up.`
          : `${f.studentName || "The learner"} was recorded absent on ${f.attendanceDate || "the recorded school day"}. Please contact the school office if clarification is needed.`,
      },
      idempotencyKey: `event:${event.id}:attendance-message`,
    };
  }

  if (event.eventType === "finance.payment_allocated" && Number(f.balanceMinor || 0) > 0 && f.studentId) {
    return {
      agentKey: "bursar",
      actionType: "communication.campaign.send",
      title: `Fee balance follow-up: ${f.studentName || "student"}`,
      summary: "Prepare a remaining-balance update after the posted payment. Sending requires human approval.",
      requiredScope: "communications:write",
      payload: {
        audience: { kind: "students", studentIds: [String(f.studentId)], recipientMode: "primary_guardian" },
        channels: ["sms"],
        subject: "School fees balance update",
        message: `A payment has been recorded for ${f.studentName || "the learner"}. A remaining posted fee balance is still recorded. Please contact the school bursar for the exact balance and any payment arrangements.`,
      },
      idempotencyKey: `event:${event.id}:fee-balance-message`,
    };
  }

  return null;
}

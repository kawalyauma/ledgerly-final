import type { AgentKey } from "./policy";
import type { EventEnvelope, EvaluatedEvent } from "./event-context";

export type ActionProposal = {
  agentKey: AgentKey;
  actionType: "communication.campaign.send" | "work.task.create";
  title: string;
  summary: string;
  requiredScope: "communications:write" | "work:write";
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

function task(event: EventEnvelope, evaluated: EvaluatedEvent, title: string, summary: string, payload: Record<string, unknown>, suffix: string): ActionProposal {
  return { agentKey: evaluated.agentKey!, actionType: "work.task.create", title, summary, requiredScope: "work:write", payload, idempotencyKey: `event:${event.id}:${suffix}` };
}

export function proposalForEvent(event: EventEnvelope, evaluated: EvaluatedEvent): ActionProposal | null {
  if (evaluated.ignored || !evaluated.agentKey || !evaluated.facts) return null;
  const f = evaluated.facts as Record<string, any>;

  if (event.eventType === "academics.lesson_plan_overdue") return task(event, evaluated,
    `Follow up overdue lesson plan: ${f.subjectName || "subject"}`,
    "Create a Tasks & Work follow-up for the overdue lesson plan.",
    { title: `Lesson plan follow-up — ${f.subjectName || "Subject"} · ${f.className || "Class"}`, description: `Follow up the plan scheduled for ${f.lessonDate || "the recorded date"}. Current status: ${f.status || "unknown"}. Teacher: ${f.teacherName || "not identified"}.`, priority: "high", assigneeUserId: f.teacherUserId || null },
    "lesson-plan-followup");

  if (event.eventType === "hr.leave_approved") return task(event, evaluated,
    `Prepare leave handover: ${f.employeeName || "staff member"}`,
    "Create a handover and staffing-coverage task for the approved leave period.",
    { title: `Leave handover — ${f.employeeName || "Staff member"}`, description: `Prepare handover and coverage for approved ${f.leaveType || "leave"} from ${f.startsOn || "start date"} to ${f.endsOn || "end date"}.`, priority: "high", assigneeUserId: f.userId || null },
    "leave-handover");

  if (event.eventType === "books.stock_changed" && Number(f.available || 0) <= Number(f.threshold ?? 20)) return task(event, evaluated,
    `Review replenishment: ${f.bookType || "books"}`,
    "Create a stock-review task because available stock reached the configured threshold.",
    { title: `Replenishment review — ${f.bookType || "Books"}`, description: `${f.bookType || "Book"} stock is ${Number(f.available || 0)} available against a threshold of ${Number(f.threshold ?? 20)}. Verify physical stock and determine replenishment needs.`, priority: Number(f.available || 0) <= 0 ? "urgent" : "high" },
    "books-replenishment-review");

  return null;
}

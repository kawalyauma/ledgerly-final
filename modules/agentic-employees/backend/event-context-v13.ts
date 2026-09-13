import type { EventSettings, EventEnvelope, EvaluatedEvent } from "./event-context";
import { evaluateEvent as evaluateBaseEvent } from "./event-context";
import { attendanceSeverity, booksStockSeverity } from "./event-policy";

export async function evaluateEmployeeEvent(db:D1Database,event:EventEnvelope,settings:EventSettings):Promise<EvaluatedEvent>{
  if(event.eventType==="finance.payment_allocated"){
    const payment=await db.prepare(`SELECT p.status FROM payment_allocations a JOIN payments p ON p.id=a.payment_id AND p.organization_id=a.organization_id
      WHERE a.id=? AND a.organization_id=?`).bind(event.sourceRecordId,event.organizationId).first<{status:string}>();
    if(!payment)return{ignored:true,ignoreReason:"Payment allocation no longer exists"};
    if(payment.status!=="posted")return{ignored:true,ignoreReason:`Payment is ${payment.status}, not posted`};
  }
  if(event.eventType!=="academics.lesson_plan_overdue"){
    const result=await evaluateBaseEvent(db,event,settings);
    if(event.eventType==="attendance.student_absent"&&result.facts){
      const count=Number((result.facts as any).absencesInWindow||0);
      result.severity=attendanceSeverity(count,settings.attendanceAttentionCount,settings.attendanceUrgentCount);
      result.secondaryAgentKey=result.severity==="urgent"?"headteacher":undefined;
    }
    if(event.eventType==="books.stock_changed"&&result.facts){
      const severity=booksStockSeverity(Number((result.facts as any).available||0),settings.booksLowStockThreshold);
      if(severity)result.severity=severity;
    }
    return result;
  }
  if(!settings.enabled)return{ignored:true,ignoreReason:"Event reactions are disabled for this school"};
  const row=await db.prepare(`SELECT p.id,p.lesson_date AS lessonDate,p.topic,p.subtopic,p.status,
    c.name AS className,s.name AS subjectName,TRIM(sp.first_name||' '||sp.last_name) AS teacherName
    FROM acad_lesson_plans p JOIN school_classes c ON c.id=p.class_id JOIN school_subjects s ON s.id=p.subject_id
    LEFT JOIN school_staff_profiles sp ON sp.organization_id=p.organization_id AND sp.user_id=p.teacher_user_id
    WHERE p.id=? AND p.organization_id=?`).bind(event.sourceRecordId,event.organizationId).first<any>();
  if(!row)return{ignored:true,ignoreReason:"Lesson plan no longer exists"};
  if(["delivered","archived"].includes(String(row.status)))return{ignored:true,ignoreReason:"Lesson plan is no longer overdue"};
  return{
    agentKey:"dos",severity:"attention",title:`Overdue lesson plan: ${row.subjectName} · ${row.className}`,
    facts:row,
    fallbackSummary:`The ${row.subjectName} lesson plan for ${row.className} scheduled for ${row.lessonDate} remains ${row.status}. Teacher: ${row.teacherName||"not identified"}.`,
    recommendedAction:"Review the lesson-plan status and follow up with the responsible teacher. Do not alter or approve the academic record automatically.",
  };
}

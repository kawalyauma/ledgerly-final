import { describe, expect, it } from "vitest";
import { proposalForEvent } from "./action-policy";
import { communicationProposalForEvent } from "./action-communications";
import type { EventEnvelope, EvaluatedEvent } from "./event-context";

function event(eventType:string,id="evt_1"):EventEnvelope{return{id,organizationId:"org_1",eventType,sourceModule:"test",sourceRecordId:"src_1",subjectType:null,subjectId:null,payloadJson:"{}",occurredAt:"2026-09-13T10:00:00Z"};}

describe("Action Center event proposals",()=>{
  it("turns overdue lesson plans into high-priority teacher tasks",()=>{
    const evaluated:EvaluatedEvent={agentKey:"dos",severity:"attention",facts:{subjectName:"Mathematics",className:"P6",lessonDate:"2026-09-12",status:"submitted",teacherName:"Teacher A",teacherUserId:"usr_teacher"}};
    const proposal=proposalForEvent(event("academics.lesson_plan_overdue"),evaluated);
    expect(proposal?.actionType).toBe("work.task.create");
    expect(proposal?.requiredScope).toBe("work:write");
    expect(proposal?.payload).toMatchObject({priority:"high",assigneeUserId:"usr_teacher"});
  });

  it("makes out-of-stock book reviews urgent",()=>{
    const evaluated:EvaluatedEvent={agentKey:"librarian",severity:"urgent",facts:{bookType:"96-page exercise book",available:0,threshold:20}};
    const proposal=proposalForEvent(event("books.stock_changed"),evaluated);
    expect(proposal?.actionType).toBe("work.task.create");
    expect(proposal?.payload).toMatchObject({priority:"urgent"});
  });

  it("prepares attendance communication only for human approval",()=>{
    const e={...event("attendance.student_absent"),subjectId:"stu_1"};
    const evaluated:EvaluatedEvent={agentKey:"secretary",severity:"attention",facts:{id:"stu_1",studentName:"Test Learner",attendanceDate:"2026-09-13",absencesInWindow:2,windowDays:7}};
    const proposal=communicationProposalForEvent(e,evaluated);
    expect(proposal?.actionType).toBe("communication.campaign.send");
    expect(proposal?.requiredScope).toBe("communications:write");
    expect(proposal?.payload).toMatchObject({audience:{kind:"students",studentIds:["stu_1"],recipientMode:"primary_guardian"}});
  });

  it("does not prepare a fee reminder when the posted balance is cleared",()=>{
    const evaluated:EvaluatedEvent={agentKey:"bursar",severity:"info",facts:{studentId:"stu_1",studentName:"Test Learner",balanceMinor:0}};
    expect(communicationProposalForEvent(event("finance.payment_allocated"),evaluated)).toBeNull();
  });
});

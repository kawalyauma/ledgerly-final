import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const deliverySchema=z.object({academicYearId:z.string(),termId:z.string(),classId:z.string(),streamId:z.string().nullable().optional(),subjectId:z.string(),teacherStaffId:z.string(),schemeItemId:z.string().nullable().optional(),lessonPlanId:z.string().nullable().optional(),deliveredOn:date,periodsDelivered:z.number().int().positive().max(20).default(1),topic:z.string().min(1).max(300),subtopic:z.string().max(300).nullable().optional(),learningOutcomesCovered:z.string().max(4000).nullable().optional(),learnerResponse:z.string().max(4000).nullable().optional(),homeworkGiven:z.string().max(2000).nullable().optional(),challenges:z.string().max(4000).nullable().optional(),nextSteps:z.string().max(4000).nullable().optional()});

export function createAcademicIntegrityRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();
  r.use("*",requireScope("school:read"));

  r.post("/lesson-plans/:id/workflow",requireScope("school:write"),async c=>{
    const p=c.get("principal"),id=c.req.param("id"),body=await c.req.json().catch(()=>({})) as any;
    const action=String(body.action??"");
    const client=await runtime.db.connect();
    try{
      await client.query("BEGIN");
      const row=(await client.query(`SELECT status FROM school_lesson_plans WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,p.organizationId])).rows[0];
      if(!row)throw new AppError(404,"NOT_FOUND","Lesson plan not found");
      const current=String(row.status);let next="",reviewAction="";
      if(action==="submit"&&current==="draft"){next="submitted";reviewAction="submitted";}
      else if(action==="submit"&&current==="changes_requested"){next="submitted";reviewAction="resubmitted";}
      else if(action==="approve"&&current==="submitted"){next="approved";reviewAction="approved";}
      else if(action==="request_changes"&&current==="submitted"){next="changes_requested";reviewAction="changes_requested";}
      else if(action==="deliver"&&current==="approved"){next="delivered";reviewAction="delivered";}
      else if(action==="cancel"&&["draft","submitted","changes_requested","approved"].includes(current)){next="cancelled";reviewAction="cancelled";}
      else throw new AppError(409,"INVALID_WORKFLOW",`Cannot ${action||"perform action"} while lesson plan is ${current}`);
      await client.query(`UPDATE school_lesson_plans SET status=$1,submitted_at=CASE WHEN $2 IN ('submitted','resubmitted') THEN CURRENT_TIMESTAMP ELSE submitted_at END,submitted_by=CASE WHEN $2 IN ('submitted','resubmitted') THEN $3 ELSE submitted_by END,reviewed_at=CASE WHEN $2 IN ('approved','changes_requested') THEN CURRENT_TIMESTAMP ELSE reviewed_at END,reviewed_by=CASE WHEN $2 IN ('approved','changes_requested') THEN $3 ELSE reviewed_by END,review_notes=CASE WHEN $2 IN ('approved','changes_requested') THEN $4 ELSE review_notes END,delivered_at=CASE WHEN $2='delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END,teacher_reflection=COALESCE($5,teacher_reflection),updated_at=CURRENT_TIMESTAMP WHERE id=$6 AND organization_id=$7`,[next,reviewAction,p.userId,body.notes??null,body.teacherReflection??null,id,p.organizationId]);
      await client.query(`INSERT INTO school_lesson_plan_reviews(id,organization_id,lesson_plan_id,action,notes,actor_user_id) VALUES($1,$2,$3,$4,$5,$6)`,[createId("lpr"),p.organizationId,id,reviewAction,body.notes??null,p.userId]);
      await client.query("COMMIT");
      return c.json({data:{id,status:next,reviewAction}});
    }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
  });

  r.post("/delivery",requireScope("school:write"),async c=>{
    const parsed=deliverySchema.safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid academic delivery log",parsed.error.flatten());
    const p=c.get("principal"),v=parsed.data,client=await runtime.db.connect();
    try{
      await client.query("BEGIN");
      const term=await client.query(`SELECT 1 FROM school_terms WHERE id=$1 AND organization_id=$2 AND academic_year_id=$3`,[v.termId,p.organizationId,v.academicYearId]);
      if(!term.rowCount)throw new AppError(422,"TERM_YEAR_MISMATCH","Term does not belong to the selected academic year");
      const cls=await client.query(`SELECT 1 FROM school_classes WHERE id=$1 AND organization_id=$2 AND academic_year_id=$3`,[v.classId,p.organizationId,v.academicYearId]);
      if(!cls.rowCount)throw new AppError(422,"CLASS_YEAR_MISMATCH","Class does not belong to the selected academic year");
      if(v.streamId){const stream=await client.query(`SELECT 1 FROM school_streams WHERE id=$1 AND organization_id=$2 AND class_id=$3`,[v.streamId,p.organizationId,v.classId]);if(!stream.rowCount)throw new AppError(422,"STREAM_CLASS_MISMATCH","Stream does not belong to the selected class");}
      if(!(await client.query(`SELECT 1 FROM school_subjects WHERE id=$1 AND organization_id=$2`,[v.subjectId,p.organizationId])).rowCount)throw new AppError(422,"INVALID_SUBJECT","Subject does not belong to this school");
      if(!(await client.query(`SELECT 1 FROM school_staff_profiles WHERE id=$1 AND organization_id=$2 AND active=true`,[v.teacherStaffId,p.organizationId])).rowCount)throw new AppError(422,"INVALID_TEACHER","Teacher is not active in this school");
      if(v.schemeItemId&&!(await client.query(`SELECT 1 FROM school_scheme_items WHERE id=$1 AND organization_id=$2`,[v.schemeItemId,p.organizationId])).rowCount)throw new AppError(422,"INVALID_SCHEME_ITEM","Scheme item does not belong to this school");
      if(v.lessonPlanId){
        const plan=(await client.query(`SELECT status,academic_year_id,term_id,class_id,stream_id,subject_id,teacher_staff_id FROM school_lesson_plans WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[v.lessonPlanId,p.organizationId])).rows[0];
        if(!plan)throw new AppError(422,"INVALID_LESSON_PLAN","Lesson plan does not belong to this school");
        if(plan.status!=="approved")throw new AppError(409,"LESSON_PLAN_NOT_APPROVED","Only an approved lesson plan can be marked delivered");
        if(plan.academic_year_id!==v.academicYearId||plan.term_id!==v.termId||plan.class_id!==v.classId||plan.subject_id!==v.subjectId||(plan.stream_id??null)!==(v.streamId??null)||(plan.teacher_staff_id&&plan.teacher_staff_id!==v.teacherStaffId))throw new AppError(422,"LESSON_PLAN_CONTEXT_MISMATCH","Delivery context does not match the approved lesson plan");
      }
      const id=createId("adl");
      await client.query(`INSERT INTO school_academic_delivery_logs(id,organization_id,academic_year_id,term_id,class_id,stream_id,subject_id,teacher_staff_id,scheme_item_id,lesson_plan_id,delivered_on,periods_delivered,topic,subtopic,learning_outcomes_covered,learner_response,homework_given,challenges,next_steps,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,[id,p.organizationId,v.academicYearId,v.termId,v.classId,v.streamId??null,v.subjectId,v.teacherStaffId,v.schemeItemId??null,v.lessonPlanId??null,v.deliveredOn,v.periodsDelivered,v.topic,v.subtopic??null,v.learningOutcomesCovered??null,v.learnerResponse??null,v.homeworkGiven??null,v.challenges??null,v.nextSteps??null,p.userId]);
      if(v.schemeItemId)await client.query(`UPDATE school_scheme_items SET actual_periods=COALESCE(actual_periods,0)+$1,completion_status=CASE WHEN COALESCE(actual_periods,0)+$1>=planned_periods THEN 'completed' ELSE 'in_progress' END,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`,[v.periodsDelivered,v.schemeItemId,p.organizationId]);
      if(v.lessonPlanId){await client.query(`UPDATE school_lesson_plans SET status='delivered',delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`,[v.lessonPlanId,p.organizationId]);await client.query(`INSERT INTO school_lesson_plan_reviews(id,organization_id,lesson_plan_id,action,actor_user_id) VALUES($1,$2,$3,'delivered',$4)`,[createId("lpr"),p.organizationId,v.lessonPlanId,p.userId]);}
      await client.query("COMMIT");
      return c.json({data:{id,...v}},201);
    }catch(e){await client.query("ROLLBACK");throw e}finally{client.release();}
  });
  return r;
}

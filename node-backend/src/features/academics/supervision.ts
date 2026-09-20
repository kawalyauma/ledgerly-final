import { Hono } from "hono";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";
function camel(r:Record<string,unknown>){const o:Record<string,unknown>={};for(const[k,v]of Object.entries(r))o[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase())]=v;return o;}
async function owned(rt:Runtime,org:string,t:string,id?:string|null){if(!id)return;const q=await rt.db.query(`SELECT 1 FROM ${t} WHERE id=$1 AND organization_id=$2`,[id,org]);if(!q.rowCount)throw new AppError(422,"INVALID_REFERENCE","Referenced school record not found");}
export function createAcademicSupervisionRoutes(runtime:Runtime){const r=new Hono<AppEnv>();r.use("*",requireScope("school:read"));
 r.get("/supervision/overview",async c=>{const p=c.get("principal"),q=await runtime.db.query(`SELECT (SELECT COUNT(*) FROM school_lesson_plans WHERE organization_id=$1 AND status='submitted')::int lesson_plans_pending,(SELECT COUNT(*) FROM school_schemes_of_work WHERE organization_id=$1 AND status='submitted')::int schemes_pending,(SELECT COUNT(*) FROM school_academic_observations WHERE organization_id=$1 AND status<>'closed')::int open_observations`,[p.organizationId]);return c.json({data:camel(q.rows[0]??{})});});
 r.get("/supervision/observations",async c=>{const p=c.get("principal"),q=await runtime.db.query(`SELECT o.*,concat_ws(' ',sp.first_name,sp.last_name) teacher_name FROM school_academic_observations o JOIN school_staff_profiles sp ON sp.id=o.teacher_staff_id WHERE o.organization_id=$1 ORDER BY o.observed_on DESC`,[p.organizationId]);return c.json({data:q.rows.map(camel)});});
 r.post("/supervision/observations",requireScope("school:write"),async c=>{
  const p=c.get("principal"),b=await c.req.json().catch(()=>({})) as any;
  if(!b.teacherStaffId||!b.observedOn)throw new AppError(422,"VALIDATION_ERROR","teacherStaffId and observedOn are required");
  await owned(runtime,p.organizationId,"school_staff_profiles",b.teacherStaffId);
  await owned(runtime,p.organizationId,"school_lesson_plans",b.lessonPlanId);
  await owned(runtime,p.organizationId,"school_scheme_lesson_plans",b.schemeLessonPlanId);
  let classId=b.classId??null,streamId=b.streamId??null,subjectId=b.subjectId??null;
  if(b.schemeLessonId){
    const lesson=await runtime.db.query(
      `SELECT w.class_id,w.stream_id,w.subject_id
         FROM school_scheme_lessons l
         JOIN school_scheme_topics t ON t.id=l.topic_id
         JOIN school_schemes_of_work w ON w.id=t.scheme_id
        WHERE l.id=$1 AND l.organization_id=$2`,
      [b.schemeLessonId,p.organizationId],
    );
    const row=lesson.rows[0] as {class_id:string;stream_id:string|null;subject_id:string}|undefined;
    if(!row)throw new AppError(422,"INVALID_REFERENCE","school_scheme_lessons record does not belong to this school");
    classId=row.class_id;streamId=row.stream_id;subjectId=row.subject_id;
  }
  const id=createId("obs");
  await runtime.db.query(
    `INSERT INTO school_academic_observations(id,organization_id,lesson_plan_id,scheme_lesson_id,scheme_lesson_plan_id,teacher_staff_id,class_id,stream_id,subject_id,observed_on,observer_user_id,observation_type,preparation_score,delivery_score,learner_engagement_score,assessment_score,classroom_management_score,strengths,improvement_areas,agreed_actions,follow_up_on)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [id,p.organizationId,b.lessonPlanId??null,b.schemeLessonId??null,b.schemeLessonPlanId??null,b.teacherStaffId,classId,streamId,subjectId,b.observedOn,p.userId,b.observationType??"lesson_observation",b.preparationScore??null,b.deliveryScore??null,b.learnerEngagementScore??null,b.assessmentScore??null,b.classroomManagementScore??null,b.strengths??null,b.improvementAreas??null,b.agreedActions??null,b.followUpOn??null],
  );
  return c.json({data:{id,status:"open",...b,classId,streamId,subjectId}},201);
 });
 r.patch("/supervision/observations/:id",requireScope("school:write"),async c=>{
  const p=c.get("principal"),id=c.req.param("id"),b=await c.req.json().catch(()=>({})) as any;
  const existing=await runtime.db.query(`SELECT status FROM school_academic_observations WHERE id=$1 AND organization_id=$2`,[id,p.organizationId]);
  if(!existing.rowCount)throw new AppError(404,"NOT_FOUND","Observation not found");
  if(String(existing.rows[0].status)==="closed")throw new AppError(409,"OBSERVATION_CLOSED","A closed observation cannot be edited");
  await runtime.db.query(
    `UPDATE school_academic_observations SET
       preparation_score=COALESCE($1,preparation_score), delivery_score=COALESCE($2,delivery_score),
       learner_engagement_score=COALESCE($3,learner_engagement_score), assessment_score=COALESCE($4,assessment_score),
       classroom_management_score=COALESCE($5,classroom_management_score), strengths=COALESCE($6,strengths),
       improvement_areas=COALESCE($7,improvement_areas), agreed_actions=COALESCE($8,agreed_actions),
       follow_up_on=COALESCE($9,follow_up_on), updated_at=CURRENT_TIMESTAMP
     WHERE id=$10 AND organization_id=$11`,
    [b.preparationScore??null,b.deliveryScore??null,b.learnerEngagementScore??null,b.assessmentScore??null,b.classroomManagementScore??null,b.strengths??null,b.improvementAreas??null,b.agreedActions??null,b.followUpOn??null,id,p.organizationId],
  );
  return c.json({data:{id}});
 });
 r.post("/supervision/observations/:id/acknowledge",requireScope("school:write"),async c=>{
  const p=c.get("principal"),id=c.req.param("id");
  const q=await runtime.db.query(`UPDATE school_academic_observations SET status='acknowledged',teacher_acknowledged_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND status='open' RETURNING id`,[id,p.organizationId]);
  if(!q.rowCount)throw new AppError(409,"INVALID_WORKFLOW","Only an open observation can be acknowledged");
  return c.json({data:{id,status:"acknowledged"}});
 });
 r.post("/supervision/observations/:id/close",requireScope("school:write"),async c=>{
  const p=c.get("principal"),id=c.req.param("id");
  const q=await runtime.db.query(`UPDATE school_academic_observations SET status='closed',closed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND status IN ('acknowledged','follow_up_due') RETURNING id`,[id,p.organizationId]);
  if(!q.rowCount)throw new AppError(409,"INVALID_WORKFLOW","Only an acknowledged or follow-up-due observation can be closed");
  return c.json({data:{id,status:"closed"}});
 });
 return r;}

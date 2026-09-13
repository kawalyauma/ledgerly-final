import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const enroll=z.object({classId:z.string(),streamId:z.string().nullable().optional(),admissionDate:date,studentCategory:z.string().max(100).nullable().optional(),house:z.string().max(100).nullable().optional()});
function code(prefix:string){return `${prefix}-${createId("n").slice(-8).toUpperCase()}`;}
async function owned(db:{query:(sql:string,args?:unknown[])=>Promise<{rowCount:number|null}>},org:string,table:string,id?:string|null){if(!id)return;const r=await db.query(`SELECT 1 FROM ${table} WHERE id=$1 AND organization_id=$2`,[id,org]);if(!r.rowCount)throw new AppError(422,"INVALID_REFERENCE",`Referenced ${table} record does not belong to this school`);}

export function createSchoolIntegrityRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();
  r.use("*",requireScope("school:read"));

  r.post("/student-management/admissions/:id/enroll",requireScope("school:write"),async c=>{
    const parsed=enroll.safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid enrollment",parsed.error.flatten());
    const p=c.get("principal"),id=c.req.param("id"),v=parsed.data,client=await runtime.db.connect();
    let result:{applicationId:string;studentId:string;admissionNumber?:string;studentNumber?:string;replayed?:boolean};
    try{
      await client.query("BEGIN");
      const app=(await client.query<any>(`SELECT * FROM school_admission_applications WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,p.organizationId])).rows[0];
      if(!app)throw new AppError(404,"NOT_FOUND","Admission application not found");
      if(app.status==='enrolled'&&app.enrolled_student_id){result={applicationId:id,studentId:app.enrolled_student_id,replayed:true};await client.query("COMMIT");return c.json({data:result});}
      if(app.status!=='approved')throw new AppError(409,"ADMISSION_NOT_APPROVED","Admission must be approved before enrollment");
      await owned(client,p.organizationId,"school_classes",v.classId);
      await owned(client,p.organizationId,"school_streams",v.streamId);
      const cls=(await client.query<any>(`SELECT academic_year_id AS "academicYearId",class_level_id AS "classLevelId" FROM school_classes WHERE id=$1 AND organization_id=$2 FOR SHARE`,[v.classId,p.organizationId])).rows[0];
      if(!cls)throw new AppError(422,"INVALID_CLASS","Selected class does not belong to this school");
      if(v.streamId){const stream=(await client.query(`SELECT 1 FROM school_streams WHERE id=$1 AND organization_id=$2 AND class_id=$3`,[v.streamId,p.organizationId,v.classId])).rows[0];if(!stream)throw new AppError(422,"INVALID_STREAM","Selected stream does not belong to the selected class");}
      const a=app.applicant??{},g=app.guardian??{},studentId=createId("std"),contactId=createId("con"),admissionNumber=code("ADM"),studentNumber=code("STD"),name=`${a.firstName??''} ${a.middleName??''} ${a.lastName??''}`.replace(/\s+/g,' ').trim();
      await client.query(`INSERT INTO contacts(id,organization_id,type,name,email,active,custom_fields) VALUES($1,$2,'customer',$3,NULL,true,$4::jsonb)`,[contactId,p.organizationId,name,JSON.stringify({schoolStudentId:studentId,admissionNumber})]);
      await client.query(`INSERT INTO school_students(id,organization_id,contact_id,campus_id,admission_number,student_number,first_name,middle_name,last_name,preferred_name,gender,date_of_birth,nationality,place_of_birth,religion,home_language,previous_school,previous_class,admission_date,admission_class_level_id,current_academic_year_id,current_class_id,current_stream_id,student_category,residency_status,house,status,custom_fields,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13,$14,$15,$16,$17,$18,$19::date,$20,$21,$22,$23,$24,$25,$26,'active','{}'::jsonb,$27,$27)`,[studentId,p.organizationId,contactId,app.campus_id,admissionNumber,studentNumber,a.firstName,a.middleName??null,a.lastName,a.preferredName??null,a.gender??null,a.dateOfBirth??null,a.nationality??null,a.placeOfBirth??null,a.religion??null,a.homeLanguage??null,a.previousSchool??null,a.previousClass??null,v.admissionDate,app.desired_class_level_id??cls.classLevelId,app.academic_year_id??cls.academicYearId,v.classId,v.streamId??null,v.studentCategory??null,a.residencyStatus??'day',v.house??null,p.userId]);
      await client.query(`INSERT INTO school_enrollments(id,organization_id,student_id,academic_year_id,class_id,stream_id,enrolled_on,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::date,'active',$8)`,[createId('enr'),p.organizationId,studentId,app.academic_year_id??cls.academicYearId,v.classId,v.streamId??null,v.admissionDate,p.userId]);
      if(g.firstName&&g.lastName){const gid=createId('grd'),gcontact=createId('con'),gname=`${g.firstName} ${g.middleName??''} ${g.lastName}`.replace(/\s+/g,' ').trim();await client.query(`INSERT INTO contacts(id,organization_id,type,name,email,active,custom_fields) VALUES($1,$2,'customer',$3,$4,true,$5::jsonb)`,[gcontact,p.organizationId,gname,g.email??null,JSON.stringify({schoolGuardian:true})]);await client.query(`INSERT INTO school_guardians(id,organization_id,contact_id,first_name,middle_name,last_name,phone_primary,phone_secondary,email,relationship_default,occupation,physical_address) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[gid,p.organizationId,gcontact,g.firstName,g.middleName??null,g.lastName,g.phonePrimary??null,g.phoneSecondary??null,g.email??null,g.relationship??'guardian',g.occupation??null,g.physicalAddress??null]);await client.query(`INSERT INTO school_student_guardians(organization_id,student_id,guardian_id,relationship,primary_guardian) VALUES($1,$2,$3,$4,true)`,[p.organizationId,studentId,gid,g.relationship??'guardian']);}
      await client.query(`UPDATE school_admission_applications SET status='enrolled',enrolled_student_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`,[studentId,id,p.organizationId]);
      await client.query(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'school.admission.enrolled','school_admission',$4,$5::jsonb)`,[createId('aud'),p.organizationId,p.userId,id,JSON.stringify({studentId,classId:v.classId,streamId:v.streamId??null})]);
      await client.query("COMMIT");
      result={applicationId:id,studentId,admissionNumber,studentNumber};
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
    return c.json({data:result},201);
  });

  r.post("/promotion/runs/:id/apply",requireScope("school:write"),async c=>{
    const p=c.get("principal"),id=c.req.param("id"),client=await runtime.db.connect();
    try{
      await client.query("BEGIN");
      const run=(await client.query<any>(`SELECT * FROM school_promotion_runs WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[id,p.organizationId])).rows[0];
      if(!run)throw new AppError(404,"NOT_FOUND","Promotion run not found");
      if(run.status!=="draft")throw new AppError(409,"INVALID_STATE","Promotion run is not draft");
      const items=(await client.query<any>(`SELECT * FROM school_promotion_run_items WHERE organization_id=$1 AND run_id=$2 ORDER BY created_at FOR UPDATE`,[p.organizationId,id])).rows;
      if(items.some((x:any)=>!x.final_decision))throw new AppError(409,"REVIEW_REQUIRED","Resolve all review items before applying the run");
      for(const item of items){
        if(item.final_decision==='graduated'){
          await client.query(`UPDATE school_students SET status='graduated',current_academic_year_id=$1,current_class_id=NULL,current_stream_id=NULL,updated_by=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND organization_id=$4`,[run.to_academic_year_id,p.userId,item.student_id,p.organizationId]);
          continue;
        }
        if(!item.target_class_id)throw new AppError(409,"TARGET_CLASS_REQUIRED","Every promoted or repeated learner requires a target class");
        if(item.target_stream_id){const stream=(await client.query(`SELECT 1 FROM school_streams WHERE id=$1 AND organization_id=$2 AND class_id=$3`,[item.target_stream_id,p.organizationId,item.target_class_id])).rows[0];if(!stream)throw new AppError(409,"INVALID_TARGET_STREAM","Target stream does not belong to the target class");}
        const enrollmentId=createId("enr");
        const enrollment=await client.query<{id:string}>(`INSERT INTO school_enrollments(id,organization_id,student_id,academic_year_id,class_id,stream_id,enrolled_on,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::date,'active',$8) ON CONFLICT(organization_id,student_id,academic_year_id) DO UPDATE SET class_id=EXCLUDED.class_id,stream_id=EXCLUDED.stream_id,enrolled_on=EXCLUDED.enrolled_on,status='active',updated_at=CURRENT_TIMESTAMP RETURNING id`,[enrollmentId,p.organizationId,item.student_id,run.to_academic_year_id,item.target_class_id,item.target_stream_id,run.effective_on,p.userId]);
        const actualEnrollmentId=enrollment.rows[0]?.id;
        if(!actualEnrollmentId)throw new AppError(500,"ENROLLMENT_UPSERT_FAILED","Promotion enrollment did not return an enrollment id");
        await client.query(`UPDATE school_students SET current_academic_year_id=$1,current_class_id=$2,current_stream_id=$3,status='active',updated_by=$4,updated_at=CURRENT_TIMESTAMP WHERE id=$5 AND organization_id=$6`,[run.to_academic_year_id,item.target_class_id,item.target_stream_id,p.userId,item.student_id,p.organizationId]);
        await client.query(`UPDATE school_promotion_run_items SET applied_enrollment_id=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`,[actualEnrollmentId,item.id,p.organizationId]);
      }
      await client.query(`UPDATE school_promotion_runs SET status='applied',applied_by=$1,applied_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`,[p.userId,id,p.organizationId]);
      await client.query(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data) VALUES($1,$2,$3,'school.promotion.applied','school_promotion_run',$4,$5::jsonb)`,[createId('aud'),p.organizationId,p.userId,id,JSON.stringify({items:items.length})]);
      await client.query("COMMIT");
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
    return c.json({data:{id,status:'applied'}});
  });

  return r;
}

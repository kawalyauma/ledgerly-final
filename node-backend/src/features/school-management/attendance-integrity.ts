import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { createId, requireScope } from "../core-identity/security.js";

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const session=z.object({attendanceDate:date,sessionType:z.enum(["daily","period","assembly","event","other"]).default("daily"),academicYearId:z.string().optional(),termId:z.string().nullable().optional(),campusId:z.string().nullable().optional(),classId:z.string(),streamId:z.string().nullable().optional(),subjectId:z.string().nullable().optional(),title:z.string().max(200).nullable().optional(),startsAt:z.string().nullable().optional(),endsAt:z.string().nullable().optional(),source:z.enum(["manual","import","api","device"]).default("manual"),notes:z.string().max(2000).nullable().optional()});
const staffStatus=z.enum(["present","absent","late","on_leave","sick","official_duty","remote","half_day"]);
const staff=z.object({staffId:z.string(),attendanceDate:date,status:staffStatus,clockInAt:z.string().nullable().optional(),clockOutAt:z.string().nullable().optional(),workedMinutes:z.number().int().min(0).default(0),source:z.enum(["manual","clock","import","api","device"]).default("manual"),notes:z.string().max(1000).nullable().optional()});

export function createAttendanceIntegrityRoutes(runtime:Runtime){
 const r=new Hono<AppEnv>();r.use("*",requireScope("school:read"));
 r.post("/student/sessions",requireScope("school:write"),async c=>{
  const parsed=session.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid attendance session",parsed.error.flatten());
  const p=c.get("principal"),v=parsed.data,client=await runtime.db.connect();try{await client.query("BEGIN");
   const cls=(await client.query<any>(`SELECT id,academic_year_id,campus_id FROM school_classes WHERE id=$1 AND organization_id=$2 AND active=true FOR SHARE`,[v.classId,p.organizationId])).rows[0];if(!cls)throw new AppError(422,"INVALID_CLASS","Selected class is not active in this school");
   let yearId=v.academicYearId??cls.academic_year_id as string|null,termId=v.termId??null;
   if(!yearId){const y=(await client.query<any>(`SELECT id FROM school_academic_years WHERE organization_id=$1 AND starts_on<=$2::date AND ends_on>=$2::date ORDER BY is_current DESC,starts_on DESC LIMIT 1`,[p.organizationId,v.attendanceDate])).rows[0];yearId=y?.id??null;}
   if(!yearId)throw new AppError(409,"ACADEMIC_PERIOD_NOT_FOUND","No academic year covers the attendance date");
   if(cls.academic_year_id&&String(cls.academic_year_id)!==String(yearId))throw new AppError(422,"CLASS_YEAR_MISMATCH","Class does not belong to the selected academic year");
   if(termId){const t=await client.query(`SELECT 1 FROM school_terms WHERE id=$1 AND organization_id=$2 AND academic_year_id=$3 AND starts_on<=$4::date AND ends_on>=$4::date`,[termId,p.organizationId,yearId,v.attendanceDate]);if(!t.rowCount)throw new AppError(422,"INVALID_TERM","Term must belong to the academic year and cover the attendance date");}
   else {const t=(await client.query<any>(`SELECT id FROM school_terms WHERE organization_id=$1 AND academic_year_id=$2 AND starts_on<=$3::date AND ends_on>=$3::date ORDER BY is_current DESC,sequence_no LIMIT 1`,[p.organizationId,yearId,v.attendanceDate])).rows[0];termId=t?.id??null;}
   if(v.streamId){const s=await client.query(`SELECT 1 FROM school_streams WHERE id=$1 AND organization_id=$2 AND class_id=$3 AND active=true`,[v.streamId,p.organizationId,v.classId]);if(!s.rowCount)throw new AppError(422,"INVALID_STREAM","Stream does not belong to the selected class");}
   if(v.campusId&&cls.campus_id&&String(v.campusId)!==String(cls.campus_id))throw new AppError(422,"CAMPUS_MISMATCH","Attendance campus does not match the class campus");
   if(v.subjectId){const s=await client.query(`SELECT 1 FROM school_subjects WHERE id=$1 AND organization_id=$2 AND active=true`,[v.subjectId,p.organizationId]);if(!s.rowCount)throw new AppError(422,"INVALID_SUBJECT","Subject is not active in this school");}
   const roster=await client.query(`SELECT e.student_id FROM school_enrollments e JOIN school_students s ON s.id=e.student_id AND s.organization_id=e.organization_id WHERE e.organization_id=$1 AND e.academic_year_id=$2 AND e.class_id=$3 AND e.enrolled_on<=$4::date AND (e.left_on IS NULL OR e.left_on>=$4::date) AND e.status IN ('active','completed','repeated') AND s.deleted_at IS NULL AND ($5::text IS NULL OR e.stream_id=$5)`,[p.organizationId,yearId,v.classId,v.attendanceDate,v.streamId??null]);
   const id=createId("ats");await client.query(`INSERT INTO school_student_attendance_sessions(id,organization_id,academic_year_id,term_id,campus_id,attendance_date,session_type,class_id,stream_id,subject_id,title,starts_at,ends_at,expected_count,source,notes,marked_by) VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,[id,p.organizationId,yearId,termId,v.campusId??cls.campus_id??null,v.attendanceDate,v.sessionType,v.classId,v.streamId??null,v.subjectId??null,v.title??null,v.startsAt??null,v.endsAt??null,roster.rowCount??0,v.source,v.notes??null,p.userId]);
   await client.query("COMMIT");return c.json({data:{id,academicYearId:yearId,termId,expectedCount:roster.rowCount??0,status:"open",...v}},201);
  }catch(e:any){await client.query("ROLLBACK");if(e?.code==='23505')throw new AppError(409,"ATTENDANCE_SESSION_EXISTS","An equivalent attendance session already exists");throw e;}finally{client.release();}
 });
 r.put("/staff",requireScope("school:write"),async c=>{
  const parsed=z.array(staff).min(1).max(500).safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid staff attendance records",parsed.error.flatten());const p=c.get("principal"),client=await runtime.db.connect();try{await client.query("BEGIN");for(const x of parsed.data){const ok=await client.query(`SELECT 1 FROM school_staff_profiles WHERE id=$1 AND organization_id=$2 AND employment_status IN ('active','on_leave') AND deleted_at IS NULL`,[x.staffId,p.organizationId]);if(!ok.rowCount)throw new AppError(422,"STAFF_NOT_ACTIVE","Staff member is not active for attendance");await client.query(`INSERT INTO school_staff_attendance_records(id,organization_id,staff_id,attendance_date,status,clock_in_at,clock_out_at,worked_minutes,source,notes,recorded_by) VALUES($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(organization_id,staff_id,attendance_date) DO UPDATE SET status=EXCLUDED.status,clock_in_at=EXCLUDED.clock_in_at,clock_out_at=EXCLUDED.clock_out_at,worked_minutes=EXCLUDED.worked_minutes,source=EXCLUDED.source,notes=EXCLUDED.notes,recorded_by=EXCLUDED.recorded_by,updated_at=CURRENT_TIMESTAMP`,[createId("sta"),p.organizationId,x.staffId,x.attendanceDate,x.status,x.clockInAt??null,x.clockOutAt??null,x.workedMinutes,x.source,x.notes??null,p.userId]);}await client.query("COMMIT");return c.json({data:{updated:parsed.data.length}});}catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
 });
 return r;
}

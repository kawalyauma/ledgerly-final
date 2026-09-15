// @ts-nocheck
import {AppError} from "../../../src/lib/errors";

const rows=async(s:any)=>(await s.all()).results as any[];
const one=async(s:any)=>(await s.first()) as any;
const dateOnly=(d:Date)=>d.toISOString().slice(0,10);
const addDays=(iso:string,n:number)=>{const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return dateOnly(d)};
const weekday=(iso:string)=>{const n=new Date(`${iso}T12:00:00Z`).getUTCDay();return n===0?7:n};
const overlaps=(a1:string,a2:string,b1:string,b2:string)=>a1<b2&&a2>b1;

async function occurrence(db:D1Database,org:string,id:string){const x=await one(db.prepare(`SELECT o.id,o.occurrence_date AS occurrenceDate,o.status,o.effective_teacher_user_id AS teacherUserId,o.effective_room_id AS roomId,o.effective_starts_at AS startsAt,o.effective_ends_at AS endsAt,o.scheme_lesson_id AS schemeLessonId,o.lesson_plan_id AS lessonPlanId,e.timetable_id AS timetableId,e.class_id AS classId,e.stream_id AS streamId,e.subject_id AS subjectId,s.name AS subjectName,c.name AS className,TRIM(sp.first_name||' '||COALESCE(sp.middle_name||' ','')||sp.last_name) AS teacherName FROM acad_timetable_occurrences o JOIN acad_timetable_entries e ON e.id=o.timetable_entry_id JOIN school_subjects s ON s.id=e.subject_id JOIN school_classes c ON c.id=e.class_id LEFT JOIN school_staff_profiles sp ON sp.organization_id=o.organization_id AND sp.user_id=o.effective_teacher_user_id WHERE o.id=? AND o.organization_id=?`).bind(id,org));if(!x)throw new AppError(404,"NOT_FOUND","Timetable occurrence not found");return x;}

export async function substituteCandidates(db:D1Database,org:string,occurrenceId:string){
 const o=await occurrence(db,org,occurrenceId),day=weekday(o.occurrenceDate);
 const teachers=await rows(db.prepare(`SELECT sp.user_id AS userId,sp.id AS staffId,sp.staff_number AS staffNumber,TRIM(sp.first_name||' '||COALESCE(sp.middle_name||' ','')||sp.last_name) AS name,
   MAX(CASE WHEN a.subject_id=? THEN 1 ELSE 0 END) AS subjectQualified,
   MAX(CASE WHEN a.subject_id=? AND a.class_id=? AND (a.stream_id IS NULL OR ? IS NULL OR a.stream_id=?) THEN 1 ELSE 0 END) AS teachesClass
   FROM school_staff_profiles sp LEFT JOIN school_staff_teaching_assignments a ON a.organization_id=sp.organization_id AND a.staff_id=sp.id AND a.active=1
   WHERE sp.organization_id=? AND sp.is_teacher=1 AND sp.employment_status='active' AND sp.deleted_at IS NULL AND sp.user_id IS NOT NULL AND sp.user_id<>?
   GROUP BY sp.user_id,sp.id,sp.staff_number,sp.first_name,sp.middle_name,sp.last_name ORDER BY subjectQualified DESC,teachesClass DESC,sp.first_name,sp.last_name`).bind(o.subjectId,o.subjectId,o.classId,o.streamId,o.streamId,org,o.teacherUserId));
 const result:any[]=[];
 for(const t of teachers){
   const conflict=await one(db.prepare(`SELECT id FROM acad_timetable_occurrences WHERE organization_id=? AND occurrence_date=? AND effective_teacher_user_id=? AND status NOT IN ('cancelled','postponed','missed') AND effective_starts_at<? AND effective_ends_at>? LIMIT 1`).bind(org,o.occurrenceDate,t.userId,o.endsAt,o.startsAt));if(conflict)continue;
   const unavail=await one(db.prepare(`SELECT availability,reason FROM acad_teacher_availability WHERE organization_id=? AND teacher_user_id=? AND weekday=? AND starts_at<? AND ends_at>? AND availability='unavailable' LIMIT 1`).bind(org,t.userId,day,o.endsAt,o.startsAt));if(unavail)continue;
   const preferred=await one(db.prepare(`SELECT id FROM acad_teacher_availability WHERE organization_id=? AND teacher_user_id=? AND weekday=? AND starts_at<? AND ends_at>? AND availability='preferred' LIMIT 1`).bind(org,t.userId,day,o.endsAt,o.startsAt));
   const load=await one(db.prepare(`SELECT COUNT(*) n FROM acad_timetable_occurrences WHERE organization_id=? AND occurrence_date=? AND effective_teacher_user_id=? AND status NOT IN ('cancelled','postponed')`).bind(org,o.occurrenceDate,t.userId));
   let score=Number(t.subjectQualified?100:35)+Number(t.teachesClass?25:0)+Number(preferred?12:0)-Number(load?.n||0)*4;
   result.push({...t,subjectQualified:Boolean(t.subjectQualified),teachesClass:Boolean(t.teachesClass),preferred:Boolean(preferred),dailyLoad:Number(load?.n||0),score});
 }
 result.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
 const qualified=result.filter(x=>x.subjectQualified),candidates=(qualified.length?qualified:result).slice(0,15);
 return{occurrence:o,candidates,fallbackUsed:qualified.length===0,principle:qualified.length?"Subject-qualified, conflict-free teachers are ranked first; class familiarity, preferred availability and existing daily load refine the score.":"No subject-qualified free teacher was found. The returned teachers are emergency cover options and require professional review."};
}

export async function recoveryOptions(db:D1Database,org:string,occurrenceId:string,horizonDays=21){
 const o=await occurrence(db,org,occurrenceId),periods=await rows(db.prepare(`SELECT id,name,starts_at AS startsAt,ends_at AS endsAt,sequence_no AS sequenceNo FROM school_lesson_periods WHERE organization_id=? AND active=1 AND teaching_period=1 ORDER BY sequence_no`).bind(org));
 const options:any[]=[];
 for(let offset=1;offset<=Math.max(1,Math.min(60,Number(horizonDays)||21));offset++){
   const date=addDays(o.occurrenceDate,offset),day=weekday(date);if(day>5)continue;
   const closure=await one(db.prepare(`SELECT id,reason FROM acad_timetable_exceptions WHERE organization_id=? AND timetable_id=? AND status='active' AND scope_type='school' AND exception_type IN ('school_closure','emergency') AND starts_on<=? AND ends_on>=? LIMIT 1`).bind(org,o.timetableId,date,date));if(closure)continue;
   for(const p of periods){
     const classBusy=await one(db.prepare(`SELECT id FROM acad_timetable_entries WHERE organization_id=? AND timetable_id=? AND active=1 AND weekday=? AND class_id=? AND (? IS NULL OR stream_id IS NULL OR stream_id=?) AND starts_at<? AND ends_at>? LIMIT 1`).bind(org,o.timetableId,day,o.classId,o.streamId,o.streamId,p.endsAt,p.startsAt));if(classBusy)continue;
     const teacherBusy=await one(db.prepare(`SELECT id FROM acad_timetable_entries WHERE organization_id=? AND timetable_id=? AND active=1 AND weekday=? AND teacher_user_id=? AND starts_at<? AND ends_at>? LIMIT 1`).bind(org,o.timetableId,day,o.teacherUserId,p.endsAt,p.startsAt));if(teacherBusy)continue;
     const unavailable=await one(db.prepare(`SELECT id FROM acad_teacher_availability WHERE organization_id=? AND teacher_user_id=? AND weekday=? AND starts_at<? AND ends_at>? AND availability='unavailable' LIMIT 1`).bind(org,o.teacherUserId,day,p.endsAt,p.startsAt));if(unavailable)continue;
     const preferred=await one(db.prepare(`SELECT id FROM acad_teacher_availability WHERE organization_id=? AND teacher_user_id=? AND weekday=? AND starts_at<? AND ends_at>? AND availability='preferred' LIMIT 1`).bind(org,o.teacherUserId,day,p.endsAt,p.startsAt));
     const sameTime=o.startsAt===p.startsAt?10:0,score=Math.max(1,100-offset*2+sameTime+(preferred?8:0));options.push({date,weekday:day,dayName:["","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"][day],periodId:p.id,periodName:p.name,startsAt:p.startsAt,endsAt:p.endsAt,teacherUserId:o.teacherUserId,teacherName:o.teacherName,classId:o.classId,className:o.className,streamId:o.streamId,subjectId:o.subjectId,subjectName:o.subjectName,schemeLessonId:o.schemeLessonId,lessonPlanId:o.lessonPlanId,preferred:Boolean(preferred),score});
   }
   if(options.length>=20)break;
 }
 options.sort((a,b)=>b.score-a.score||a.date.localeCompare(b.date)||a.startsAt.localeCompare(b.startsAt));
 return{occurrence:o,options:options.slice(0,12),principle:"Recovery suggestions preserve the same teacher, class, subject and scheme lesson; they avoid recurring class/teacher conflicts, unavailable periods and school closures, and prefer sooner/same-time slots."};
}

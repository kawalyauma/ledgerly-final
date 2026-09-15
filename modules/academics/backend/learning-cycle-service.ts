// @ts-nocheck
import {AppError} from "../../../src/lib/errors";
import {createId} from "../../../src/lib/ids";
import * as Legacy from "./service";

const rows=async(s:any)=>(await s.all()).results as any[];
const one=async(s:any)=>(await s.first()) as any;
const text=(v:any)=>v==null?null:String(v).trim()||null;
const num=(v:any,fallback:number|null=null)=>v===null||v===undefined||v===""?fallback:Number(v);
const bool=(v:any)=>v===true||v===1||v==="1";

async function owned(db:D1Database,table:string,id:string,org:string,label:string){
  const allowed=new Set(["acad_schemes","acad_scheme_topics","acad_scheme_lessons","acad_lesson_plans","acad_lesson_assessments"]);
  if(!allowed.has(table))throw new Error("Unsafe academics table");
  const row=await one(db.prepare(`SELECT * FROM ${table} WHERE id=? AND organization_id=?`).bind(id,org));
  if(!row)throw new AppError(404,"NOT_FOUND",`${label} not found`);
  return row;
}
async function schemeForTopic(db:D1Database,org:string,topicId:string){
  const row=await one(db.prepare(`SELECT t.*,s.academic_year_id,s.term_id,s.class_id,s.stream_id,s.subject_id,s.teacher_user_id,s.status AS scheme_status
    FROM acad_scheme_topics t JOIN acad_schemes s ON s.id=t.scheme_id AND s.organization_id=t.organization_id
    WHERE t.id=? AND t.organization_id=?`).bind(topicId,org));
  if(!row)throw new AppError(404,"NOT_FOUND","Scheme topic not found");
  return row;
}
async function lessonContext(db:D1Database,org:string,lessonId:string){
  const row=await one(db.prepare(`SELECT l.*,t.title AS topic_title,t.week_from,t.week_to,s.academic_year_id,s.term_id,s.class_id,s.stream_id,s.subject_id,s.teacher_user_id,s.status AS scheme_status,s.title AS scheme_title
    FROM acad_scheme_lessons l
    JOIN acad_scheme_topics t ON t.id=l.topic_id AND t.organization_id=l.organization_id
    JOIN acad_schemes s ON s.id=l.scheme_id AND s.organization_id=l.organization_id
    WHERE l.id=? AND l.organization_id=?`).bind(lessonId,org));
  if(!row)throw new AppError(404,"NOT_FOUND","Scheme lesson not found");
  return row;
}
async function planLink(db:D1Database,org:string,planId:string){
  return one(db.prepare(`SELECT l.lesson_plan_id AS lessonPlanId,l.scheme_lesson_id AS schemeLessonId,sl.scheme_id AS schemeId,sl.topic_id AS topicId
    FROM acad_lesson_plan_links l JOIN acad_scheme_lessons sl ON sl.id=l.scheme_lesson_id
    WHERE l.organization_id=? AND l.lesson_plan_id=?`).bind(org,planId));
}
async function recalcCoverage(db:D1Database,org:string,schemeId:string){
  const stat=await one(db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN status IN ('delivered','assessed','completed') THEN 1 ELSE 0 END) covered
    FROM acad_scheme_lessons WHERE organization_id=? AND scheme_id=?`).bind(org,schemeId));
  const total=Number(stat?.total||0),covered=Number(stat?.covered||0),pct=total?Math.round((covered*1000)/total)/10:0;
  await db.prepare("UPDATE acad_schemes SET coverage_percent=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(pct,schemeId,org).run();
  return pct;
}
function editableScheme(status:string){return status!=="archived";}
function structureLocked(status:string){return !["draft","rejected"].includes(status);}

export async function listLearningSchemes(db:D1Database,org:string){
  return rows(db.prepare(`SELECT s.id,s.title,s.status,s.version_no AS versionNo,s.coverage_percent AS coveragePercent,
    s.academic_year_id AS academicYearId,ay.name AS academicYearName,s.term_id AS termId,tr.name AS termName,
    s.class_id AS classId,c.name AS className,s.stream_id AS streamId,st.name AS streamName,
    s.subject_id AS subjectId,su.name AS subjectName,s.teacher_user_id AS teacherUserId,
    TRIM(sp.first_name||' '||COALESCE(sp.middle_name||' ','')||sp.last_name) AS teacherName,
    (SELECT COUNT(*) FROM acad_scheme_topics t WHERE t.organization_id=s.organization_id AND t.scheme_id=s.id) AS topicCount,
    (SELECT COUNT(*) FROM acad_scheme_lessons l WHERE l.organization_id=s.organization_id AND l.scheme_id=s.id) AS lessonCount,
    (SELECT COUNT(*) FROM acad_lesson_plan_links lk JOIN acad_scheme_lessons l2 ON l2.id=lk.scheme_lesson_id WHERE lk.organization_id=s.organization_id AND l2.scheme_id=s.id) AS lessonPlanCount,
    (SELECT COUNT(*) FROM acad_lesson_assessments a JOIN acad_lesson_plan_links lk2 ON lk2.lesson_plan_id=a.lesson_plan_id AND lk2.organization_id=a.organization_id JOIN acad_scheme_lessons l3 ON l3.id=lk2.scheme_lesson_id WHERE a.organization_id=s.organization_id AND l3.scheme_id=s.id AND a.status='submitted') AS assessedLessonCount,
    s.updated_at AS updatedAt
    FROM acad_schemes s
    JOIN school_academic_years ay ON ay.id=s.academic_year_id
    JOIN school_terms tr ON tr.id=s.term_id
    JOIN school_classes c ON c.id=s.class_id
    LEFT JOIN school_streams st ON st.id=s.stream_id
    JOIN school_subjects su ON su.id=s.subject_id
    LEFT JOIN school_staff_profiles sp ON sp.organization_id=s.organization_id AND sp.user_id=s.teacher_user_id
    WHERE s.organization_id=? AND s.status<>'archived' ORDER BY s.updated_at DESC`).bind(org));
}

export async function createLearningScheme(db:D1Database,org:string,userId:string,d:any){
  const academicYearId=String(d.academicYearId||"").trim(),termId=String(d.termId||"").trim(),classId=String(d.classId||"").trim(),subjectId=String(d.subjectId||"").trim(),teacherUserId=String(d.teacherUserId||userId||"").trim(),streamId=text(d.streamId);
  if(!academicYearId||!termId||!classId||!subjectId||!teacherUserId)throw new AppError(422,"VALIDATION_ERROR","Academic year, term, class, subject and teacher are required");
  const [term,klass,subject,teacher,stream]=await Promise.all([
    one(db.prepare("SELECT id,name FROM school_terms WHERE id=? AND organization_id=? AND academic_year_id=?").bind(termId,org,academicYearId)),
    one(db.prepare("SELECT id,name,academic_year_id AS academicYearId FROM school_classes WHERE id=? AND organization_id=? AND active=1").bind(classId,org)),
    one(db.prepare("SELECT id,name FROM school_subjects WHERE id=? AND organization_id=? AND active=1").bind(subjectId,org)),
    one(db.prepare("SELECT sp.user_id AS id,TRIM(sp.first_name||' '||COALESCE(sp.middle_name||' ','')||sp.last_name) AS name FROM school_staff_profiles sp WHERE sp.organization_id=? AND sp.user_id=? AND sp.is_teacher=1 AND sp.employment_status='active' AND sp.deleted_at IS NULL").bind(org,teacherUserId)),
    streamId?one(db.prepare("SELECT id,name FROM school_streams WHERE id=? AND organization_id=? AND class_id=? AND active=1").bind(streamId,org,classId)):Promise.resolve(null),
  ]);
  if(!term)throw new AppError(422,"INVALID_TERM","Choose a term in the selected academic year");
  if(!klass||klass.academicYearId&&klass.academicYearId!==academicYearId)throw new AppError(422,"INVALID_CLASS","Choose a class in the selected academic year");
  if(!subject)throw new AppError(422,"INVALID_SUBJECT","Choose an active subject");
  if(!teacher)throw new AppError(422,"INVALID_TEACHER","Choose an active teacher");
  if(streamId&&!stream)throw new AppError(422,"INVALID_STREAM","Choose a stream that belongs to the selected class");
  const existing=await one(db.prepare(`SELECT id,title,status FROM acad_schemes WHERE organization_id=? AND academic_year_id=? AND term_id=? AND class_id=? AND COALESCE(stream_id,'')=COALESCE(?,'') AND subject_id=? AND teacher_user_id=? AND status<>'archived' ORDER BY created_at DESC LIMIT 1`).bind(org,academicYearId,termId,classId,streamId,subjectId,teacherUserId));
  if(existing)throw new AppError(409,"SCHEME_EXISTS",`A scheme already exists for ${klass.name} · ${subject.name} · ${term.name}.`,{schemeId:existing.id,title:existing.title,status:existing.status});
  const id=createId("asc"),title=text(d.title)||`${subject.name} · ${klass.name} · ${term.name}`;
  await db.prepare(`INSERT INTO acad_schemes(id,organization_id,academic_year_id,term_id,class_id,stream_id,subject_id,teacher_user_id,title,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(id,org,academicYearId,termId,classId,streamId,subjectId,teacherUserId,title,userId).run();
  return learningSchemeDetail(db,org,id);
}

export async function learningSchemeDetail(db:D1Database,org:string,id:string){
  const scheme=await one(db.prepare(`SELECT s.*,ay.name AS academicYearName,tr.name AS termName,c.name AS className,st.name AS streamName,su.name AS subjectName,
    TRIM(sp.first_name||' '||COALESCE(sp.middle_name||' ','')||sp.last_name) AS teacherName
    FROM acad_schemes s JOIN school_academic_years ay ON ay.id=s.academic_year_id JOIN school_terms tr ON tr.id=s.term_id JOIN school_classes c ON c.id=s.class_id LEFT JOIN school_streams st ON st.id=s.stream_id JOIN school_subjects su ON su.id=s.subject_id LEFT JOIN school_staff_profiles sp ON sp.organization_id=s.organization_id AND sp.user_id=s.teacher_user_id WHERE s.id=? AND s.organization_id=?`).bind(id,org));
  if(!scheme)throw new AppError(404,"NOT_FOUND","Scheme of work not found");
  const topics=await rows(db.prepare(`SELECT id,sequence_no AS sequenceNo,title,description,week_from AS weekFrom,week_to AS weekTo,planned_start_on AS plannedStartOn,planned_end_on AS plannedEndOn,status,teacher_reflection AS teacherReflection,created_at AS createdAt,updated_at AS updatedAt FROM acad_scheme_topics WHERE organization_id=? AND scheme_id=? ORDER BY sequence_no`).bind(org,id));
  const lessons=await rows(db.prepare(`SELECT l.id,l.topic_id AS topicId,l.sequence_no AS sequenceNo,l.lesson_no AS lessonNo,l.title,l.subtopic,l.planned_date AS plannedDate,l.duration_minutes AS durationMinutes,l.learning_outcomes AS learningOutcomes,l.teaching_methods AS teachingMethods,l.learning_resources AS learningResources,l.learner_activities AS learnerActivities,l.assessment_strategy AS assessmentStrategy,l.values_and_cross_cutting AS valuesAndCrossCutting,l.status,l.delivery_id AS deliveryId,l.teacher_reflection AS teacherReflection,
    lk.lesson_plan_id AS lessonPlanId,p.status AS lessonPlanStatus,p.lesson_date AS lessonPlanDate,a.id AS assessmentId,a.status AS assessmentStatus,a.max_score AS assessmentMaxScore,
    (SELECT COUNT(*) FROM acad_lesson_marks m WHERE m.organization_id=l.organization_id AND m.assessment_id=a.id) AS markedLearners
    FROM acad_scheme_lessons l
    LEFT JOIN acad_lesson_plan_links lk ON lk.organization_id=l.organization_id AND lk.scheme_lesson_id=l.id
    LEFT JOIN acad_lesson_plans p ON p.id=lk.lesson_plan_id
    LEFT JOIN acad_lesson_assessments a ON a.organization_id=l.organization_id AND a.lesson_plan_id=p.id
    WHERE l.organization_id=? AND l.scheme_id=? ORDER BY l.topic_id,l.sequence_no`).bind(org,id));
  const lessonIds=lessons.map(x=>x.id);let competencies:any[]=[];
  if(lessonIds.length){const placeholders=lessonIds.map(()=>"?").join(",");competencies=await rows(db.prepare(`SELECT id,scheme_lesson_id AS schemeLessonId,sequence_no AS sequenceNo,competency_type AS competencyType,code,title,description,success_criteria AS successCriteria FROM acad_lesson_competencies WHERE organization_id=? AND scheme_lesson_id IN (${placeholders}) ORDER BY scheme_lesson_id,sequence_no`).bind(org,...lessonIds));}
  const byTopic=new Map<string,any[]>();for(const lesson of lessons){lesson.competencies=competencies.filter(c=>c.schemeLessonId===lesson.id);const list=byTopic.get(lesson.topicId)||[];list.push(lesson);byTopic.set(lesson.topicId,list);}
  for(const topic of topics)topic.lessons=byTopic.get(topic.id)||[];
  const total=lessons.length,covered=lessons.filter(x=>["delivered","assessed","completed"].includes(x.status)).length,plans=lessons.filter(x=>x.lessonPlanId).length,assessed=lessons.filter(x=>x.assessmentStatus==="submitted").length;
  return {...scheme,topics,summary:{topics:topics.length,lessons:total,plans,delivered:covered,assessed,coveragePercent:total?Math.round((covered*1000)/total)/10:0}};
}

export async function addTopic(db:D1Database,org:string,userId:string,schemeId:string,d:any){
  const scheme=await owned(db,"acad_schemes",schemeId,org,"Scheme of work");
  if(!editableScheme(scheme.status))throw new AppError(409,"SCHEME_LOCKED","Archived schemes cannot be changed");
  if(!text(d.title))throw new AppError(422,"VALIDATION_ERROR","Topic title is required");
  const seq=num(d.sequenceNo)||Number((await one(db.prepare("SELECT COALESCE(MAX(sequence_no),0)+1 n FROM acad_scheme_topics WHERE organization_id=? AND scheme_id=?").bind(org,schemeId)))?.n||1),id=createId("act");
  const weekFrom=num(d.weekFrom),weekTo=num(d.weekTo,weekFrom);
  if(weekFrom!==null&&weekFrom<1||weekTo!==null&&weekTo<1)throw new AppError(422,"VALIDATION_ERROR","Week numbers must be 1 or greater");
  if(weekFrom!==null&&weekTo!==null&&weekTo<weekFrom)throw new AppError(422,"VALIDATION_ERROR","Ending week cannot be before starting week");
  await db.prepare(`INSERT INTO acad_scheme_topics(id,organization_id,scheme_id,sequence_no,title,description,week_from,week_to,planned_start_on,planned_end_on,status,teacher_reflection,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,org,schemeId,seq,text(d.title),text(d.description),weekFrom,weekTo,text(d.plannedStartOn),text(d.plannedEndOn),d.status||"planned",text(d.teacherReflection),userId).run();
  return owned(db,"acad_scheme_topics",id,org,"Scheme topic");
}

export async function updateTopic(db:D1Database,org:string,id:string,d:any){
  const topic=await schemeForTopic(db,org,id);if(!editableScheme(topic.scheme_status))throw new AppError(409,"SCHEME_LOCKED","Archived schemes cannot be changed");
  const status=text(d.status);if(status&&!['planned','in_progress','covered','carried_forward'].includes(status))throw new AppError(422,"VALIDATION_ERROR","Invalid topic status");
  await db.prepare(`UPDATE acad_scheme_topics SET title=COALESCE(?,title),description=?,week_from=?,week_to=?,planned_start_on=?,planned_end_on=?,status=COALESCE(?,status),teacher_reflection=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(text(d.title),text(d.description),num(d.weekFrom),num(d.weekTo),text(d.plannedStartOn),text(d.plannedEndOn),status,text(d.teacherReflection),id,org).run();
  return owned(db,"acad_scheme_topics",id,org,"Scheme topic");
}

export async function addLesson(db:D1Database,org:string,userId:string,topicId:string,d:any){
  const topic=await schemeForTopic(db,org,topicId);if(!editableScheme(topic.scheme_status))throw new AppError(409,"SCHEME_LOCKED","Archived schemes cannot be changed");
  if(!text(d.title))throw new AppError(422,"VALIDATION_ERROR","Lesson title is required");
  const seq=num(d.sequenceNo)||Number((await one(db.prepare("SELECT COALESCE(MAX(sequence_no),0)+1 n FROM acad_scheme_lessons WHERE organization_id=? AND topic_id=?").bind(org,topicId)))?.n||1),lessonNo=num(d.lessonNo)||Number((await one(db.prepare("SELECT COALESCE(MAX(lesson_no),0)+1 n FROM acad_scheme_lessons WHERE organization_id=? AND scheme_id=?").bind(org,topic.scheme_id)))?.n||1),duration=Math.max(1,Math.round(num(d.durationMinutes,40)||40)),id=createId("acl");
  await db.prepare(`INSERT INTO acad_scheme_lessons(id,organization_id,scheme_id,topic_id,sequence_no,lesson_no,title,subtopic,planned_date,duration_minutes,learning_outcomes,teaching_methods,learning_resources,learner_activities,assessment_strategy,values_and_cross_cutting,status,teacher_reflection,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,org,topic.scheme_id,topicId,seq,lessonNo,text(d.title),text(d.subtopic),text(d.plannedDate),duration,text(d.learningOutcomes),text(d.teachingMethods),text(d.learningResources),text(d.learnerActivities),text(d.assessmentStrategy),text(d.valuesAndCrossCutting),d.status||"planned",text(d.teacherReflection),userId).run();
  return lessonContext(db,org,id);
}

export async function updateLesson(db:D1Database,org:string,id:string,d:any){
  const lesson=await lessonContext(db,org,id);if(!editableScheme(lesson.scheme_status))throw new AppError(409,"SCHEME_LOCKED","Archived schemes cannot be changed");
  const status=text(d.status);if(status&&!['planned','plan_drafted','plan_submitted','plan_approved','delivered','assessed','completed'].includes(status))throw new AppError(422,"VALIDATION_ERROR","Invalid lesson status");
  await db.prepare(`UPDATE acad_scheme_lessons SET title=COALESCE(?,title),subtopic=?,planned_date=?,duration_minutes=COALESCE(?,duration_minutes),learning_outcomes=?,teaching_methods=?,learning_resources=?,learner_activities=?,assessment_strategy=?,values_and_cross_cutting=?,status=COALESCE(?,status),teacher_reflection=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(text(d.title),text(d.subtopic),text(d.plannedDate),num(d.durationMinutes),text(d.learningOutcomes),text(d.teachingMethods),text(d.learningResources),text(d.learnerActivities),text(d.assessmentStrategy),text(d.valuesAndCrossCutting),status,text(d.teacherReflection),id,org).run();
  if(status)await recalcCoverage(db,org,lesson.scheme_id);
  return lessonContext(db,org,id);
}

export async function replaceCompetencies(db:D1Database,org:string,userId:string,lessonId:string,input:any[]){
  const lesson=await lessonContext(db,org,lessonId);if(["plan_approved","delivered","assessed","completed"].includes(lesson.status))throw new AppError(409,"LESSON_COMPETENCIES_LOCKED","Competencies are locked after the lesson plan is approved. Reopen the planning cycle before changing them.");
  const items=(Array.isArray(input)?input:[]).map((x,i)=>({sequenceNo:i+1,competencyType:String(x.competencyType||"specific"),code:text(x.code),title:String(x.title||"").trim(),description:text(x.description),successCriteria:text(x.successCriteria)})).filter(x=>x.title);
  if(!items.length)throw new AppError(422,"VALIDATION_ERROR","Add at least one competency to the lesson");
  for(const item of items)if(!['specific','generic','values','literacy','numeracy','digital','other'].includes(item.competencyType))throw new AppError(422,"VALIDATION_ERROR",`Invalid competency type: ${item.competencyType}`);
  const statements=[db.prepare("DELETE FROM acad_lesson_competencies WHERE organization_id=? AND scheme_lesson_id=?").bind(org,lessonId)];
  for(const item of items)statements.push(db.prepare(`INSERT INTO acad_lesson_competencies(id,organization_id,scheme_lesson_id,sequence_no,competency_type,code,title,description,success_criteria,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(createId("acc"),org,lessonId,item.sequenceNo,item.competencyType,item.code,item.title,item.description,item.successCriteria,userId));
  await db.batch(statements);
  return rows(db.prepare(`SELECT id,scheme_lesson_id AS schemeLessonId,sequence_no AS sequenceNo,competency_type AS competencyType,code,title,description,success_criteria AS successCriteria FROM acad_lesson_competencies WHERE organization_id=? AND scheme_lesson_id=? ORDER BY sequence_no`).bind(org,lessonId));
}

export async function createPlanFromLesson(db:D1Database,org:string,userId:string,lessonId:string,d:any){
  const lesson=await lessonContext(db,org,lessonId);if(!editableScheme(lesson.scheme_status))throw new AppError(409,"SCHEME_LOCKED","Archived schemes cannot create lesson plans");
  const existing=await one(db.prepare("SELECT lesson_plan_id AS lessonPlanId FROM acad_lesson_plan_links WHERE organization_id=? AND scheme_lesson_id=?").bind(org,lessonId));
  if(existing)throw new AppError(409,"LESSON_PLAN_EXISTS","This scheme lesson already has a lesson plan.",{lessonPlanId:existing.lessonPlanId});
  const competencies=await rows(db.prepare("SELECT title,success_criteria AS successCriteria FROM acad_lesson_competencies WHERE organization_id=? AND scheme_lesson_id=? ORDER BY sequence_no").bind(org,lessonId));
  if(!competencies.length)throw new AppError(409,"COMPETENCIES_REQUIRED","Add the lesson competencies before drafting its lesson plan");
  const lessonDate=text(d.lessonDate)||text(lesson.planned_date);if(!lessonDate)throw new AppError(422,"VALIDATION_ERROR","Lesson date is required before creating the lesson plan");
  const id=createId("alp"),objectives=text(d.lessonObjectives)||text(lesson.learning_outcomes)||competencies.map(x=>x.title).join("; ");
  await db.batch([
    db.prepare(`INSERT INTO acad_lesson_plans(id,organization_id,academic_year_id,term_id,class_id,stream_id,subject_id,teacher_user_id,timetable_entry_id,scheme_item_id,template_id,lesson_date,week_no,lesson_no,topic,subtopic,lesson_objectives,prior_knowledge,introduction_text,lesson_development,teacher_activities,learner_activities,teaching_methods,required_materials,differentiated_instruction,special_needs_accommodations,lesson_assessment,lesson_conclusion,homework,teacher_reflection,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      id,org,lesson.academic_year_id,lesson.term_id,lesson.class_id,lesson.stream_id,lesson.subject_id,lesson.teacher_user_id,text(d.timetableEntryId),null,text(d.templateId),lessonDate,lesson.week_from,lesson.lesson_no,lesson.topic_title,text(lesson.subtopic)||lesson.title,objectives,text(d.priorKnowledge),text(d.introductionText),text(d.lessonDevelopment),text(d.teacherActivities),text(d.learnerActivities)||text(lesson.learner_activities),text(d.teachingMethods)||text(lesson.teaching_methods),text(d.requiredMaterials)||text(lesson.learning_resources),text(d.differentiatedInstruction),text(d.specialNeedsAccommodations),text(d.lessonAssessment)||text(lesson.assessment_strategy),text(d.lessonConclusion),text(d.homework),text(d.teacherReflection),userId
    ),
    db.prepare("INSERT INTO acad_lesson_plan_links(organization_id,lesson_plan_id,scheme_lesson_id,created_by) VALUES(?,?,?,?)").bind(org,id,lessonId,userId),
    db.prepare("UPDATE acad_scheme_lessons SET status='plan_drafted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(lessonId,org),
  ]);
  return lessonPlanLearningDetail(db,org,id);
}

export async function lessonPlanLearningDetail(db:D1Database,org:string,planId:string){
  const row=await one(db.prepare(`SELECT p.*,lk.scheme_lesson_id AS schemeLessonId,l.scheme_id AS schemeId,l.topic_id AS topicId,l.title AS schemeLessonTitle,l.status AS schemeLessonStatus,t.title AS schemeTopicTitle,s.title AS schemeTitle,c.name AS className,st.name AS streamName,su.name AS subjectName,
    TRIM(sp.first_name||' '||COALESCE(sp.middle_name||' ','')||sp.last_name) AS teacherName
    FROM acad_lesson_plans p
    LEFT JOIN acad_lesson_plan_links lk ON lk.organization_id=p.organization_id AND lk.lesson_plan_id=p.id
    LEFT JOIN acad_scheme_lessons l ON l.id=lk.scheme_lesson_id
    LEFT JOIN acad_scheme_topics t ON t.id=l.topic_id
    LEFT JOIN acad_schemes s ON s.id=l.scheme_id
    JOIN school_classes c ON c.id=p.class_id LEFT JOIN school_streams st ON st.id=p.stream_id JOIN school_subjects su ON su.id=p.subject_id LEFT JOIN school_staff_profiles sp ON sp.organization_id=p.organization_id AND sp.user_id=p.teacher_user_id
    WHERE p.id=? AND p.organization_id=?`).bind(planId,org));
  if(!row)throw new AppError(404,"NOT_FOUND","Lesson plan not found");
  let competencies:any[]=[];if(row.schemeLessonId)competencies=await rows(db.prepare(`SELECT id,sequence_no AS sequenceNo,competency_type AS competencyType,code,title,description,success_criteria AS successCriteria FROM acad_lesson_competencies WHERE organization_id=? AND scheme_lesson_id=? ORDER BY sequence_no`).bind(org,row.schemeLessonId));
  const assessment=await one(db.prepare(`SELECT id,title,assessment_type AS assessmentType,max_score AS maxScore,instructions,status,submitted_by AS submittedBy,submitted_at AS submittedAt,created_at AS createdAt,updated_at AS updatedAt,(SELECT COUNT(*) FROM acad_lesson_marks m WHERE m.organization_id=a.organization_id AND m.assessment_id=a.id) AS markCount FROM acad_lesson_assessments a WHERE organization_id=? AND lesson_plan_id=?`).bind(org,planId));
  return {...row,competencies,assessment};
}

export async function lessonPlanWorkflow(db:D1Database,org:string,planId:string,userId:string,action:string,feedback?:string){
  if(action==="resubmit"){
    const p=await owned(db,"acad_lesson_plans",planId,org,"Lesson plan");if(p.status!=="rejected")throw new AppError(409,"INVALID_STATUS",`Cannot resubmit a lesson plan from ${p.status}.`);
    await db.prepare("UPDATE acad_lesson_plans SET status='submitted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(planId,org).run();
  }else await Legacy.lessonWorkflow(db,org,planId,userId,action,feedback);
  const link=await planLink(db,org,planId);if(link){const next=action==="approve"?"plan_approved":action==="submit"||action==="resubmit"?"plan_submitted":action==="reject"?"plan_drafted":null;if(next)await db.prepare("UPDATE acad_scheme_lessons SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(next,link.schemeLessonId,org).run();}
  return lessonPlanLearningDetail(db,org,planId);
}

export async function recordDelivery(db:D1Database,org:string,userId:string,lessonId:string,d:any){
  const lesson=await lessonContext(db,org,lessonId),link=await one(db.prepare("SELECT lesson_plan_id AS lessonPlanId FROM acad_lesson_plan_links WHERE organization_id=? AND scheme_lesson_id=?").bind(org,lessonId));
  if(!link)throw new AppError(409,"LESSON_PLAN_REQUIRED","Create and submit the lesson plan before recording delivery");
  const plan=await owned(db,"acad_lesson_plans",link.lessonPlanId,org,"Lesson plan");if(!["approved","delivered"].includes(plan.status))throw new AppError(409,"LESSON_PLAN_NOT_APPROVED","The lesson plan must be approved before delivery is recorded");
  const taughtOn=text(d.taughtOn)||text(plan.lesson_date)||text(lesson.planned_date)||new Date().toISOString().slice(0,10);let deliveryId=lesson.delivery_id;
  if(deliveryId){await db.prepare(`UPDATE acad_lesson_deliveries SET delivery_status='taught',lesson_plan_id=?,actual_starts_at=?,actual_ends_at=?,actual_topic=?,actual_subtopic=?,lesson_notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(plan.id,text(d.actualStartsAt),text(d.actualEndsAt),lesson.topic_title,text(lesson.subtopic)||lesson.title,text(d.lessonNotes),deliveryId,org).run();}
  else{deliveryId=createId("ald");await db.prepare(`INSERT INTO acad_lesson_deliveries(id,organization_id,lesson_plan_id,academic_year_id,term_id,class_id,stream_id,subject_id,teacher_user_id,scheduled_date,actual_starts_at,actual_ends_at,delivery_status,actual_topic,actual_subtopic,lesson_notes,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'taught',?,?,?,?)`).bind(deliveryId,org,plan.id,lesson.academic_year_id,lesson.term_id,lesson.class_id,lesson.stream_id,lesson.subject_id,lesson.teacher_user_id,taughtOn,text(d.actualStartsAt),text(d.actualEndsAt),lesson.topic_title,text(lesson.subtopic)||lesson.title,text(d.lessonNotes),userId).run();}
  await db.batch([
    db.prepare("UPDATE acad_scheme_lessons SET status='delivered',delivery_id=?,teacher_reflection=COALESCE(?,teacher_reflection),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(deliveryId,text(d.teacherReflection),lessonId,org),
    db.prepare("UPDATE acad_lesson_plans SET status='delivered',teacher_reflection=COALESCE(?,teacher_reflection),updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(text(d.teacherReflection),plan.id,org),
  ]);
  await recalcCoverage(db,org,lesson.scheme_id);
  return {deliveryId,lesson:await lessonContext(db,org,lessonId),plan:await lessonPlanLearningDetail(db,org,plan.id)};
}

async function roster(db:D1Database,org:string,plan:any){
  let learners=await rows(db.prepare(`SELECT st.id,st.admission_number AS admissionNumber,st.student_number AS studentNumber,TRIM(st.first_name||' '||COALESCE(st.middle_name||' ','')||st.last_name) AS name,e.stream_id AS streamId
    FROM school_enrollments e JOIN school_students st ON st.id=e.student_id AND st.organization_id=e.organization_id
    WHERE e.organization_id=? AND e.academic_year_id=? AND e.class_id=? AND e.status='active' AND st.status='active' AND st.deleted_at IS NULL AND (? IS NULL OR e.stream_id=?) ORDER BY st.first_name,st.last_name`).bind(org,plan.academic_year_id,plan.class_id,plan.stream_id,plan.stream_id));
  if(!learners.length)learners=await rows(db.prepare(`SELECT st.id,st.admission_number AS admissionNumber,st.student_number AS studentNumber,TRIM(st.first_name||' '||COALESCE(st.middle_name||' ','')||st.last_name) AS name,st.current_stream_id AS streamId FROM school_students st WHERE st.organization_id=? AND st.current_academic_year_id=? AND st.current_class_id=? AND st.status='active' AND st.deleted_at IS NULL AND (? IS NULL OR st.current_stream_id=?) ORDER BY st.first_name,st.last_name`).bind(org,plan.academic_year_id,plan.class_id,plan.stream_id,plan.stream_id));
  return learners;
}

export async function assessmentRoster(db:D1Database,org:string,planId:string){
  const plan=await owned(db,"acad_lesson_plans",planId,org,"Lesson plan"),link=await planLink(db,org,planId),assessment=await one(db.prepare(`SELECT id,title,assessment_type AS assessmentType,max_score AS maxScore,instructions,status,submitted_by AS submittedBy,submitted_at AS submittedAt FROM acad_lesson_assessments WHERE organization_id=? AND lesson_plan_id=?`).bind(org,planId));
  const learners=await roster(db,org,plan),marks=assessment?await rows(db.prepare(`SELECT id,student_id AS studentId,score,absent,competency_level AS competencyLevel,remark,updated_at AS updatedAt FROM acad_lesson_marks WHERE organization_id=? AND assessment_id=?`).bind(org,assessment.id)):[],markMap=new Map(marks.map(x=>[x.studentId,x]));
  const competencies=link?await rows(db.prepare(`SELECT id,competency_type AS competencyType,code,title,success_criteria AS successCriteria FROM acad_lesson_competencies WHERE organization_id=? AND scheme_lesson_id=? ORDER BY sequence_no`).bind(org,link.schemeLessonId)):[];
  const rosterRows=learners.map(l=>({...l,mark:markMap.get(l.id)||null}));
  const scored=marks.filter(x=>!bool(x.absent)&&x.score!==null&&x.score!==undefined),average=scored.length?Math.round(scored.reduce((s,x)=>s+Number(x.score||0),0)*100/scored.length)/100:null;
  return {planId,planStatus:plan.status,schemeLessonId:link?.schemeLessonId||null,assessment:assessment||null,competencies,learners:rosterRows,summary:{learners:learners.length,recorded:marks.length,scored:scored.length,absent:marks.filter(x=>bool(x.absent)).length,average}};
}

export async function saveAssessment(db:D1Database,org:string,userId:string,planId:string,d:any){
  const plan=await owned(db,"acad_lesson_plans",planId,org,"Lesson plan");if(!["approved","delivered"].includes(plan.status))throw new AppError(409,"PLAN_NOT_READY_FOR_MARKS","Approve the lesson plan before entering learner marks");
  const current=await one(db.prepare("SELECT * FROM acad_lesson_assessments WHERE organization_id=? AND lesson_plan_id=?").bind(org,planId));if(current?.status==="submitted")throw new AppError(409,"MARKS_LOCKED","Submitted lesson marks are locked. A supervisor must reopen them before corrections.");
  const maxScore=Number(d.maxScore??current?.max_score??100);if(!Number.isFinite(maxScore)||maxScore<=0)throw new AppError(422,"VALIDATION_ERROR","Maximum score must be greater than zero");
  const link=await planLink(db,org,planId);if(!link)throw new AppError(409,"SCHEME_LESSON_REQUIRED","Lesson marks can only be submitted for lesson plans created from a scheme lesson");
  const learners=await roster(db,org,plan),allowed=new Set(learners.map(x=>x.id)),marks=Array.isArray(d.marks)?d.marks:[];
  const ids=new Set<string>();for(const mark of marks){const studentId=String(mark.studentId||"").trim();if(!studentId||!allowed.has(studentId))throw new AppError(422,"INVALID_LEARNER","One or more learners do not belong to this lesson's class/stream");if(ids.has(studentId))throw new AppError(422,"DUPLICATE_LEARNER","A learner can only appear once in a lesson mark sheet");ids.add(studentId);const absent=bool(mark.absent),score=mark.score===null||mark.score===undefined||mark.score===""?null:Number(mark.score);if(!absent&&(score===null||!Number.isFinite(score)||score<0||score>maxScore))throw new AppError(422,"INVALID_SCORE",`Scores must be between 0 and ${maxScore}, or mark the learner absent.`);const level=String(mark.competencyLevel||"not_assessed");if(!['not_assessed','emerging','developing','proficient','advanced'].includes(level))throw new AppError(422,"INVALID_COMPETENCY_LEVEL","Invalid competency level");}
  const assessmentId=current?.id||createId("ala"),assessmentType=String(d.assessmentType||current?.assessment_type||"formative");if(!['formative','oral','written','practical','observation','project','homework','other'].includes(assessmentType))throw new AppError(422,"VALIDATION_ERROR","Invalid assessment type");
  const statements:any[]=[];
  if(current)statements.push(db.prepare(`UPDATE acad_lesson_assessments SET title=COALESCE(?,title),assessment_type=?,max_score=?,instructions=?,status='draft',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(text(d.title),assessmentType,maxScore,text(d.instructions),assessmentId,org));
  else statements.push(db.prepare(`INSERT INTO acad_lesson_assessments(id,organization_id,lesson_plan_id,title,assessment_type,max_score,instructions,status,created_by) VALUES(?,?,?,?,?,?,?,'draft',?)`).bind(assessmentId,org,planId,text(d.title)||"Lesson assessment",assessmentType,maxScore,text(d.instructions),userId));
  for(const mark of marks){const studentId=String(mark.studentId),absent=bool(mark.absent),score=absent?null:Number(mark.score),level=String(mark.competencyLevel||"not_assessed");statements.push(db.prepare(`INSERT INTO acad_lesson_marks(id,organization_id,assessment_id,student_id,score,absent,competency_level,remark,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,assessment_id,student_id) DO UPDATE SET score=excluded.score,absent=excluded.absent,competency_level=excluded.competency_level,remark=excluded.remark,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`).bind(createId("alm"),org,assessmentId,studentId,score,absent?1:0,level,text(mark.remark),userId,userId));}
  await db.batch(statements);
  return assessmentRoster(db,org,planId);
}

export async function submitAssessment(db:D1Database,org:string,userId:string,planId:string){
  const plan=await owned(db,"acad_lesson_plans",planId,org,"Lesson plan"),assessment=await one(db.prepare("SELECT * FROM acad_lesson_assessments WHERE organization_id=? AND lesson_plan_id=?").bind(org,planId));
  if(!assessment)throw new AppError(409,"MARKS_REQUIRED","Save learner marks before submitting them");if(assessment.status==="submitted")return assessmentRoster(db,org,planId);
  const learners=await roster(db,org,plan),marks=await rows(db.prepare("SELECT student_id AS studentId,score,absent FROM acad_lesson_marks WHERE organization_id=? AND assessment_id=?").bind(org,assessment.id)),marked=new Map(marks.map(x=>[x.studentId,x]));
  const missing=learners.filter(l=>{const m=marked.get(l.id);return !m||(!bool(m.absent)&&(m.score===null||m.score===undefined));});if(missing.length)throw new AppError(409,"INCOMPLETE_MARKS",`Complete the mark sheet before submission. ${missing.length} learner${missing.length===1?" is":"s are"} still unmarked.`,{missing:missing.slice(0,30)});
  const link=await planLink(db,org,planId);await db.batch([
    db.prepare("UPDATE acad_lesson_assessments SET status='submitted',submitted_by=?,submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(userId,assessment.id,org),
    ...(link?[db.prepare("UPDATE acad_scheme_lessons SET status='assessed',updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(link.schemeLessonId,org)]:[]),
  ]);
  if(link)await recalcCoverage(db,org,link.schemeId);
  return assessmentRoster(db,org,planId);
}

export async function reopenAssessment(db:D1Database,org:string,planId:string){
  const assessment=await one(db.prepare("SELECT id,status FROM acad_lesson_assessments WHERE organization_id=? AND lesson_plan_id=?").bind(org,planId));if(!assessment)throw new AppError(404,"NOT_FOUND","Lesson assessment not found");if(assessment.status!=="submitted")throw new AppError(409,"INVALID_STATUS","Only submitted lesson marks can be reopened");
  await db.prepare("UPDATE acad_lesson_assessments SET status='reopened',submitted_by=NULL,submitted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(assessment.id,org).run();
  return assessmentRoster(db,org,planId);
}

export async function learningDashboard(db:D1Database,org:string){
  const stats=await one(db.prepare(`SELECT
    (SELECT COUNT(*) FROM acad_schemes WHERE organization_id=? AND status<>'archived') AS schemes,
    (SELECT COUNT(*) FROM acad_scheme_topics WHERE organization_id=?) AS topics,
    (SELECT COUNT(*) FROM acad_scheme_lessons WHERE organization_id=?) AS lessons,
    (SELECT COUNT(*) FROM acad_scheme_lessons WHERE organization_id=? AND status IN ('delivered','assessed','completed')) AS delivered,
    (SELECT COUNT(*) FROM acad_lesson_plan_links WHERE organization_id=?) AS plans,
    (SELECT COUNT(*) FROM acad_lesson_assessments WHERE organization_id=? AND status='submitted') AS assessed`).bind(org,org,org,org,org,org));
  const due=await rows(db.prepare(`SELECT l.id,l.title,l.planned_date AS plannedDate,l.status,t.title AS topicTitle,s.id AS schemeId,s.title AS schemeTitle,c.name AS className,su.name AS subjectName
    FROM acad_scheme_lessons l JOIN acad_scheme_topics t ON t.id=l.topic_id JOIN acad_schemes s ON s.id=l.scheme_id JOIN school_classes c ON c.id=s.class_id JOIN school_subjects su ON su.id=s.subject_id
    WHERE l.organization_id=? AND l.status NOT IN ('assessed','completed') ORDER BY CASE WHEN l.planned_date IS NULL THEN 1 ELSE 0 END,l.planned_date,l.sequence_no LIMIT 20`).bind(org));
  const lessons=Number(stats?.lessons||0),delivered=Number(stats?.delivered||0);return {...stats,coveragePercent:lessons?Math.round((delivered*1000)/lessons)/10:0,dueLessons:due};
}

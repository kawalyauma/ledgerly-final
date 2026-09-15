// @ts-nocheck
import {createId} from "../../../src/lib/ids";

const rows=async(s:any)=>(await s.all()).results as any[];
export async function syncCurriculumLoadRules(db:D1Database,org:string,userId:string,timetableId:string){
 const t=await db.prepare("SELECT id,academic_year_id AS academicYearId FROM acad_timetables WHERE id=? AND organization_id=?").bind(timetableId,org).first<any>();if(!t)return{synced:0};
 const loads=await rows(db.prepare(`SELECT c.id AS classId,cs.subject_id AS subjectId,s.name AS subjectName,cs.periods_per_week AS periodsPerWeek
  FROM school_classes c JOIN school_class_subjects cs ON cs.organization_id=c.organization_id AND cs.class_level_id=c.class_level_id AND cs.active=1 AND (cs.academic_year_id IS NULL OR cs.academic_year_id=c.academic_year_id)
  JOIN school_subjects s ON s.id=cs.subject_id AND s.organization_id=cs.organization_id
  WHERE c.organization_id=? AND c.academic_year_id=? AND c.active=1 AND cs.periods_per_week IS NOT NULL AND cs.periods_per_week>0`).bind(org,t.academicYearId));
 await db.prepare("UPDATE acad_timetable_rules SET active=0,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND timetable_id=? AND notes LIKE '[canonical-load]%'").bind(org,timetableId).run();
 // Canonical curriculum loads are deliberately lower priority than an explicit school timetable rule.
 // They are the professional default, not an override of a DOS/Head Teacher decision.
 const statements=loads.map(x=>db.prepare(`INSERT INTO acad_timetable_rules(id,organization_id,timetable_id,scope_type,scope_id,rule_type,config_json,hardness,priority,active,notes,created_by) VALUES(?,?,?,'subject',?,'weekly_periods',?,'soft',60,1,?,?)`).bind(createId("atr"),org,timetableId,x.subjectId,JSON.stringify({classId:x.classId,periods:Number(x.periodsPerWeek),source:"school_class_subjects"}),`[canonical-load] ${x.subjectName}: ${x.periodsPerWeek} period(s) per week`,userId));
 for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));
 return{synced:loads.length,loads:loads.map(x=>({classId:x.classId,subjectId:x.subjectId,subjectName:x.subjectName,periodsPerWeek:Number(x.periodsPerWeek)}))};
}

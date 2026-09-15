// @ts-nocheck
const rows=async(s:any)=>(await s.all()).results as any[];
const json=(v:any,f:any={})=>{if(v==null)return f;if(typeof v==="object")return v;try{return JSON.parse(String(v))}catch{return f}};
const key=(...xs:any[])=>xs.map(x=>String(x??"*")).join(":");
const applies=(r:any,e:any)=>{
 const cfg=r.config||{};
 if(r.scopeType==="school")return true;
 if(r.scopeType==="teacher")return r.scopeId===e.teacherUserId;
 if(r.scopeType==="class")return r.scopeId===e.classId;
 if(r.scopeType==="stream")return r.scopeId===e.streamId;
 if(r.scopeType==="subject")return r.scopeId===e.subjectId&&(!cfg.classId||cfg.classId===e.classId)&&(!cfg.streamId||cfg.streamId===e.streamId);
 if(r.scopeType==="room")return r.scopeId===e.roomId;
 return false;
};
const issue=(r:any,type:string,message:string,details:any={})=>({type,severity:r.hardness==="hard"?"hard":"soft",ruleType:r.ruleType,ruleId:r.id||null,message,...details});

export async function reviewGeneratedDraft(db:D1Database,org:string,timetableId:string,draft:any){
 const custom=(await rows(db.prepare(`SELECT id,scope_type AS scopeType,scope_id AS scopeId,rule_type AS ruleType,config_json AS configJson,hardness,priority,notes FROM acad_timetable_rules WHERE organization_id=? AND active=1 AND (timetable_id IS NULL OR timetable_id=?)`).bind(org,timetableId))).map(r=>({...r,config:json(r.configJson,{})}));
 const periods=await rows(db.prepare(`SELECT id,sequence_no AS sequenceNo FROM school_lesson_periods WHERE organization_id=? AND active=1 AND teaching_period=1 ORDER BY sequence_no`).bind(org));
 const pIndex=new Map(periods.map((p:any,i:number)=>[p.id,i]));
 const existing=draft.mode==="fill_gaps"?await rows(db.prepare(`SELECT class_id AS classId,stream_id AS streamId,subject_id AS subjectId,teacher_user_id AS teacherUserId,room_id AS roomId,weekday,period_id AS periodId,starts_at AS startsAt,ends_at AS endsAt,lesson_count AS lessonCount FROM acad_timetable_entries WHERE organization_id=? AND timetable_id=? AND active=1 AND source NOT IN ('rule_engine','ai_draft')`).bind(org,timetableId)):[];
 const entries=[...existing,...(draft.proposedEntries||[])],issues:any[]=[];
 for(const r of custom){
  const cfg=r.config||{},matched=entries.filter((e:any)=>applies(r,e));
  if(r.ruleType==="working_days"){
   const days=new Set((cfg.days||[]).map(Number));for(const e of matched)if(days.size&&!days.has(Number(e.weekday)))issues.push(issue(r,"working_day",`An entry is placed on ${e.weekday}, outside the configured working days.`,{entry:e}));
  }else if(r.ruleType==="teacher_daily_max"){
   const max=Math.max(1,Number(cfg.periods||1)),groups=new Map<string,{count:number;sample:any}>();for(const e of matched){const k=key(e.teacherUserId,e.weekday),g=groups.get(k)||{count:0,sample:e};g.count+=Number(e.lessonCount||1);groups.set(k,g)}for(const g of groups.values())if(g.count>max)issues.push(issue(r,"teacher_daily_max",`${g.sample.teacherName||"A teacher"} has ${g.count} periods on one day; maximum is ${max}.`,{teacherUserId:g.sample.teacherUserId,weekday:g.sample.weekday,count:g.count,max}));
  }else if(r.ruleType==="class_daily_subject_max"){
   const max=Math.max(1,Number(cfg.periods||1)),groups=new Map<string,{count:number;sample:any}>();for(const e of matched){const k=key(e.classId,e.streamId,e.weekday,e.subjectId),g=groups.get(k)||{count:0,sample:e};g.count+=Number(e.lessonCount||1);groups.set(k,g)}for(const g of groups.values())if(g.count>max)issues.push(issue(r,"class_daily_subject_max",`${g.sample.subjectName||"A subject"} has ${g.count} periods for one class on the same day; maximum is ${max}.`,{classId:g.sample.classId,streamId:g.sample.streamId,subjectId:g.sample.subjectId,weekday:g.sample.weekday,count:g.count,max}));
  }else if(r.ruleType==="avoid_period"){
   for(const e of matched)if((!cfg.day||Number(cfg.day)===Number(e.weekday))&&(!cfg.periodId||cfg.periodId===e.periodId))issues.push(issue(r,"avoid_period",`An entry uses a period configured to be avoided.`,{entry:e}));
  }else if(r.ruleType==="fixed_slot"){
   const day=Number(cfg.day),periodId=String(cfg.periodId||""),exact=matched.filter((e:any)=>Number(e.weekday)===day&&e.periodId===periodId);if(!day||!periodId||!exact.length)issues.push(issue(r,"fixed_slot",`The required fixed slot is not occupied by the selected class and subject.`,{classId:cfg.classId||null,streamId:cfg.streamId||null,subjectId:r.scopeId||null,weekday:day||null,periodId:periodId||null}));else if(cfg.lessonCount&&exact.every((e:any)=>Number(e.lessonCount||1)<Number(cfg.lessonCount)))issues.push(issue(r,"fixed_slot_length",`The fixed slot is present but is shorter than the configured ${Number(cfg.lessonCount)} period(s).`,{classId:cfg.classId||null,streamId:cfg.streamId||null,subjectId:r.scopeId||null,weekday:day,periodId,lessonCount:Number(cfg.lessonCount)}));
  }else if(r.ruleType==="weekly_periods"){
   const expected=Math.max(1,Number(cfg.periods||1)),groups=new Map<string,{count:number;sample:any}>();for(const e of matched){const k=key(e.classId,e.streamId,e.subjectId),g=groups.get(k)||{count:0,sample:e};g.count+=Number(e.lessonCount||1);groups.set(k,g)}for(const g of groups.values())if(g.count!==expected)issues.push(issue(r,"weekly_periods",`${g.sample.subjectName||"Subject"} has ${g.count} periods/week for this class; rule expects ${expected}.`,{classId:g.sample.classId,streamId:g.sample.streamId,subjectId:g.sample.subjectId,count:g.count,expected}));
  }else if(r.ruleType==="subject_min_gap"){
   const min=Math.max(0,Number(cfg.periods||1)),groups=new Map<string,any[]>();for(const e of matched){const k=key(e.classId,e.streamId,e.weekday,e.subjectId),a=groups.get(k)||[];a.push(e);groups.set(k,a)}for(const a of groups.values()){a.sort((x,y)=>(pIndex.get(x.periodId)??99)-(pIndex.get(y.periodId)??99));for(let i=1;i<a.length;i++){const prev=pIndex.get(a[i-1].periodId),cur=pIndex.get(a[i].periodId);if(prev!=null&&cur!=null&&cur-prev-Number(a[i-1].lessonCount||1)<min)issues.push(issue(r,"subject_min_gap",`${a[i].subjectName||"Subject"} does not have the required ${min}-period gap.`,{entries:[a[i-1],a[i]],minimumGap:min}))}}
  }else if(r.ruleType==="teacher_consecutive_max"){
   const max=Math.max(1,Number(cfg.periods||1)),groups=new Map<string,any[]>();for(const e of matched){const k=key(e.teacherUserId,e.weekday),a=groups.get(k)||[];const start=pIndex.get(e.periodId);if(start!=null)for(let i=0;i<Number(e.lessonCount||1);i++)a.push({...e,_pi:start+i});groups.set(k,a)}for(const a of groups.values()){const unique=[...new Set(a.map(x=>x._pi))].sort((x:any,y:any)=>x-y);let run=0,best=0,last:number|null=null;for(const n of unique){run=last!==null&&n===last+1?run+1:1;best=Math.max(best,run);last=n}if(best>max)issues.push(issue(r,"teacher_consecutive_max",`${a[0]?.teacherName||"A teacher"} has ${best} consecutive periods; maximum is ${max}.`,{teacherUserId:a[0]?.teacherUserId,weekday:a[0]?.weekday,count:best,max}))}
  }else if(r.ruleType==="require_double"){
   const singles=matched.filter((e:any)=>Number(e.lessonCount||1)<2);if(singles.length)issues.push(issue(r,"require_double",`${singles.length} matching lesson slot(s) are single periods although a double lesson is required.`,{count:singles.length}));
  }else if(r.ruleType==="subject_spread"){
   const groups=new Map<string,any[]>();for(const e of matched){const k=key(e.classId,e.streamId,e.subjectId),a=groups.get(k)||[];a.push(e);groups.set(k,a)}for(const a of groups.values()){const days=new Set(a.map(x=>Number(x.weekday))),periodCount=a.reduce((s,x)=>s+Number(x.lessonCount||1),0);if(periodCount>days.size&&days.size<Math.min(5,periodCount))issues.push(issue(r,"subject_spread",`${a[0]?.subjectName||"Subject"} is concentrated into ${days.size} day(s) instead of being spread where possible.`,{days:[...days],periodCount}))}
  }
 }
 const hard=issues.filter(x=>x.severity==="hard"),soft=issues.filter(x=>x.severity!=="hard"),baseViolations=Array.isArray(draft.violations)?draft.violations:[],baseWarnings=Array.isArray(draft.warnings)?draft.warnings:[],violations=[...baseViolations,...hard],warnings=[...baseWarnings,...soft],score=Math.max(0,Math.min(100,Number(draft.score||0)-hard.length*8-soft.length*2));
 await db.prepare(`UPDATE acad_timetable_drafts SET score=?,violations_json=?,warnings_json=? WHERE id=? AND organization_id=?`).bind(score,JSON.stringify(violations),JSON.stringify(warnings),draft.id,org).run();
 return{...draft,score,violations,warnings,ruleReview:{hardViolations:hard.length,softWarnings:soft.length,checkedRules:custom.length}};
}

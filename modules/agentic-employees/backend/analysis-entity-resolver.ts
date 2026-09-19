export type AnalysisEntityOption={id:string;type:string;label:string;subtitle:string;referenceKey:string;score:number;metadata?:Record<string,unknown>};

type Spec={type:string;table:string;referenceKey:string;select:string;whereColumns:string[];fullNameColumns?:string[];label:(row:any)=>string;subtitle:(row:any)=>string;classify?:(row:any)=>string};
const SPECS:Spec[]=[
 {type:"student",table:"school_students",referenceKey:"studentId",select:"id,admission_number AS admissionNumber,student_number AS studentNumber,first_name AS firstName,middle_name AS middleName,last_name AS lastName",whereColumns:["admission_number","student_number","first_name","middle_name","last_name"],fullNameColumns:["first_name","middle_name","last_name"],label:r=>[r.firstName,r.middleName,r.lastName].filter(Boolean).join(" "),subtitle:r=>["Student",r.admissionNumber||r.studentNumber].filter(Boolean).join(" · ")},
 {type:"staff",table:"school_staff_profiles",referenceKey:"staffId",select:"id,staff_number AS staffNumber,first_name AS firstName,middle_name AS middleName,last_name AS lastName,is_teacher AS isTeacher",whereColumns:["staff_number","first_name","middle_name","last_name"],fullNameColumns:["first_name","middle_name","last_name"],label:r=>[r.firstName,r.middleName,r.lastName].filter(Boolean).join(" "),subtitle:r=>[(Number(r.isTeacher)===1||r.isTeacher===true)?"Teacher":"Staff",r.staffNumber].filter(Boolean).join(" · "),classify:r=>(Number(r.isTeacher)===1||r.isTeacher===true)?"teacher":"staff"},
 {type:"guardian",table:"school_guardians",referenceKey:"guardianId",select:"id,first_name AS firstName,middle_name AS middleName,last_name AS lastName,phone_primary AS phone,email",whereColumns:["first_name","middle_name","last_name","phone_primary","email"],fullNameColumns:["first_name","middle_name","last_name"],label:r=>[r.firstName,r.middleName,r.lastName].filter(Boolean).join(" "),subtitle:r=>["Guardian",r.phone||r.email].filter(Boolean).join(" · ")},
 {type:"account",table:"accounts",referenceKey:"accountId",select:"id,code,name",whereColumns:["code","name"],label:r=>r.name||r.code,subtitle:r=>["Account",r.code].filter(Boolean).join(" · ")},
 {type:"class",table:"school_classes",referenceKey:"classId",select:"id,code,name",whereColumns:["code","name"],label:r=>r.name||r.code,subtitle:r=>["Class",r.code].filter(Boolean).join(" · ")},
 {type:"stream",table:"school_streams",referenceKey:"streamId",select:"id,code,name",whereColumns:["code","name"],label:r=>r.name||r.code,subtitle:r=>["Stream",r.code].filter(Boolean).join(" · ")},
 {type:"subject",table:"school_subjects",referenceKey:"subjectId",select:"id,code,name",whereColumns:["code","name"],label:r=>r.name||r.code,subtitle:r=>["Subject",r.code].filter(Boolean).join(" · ")},
 {type:"department",table:"school_departments",referenceKey:"departmentId",select:"id,code,name",whereColumns:["code","name"],label:r=>r.name||r.code,subtitle:r=>["Department",r.code].filter(Boolean).join(" · ")},
 {type:"academic-year",table:"school_academic_years",referenceKey:"academicYearId",select:"id,code,name",whereColumns:["code","name"],label:r=>r.name||r.code,subtitle:r=>"Academic year"},
 {type:"term",table:"school_terms",referenceKey:"termId",select:"id,code,name",whereColumns:["code","name"],label:r=>r.name||r.code,subtitle:r=>"Term"},
 {type:"fee-category",table:"school_fee_categories",referenceKey:"feeCategoryId",select:"id,code,name",whereColumns:["code","name"],label:r=>r.name||r.code,subtitle:r=>["Fee category",r.code].filter(Boolean).join(" · ")},
 {type:"contact",table:"contacts",referenceKey:"contactId",select:"id,code,name,email",whereColumns:["code","name","email"],label:r=>r.name||r.code||r.email,subtitle:r=>["Contact",r.code||r.email].filter(Boolean).join(" · ")},
 {type:"product",table:"products",referenceKey:"productId",select:"id,sku,name",whereColumns:["sku","name"],label:r=>r.name||r.sku,subtitle:r=>["Product",r.sku].filter(Boolean).join(" · ")}
];

function score(q:string,row:any,spec:Spec){
 const needle=q.toLowerCase().trim(),values=spec.whereColumns.map(column=>String(row[column.replace(/_([a-z])/g,(_,c)=>c.toUpperCase())]??row[column]??"").toLowerCase()).filter(Boolean),label=spec.label(row).toLowerCase();
 if(label===needle||values.some(value=>value===needle))return 100;
 if(label.startsWith(needle)||values.some(value=>value.startsWith(needle)))return 75;
 return label.includes(needle)||values.some(value=>value.includes(needle))?50:20;
}
export async function searchAnalysisEntities(db:D1Database,organizationId:string,q:string,limit=24,types?:string[]){
 const needle=q.trim();if(needle.length<2)return[] as AnalysisEntityOption[];
 const allowed=types?.length?new Set(types.map(x=>x.toLowerCase())):null,out:AnalysisEntityOption[]=[];
 for(const spec of SPECS){
  if(allowed&&!allowed.has(spec.type)&&!(spec.type==="staff"&&allowed.has("teacher")))continue;
  try{
   const expressions=spec.whereColumns.map(column=>`lower(coalesce(${column},'')) LIKE lower(?)`);
   if(spec.fullNameColumns?.length){const joined=spec.fullNameColumns.map(column=>`coalesce(${column},'')`).join(" || ' ' || ");expressions.push(`lower(trim(replace(${joined},'  ',' '))) LIKE lower(?)`);}
   const conditions=expressions.join(" OR ");
   const args=expressions.map(()=>`%${needle}%`);
   const rows=await db.prepare(`SELECT ${spec.select} FROM ${spec.table} WHERE organization_id=? AND (${conditions}) LIMIT 6`).bind(organizationId,...args).all<any>();
   for(const row of rows.results){
    const type=spec.classify?spec.classify(row):spec.type;
    if(allowed&&!allowed.has(type)&&!allowed.has(spec.type))continue;
    out.push({id:String(row.id),type,label:spec.label(row)||String(row.id),subtitle:spec.subtitle(row),referenceKey:spec.referenceKey,score:score(needle,row,spec),metadata:row});
   }
  }catch{}
 }
 const unique=new Map<string,AnalysisEntityOption>();for(const item of out){const key=item.type+":"+item.id;if(!unique.has(key)||unique.get(key)!.score<item.score)unique.set(key,item);}
 return[...unique.values()].sort((a,b)=>b.score-a.score||a.label.localeCompare(b.label)).slice(0,Math.min(Math.max(limit,1),50));
}
export async function identifyAnalysisEntity(db:D1Database,organizationId:string,q:string,types?:string[]){
 const options=await searchAnalysisEntities(db,organizationId,q,30,types);
 const top=options[0];if(!top)return{status:"not-found" as const,query:q,options};
 const tied=options.filter(item=>item.score===top.score);
 if(top.score>=75&&tied.length===1)return{status:"resolved" as const,query:q,entity:top,options};
 return{status:"ambiguous" as const,query:q,options:options.slice(0,12)};
}

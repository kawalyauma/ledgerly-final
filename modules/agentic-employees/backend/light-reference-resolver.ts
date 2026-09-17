type RefSpec={table:string;returnColumn?:string;textColumns:string[];activeColumn?:string};

const REFERENCES:Record<string,RefSpec>={
  campusid:{table:"school_branches",textColumns:["code","name"],activeColumn:"active"},
  academicyearid:{table:"school_academic_years",textColumns:["code","name"]},
  currentacademicyearid:{table:"school_academic_years",textColumns:["code","name"]},
  termid:{table:"school_terms",textColumns:["code","name"]},
  classlevelid:{table:"school_class_levels",textColumns:["code","name"],activeColumn:"active"},
  admissionclasslevelid:{table:"school_class_levels",textColumns:["code","name"],activeColumn:"active"},
  desiredclasslevelid:{table:"school_class_levels",textColumns:["code","name"],activeColumn:"active"},
  promotionlevelid:{table:"school_class_levels",textColumns:["code","name"],activeColumn:"active"},
  targetclasslevelid:{table:"school_class_levels",textColumns:["code","name"],activeColumn:"active"},
  classid:{table:"school_classes",textColumns:["code","name"],activeColumn:"active"},
  currentclassid:{table:"school_classes",textColumns:["code","name"],activeColumn:"active"},
  streamid:{table:"school_streams",textColumns:["code","name"],activeColumn:"active"},
  currentstreamid:{table:"school_streams",textColumns:["code","name"],activeColumn:"active"},
  subjectid:{table:"school_subjects",textColumns:["code","name"],activeColumn:"active"},
  departmentid:{table:"school_departments",textColumns:["code","name"],activeColumn:"active"},
  parentid:{table:"school_departments",textColumns:["code","name"],activeColumn:"active"},
  gradingscaleid:{table:"school_grading_scales",textColumns:["code","name"],activeColumn:"active"},
  feecategoryid:{table:"school_fee_categories",textColumns:["code","name"],activeColumn:"active"},
  paymentmethodid:{table:"school_payment_methods",textColumns:["code","name"],activeColumn:"active"},
  studentid:{table:"school_students",textColumns:["admission_number","student_number","first_name","last_name"]},
  guardianid:{table:"school_guardians",textColumns:["first_name","last_name","phone_primary","email"],activeColumn:"active"},
  staffid:{table:"school_staff_profiles",textColumns:["staff_number","first_name","last_name"]},
  teacheruserid:{table:"school_staff_profiles",returnColumn:"user_id",textColumns:["staff_number","first_name","last_name"]},
  classteacheruserid:{table:"school_staff_profiles",returnColumn:"user_id",textColumns:["staff_number","first_name","last_name"]},
  headuserid:{table:"school_staff_profiles",returnColumn:"user_id",textColumns:["staff_number","first_name","last_name"]},
  assigneeuserid:{table:"school_staff_profiles",returnColumn:"user_id",textColumns:["staff_number","first_name","last_name"]},
  accountid:{table:"accounts",textColumns:["code","name"]},
  incomeaccountid:{table:"accounts",textColumns:["code","name"]},
  receivableaccountid:{table:"accounts",textColumns:["code","name"]},
  productid:{table:"products",textColumns:["sku","name"]},
  contactid:{table:"contacts",textColumns:["code","name","email"]},
};

function normalizeKey(value:string){return value.toLowerCase().replace(/[^a-z0-9]/g,"");}
function looksLikeId(value:string){return /^[a-z]{2,15}_[A-Za-z0-9-]{4,}$/i.test(value)||/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);}

async function resolveReference(db:D1Database,organizationId:string,key:string,value:string){
  if(!value||looksLikeId(value))return{value};
  const spec=REFERENCES[normalizeKey(key)];if(!spec)return{value};
  const exact=spec.textColumns.map(column=>`lower(coalesce(${column},''))=lower(?)`).join(" OR ");
  const fuzzy=spec.textColumns.map(column=>`lower(coalesce(${column},'')) LIKE lower(?)`).join(" OR ");
  const active=spec.activeColumn?` AND ${spec.activeColumn}=true`:"";
  const returnColumn=spec.returnColumn||"id";
  const exactArgs=spec.textColumns.map(()=>value),fuzzyArgs=spec.textColumns.map(()=>`%${value}%`);
  const exactRows=await db.prepare(`SELECT ${returnColumn} AS resolved FROM ${spec.table} WHERE organization_id=?${active} AND (${exact}) LIMIT 3`).bind(organizationId,...exactArgs).all<{resolved:string|null}>();
  const exactValues=exactRows.results.map(row=>row.resolved).filter((item):item is string=>Boolean(item));
  if(exactValues.length===1)return{value:exactValues[0]};
  if(exactValues.length>1)return{value,issue:`${key} “${value}” matches multiple Ledgerly records.`};
  const fuzzyRows=await db.prepare(`SELECT ${returnColumn} AS resolved FROM ${spec.table} WHERE organization_id=?${active} AND (${fuzzy}) LIMIT 3`).bind(organizationId,...fuzzyArgs).all<{resolved:string|null}>();
  const fuzzyValues=fuzzyRows.results.map(row=>row.resolved).filter((item):item is string=>Boolean(item));
  if(fuzzyValues.length===1)return{value:fuzzyValues[0]};
  if(!fuzzyValues.length)return{value,issue:`Could not resolve ${key} from “${value}”.`};
  return{value,issue:`${key} “${value}” matches multiple Ledgerly records.`};
}

export async function resolveLightReferences(db:D1Database,organizationId:string,input:unknown):Promise<{value:unknown;issues:string[]}>{
  if(Array.isArray(input)){
    const value:unknown[]=[],issues:string[]=[];
    for(const item of input){const result=await resolveLightReferences(db,organizationId,item);value.push(result.value);issues.push(...result.issues);}
    return{value,issues};
  }
  if(!input||typeof input!=="object")return{value:input,issues:[]};
  const value:Record<string,unknown>={},issues:string[]=[];
  for(const[key,raw]of Object.entries(input as Record<string,unknown>)){
    if(typeof raw==="string"&&/id$/i.test(key)){
      const result=await resolveReference(db,organizationId,key,raw);value[key]=result.value;if(result.issue)issues.push(result.issue);continue;
    }
    if(Array.isArray(raw)&&/ids$/i.test(key)){
      const singular=key.replace(/s$/i,"");const values:unknown[]=[];
      for(const item of raw){if(typeof item!=="string"){values.push(item);continue;}const result=await resolveReference(db,organizationId,singular,item);values.push(result.value);if(result.issue)issues.push(result.issue);}
      value[key]=values;continue;
    }
    const nested=await resolveLightReferences(db,organizationId,raw);value[key]=nested.value;issues.push(...nested.issues);
  }
  return{value,issues};
}

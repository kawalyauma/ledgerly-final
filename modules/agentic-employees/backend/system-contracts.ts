import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const nullableText = (max:number) => z.string().max(max).optional().nullable();
const money = z.number().int().nonnegative();

export type SystemContract = {
  method: "POST"|"PUT"|"PATCH"|"DELETE";
  path: string;
  schema: any;
  notes?: string[];
  aliases?: Record<string,string>;
  references?: Record<string,string>;
};

const guardianInline = z.object({
  firstName:z.string().min(1).max(100),
  middleName:z.string().max(100).optional().nullable(),
  lastName:z.string().min(1).max(100),
  phonePrimary:z.string().max(40).optional().nullable(),
  phoneSecondary:z.string().max(40).optional().nullable(),
  email:z.email().optional().nullable(),
  relationship:z.string().min(1).max(80).default("guardian"),
  occupation:z.string().max(160).optional().nullable(),
  physicalAddress:z.string().max(500).optional().nullable(),
}).strict();

const studentBase = z.object({
  campusId:z.string().optional().nullable(),
  firstName:z.string().min(1).max(100),
  middleName:z.string().max(100).optional().nullable(),
  lastName:z.string().min(1).max(100),
  preferredName:z.string().max(100).optional().nullable(),
  gender:z.string().max(40).optional().nullable(),
  dateOfBirth:date.optional().nullable(),
  nationality:z.string().max(80).optional().nullable(),
  placeOfBirth:z.string().max(160).optional().nullable(),
  religion:z.string().max(100).optional().nullable(),
  homeLanguage:z.string().max(100).optional().nullable(),
  phone:z.string().max(40).optional().nullable(),
  email:z.email().optional().nullable(),
  physicalAddress:z.string().max(1000).optional().nullable(),
  previousSchool:z.string().max(200).optional().nullable(),
  previousClass:z.string().max(120).optional().nullable(),
  admissionDate:date,
  admissionClassLevelId:z.string().optional().nullable(),
  currentAcademicYearId:z.string().optional().nullable(),
  currentClassId:z.string().optional().nullable(),
  currentStreamId:z.string().optional().nullable(),
  studentCategory:z.string().max(100).optional().nullable(),
  residencyStatus:z.enum(["day","boarding","hybrid"]).default("day"),
  house:z.string().max(100).optional().nullable(),
  status:z.enum(["applicant","active","inactive","graduated","transferred","withdrawn","suspended","deceased","alumni"]).default("active"),
  profilePhotoUrl:z.string().max(1000).optional().nullable(),
  profilePhotoFileId:z.string().optional().nullable(),
  customFields:z.record(z.string(),z.unknown()).default({}),
});
const studentCreate = studentBase.extend({
  admissionNumber:z.string().max(100).optional(),
  studentNumber:z.string().max(100).optional(),
  guardian:guardianInline.optional(),
  createPortalAccount:z.boolean().default(false),
  portalPassword:z.string().min(12).max(200).optional(),
}).strict().superRefine((value,ctx)=>{
  if(value.createPortalAccount&&!value.email)ctx.addIssue({code:"custom",path:["email"],message:"Student email is required when createPortalAccount is true"});
  if(value.createPortalAccount&&!value.portalPassword)ctx.addIssue({code:"custom",path:["portalPassword"],message:"Temporary portalPassword is required when createPortalAccount is true"});
});
const studentUpdate = studentBase.partial().strict();
const admissionApplicant = z.object({
  firstName:z.string().min(1).max(100),middleName:z.string().max(100).optional().nullable(),lastName:z.string().min(1).max(100),preferredName:z.string().max(100).optional().nullable(),gender:z.string().max(40).optional().nullable(),dateOfBirth:date.optional().nullable(),nationality:z.string().max(80).optional().nullable(),placeOfBirth:z.string().max(160).optional().nullable(),religion:z.string().max(100).optional().nullable(),homeLanguage:z.string().max(100).optional().nullable(),previousSchool:z.string().max(200).optional().nullable(),previousClass:z.string().max(100).optional().nullable(),residencyStatus:z.enum(["day","boarding","hybrid"]).default("day")
}).strict();
const admissionCreate = z.object({campusId:z.string().optional().nullable(),academicYearId:z.string().optional().nullable(),desiredClassLevelId:z.string().optional().nullable(),applicant:admissionApplicant,guardian:guardianInline.optional(),screening:z.record(z.string(),z.unknown()).default({}),status:z.enum(["draft","submitted","screening","waitlisted","approved","rejected","enrolled","withdrawn"]).default("submitted")}).strict();
const admissionEnroll = z.object({admissionDate:date,classId:z.string(),streamId:z.string().optional().nullable(),campusId:z.string().optional().nullable(),academicYearId:z.string(),admissionNumber:z.string().optional(),studentNumber:z.string().optional()}).strict();

const emergencyContact = z.object({name:z.string().min(2).max(160),relationship:nullableText(80),phone:z.string().min(5).max(40),alternatePhone:nullableText(40),email:z.email().optional().nullable(),physicalAddress:nullableText(500)}).strict();
const staffCreate = z.object({
  staffNumber:z.string().min(1).max(80).optional().nullable(),firstName:z.string().min(1).max(100),middleName:nullableText(100),lastName:z.string().min(1).max(100),preferredName:nullableText(100),gender:nullableText(40),dateOfBirth:date.optional().nullable(),nationality:nullableText(100),nationalId:nullableText(120),taxIdentifier:nullableText(120),phone:nullableText(40),alternatePhone:nullableText(40),email:z.email().optional().nullable(),physicalAddress:nullableText(1000),postalAddress:nullableText(500),departmentId:z.string().optional().nullable(),positionId:z.string().optional().nullable(),campusId:z.string().optional().nullable(),employmentType:z.enum(["permanent","contract","part_time","casual","intern","volunteer"]).default("permanent"),employmentStatus:z.enum(["active","on_leave","suspended","terminated","resigned","retired","inactive"]).default("active"),isTeacher:z.boolean().default(false),hireDate:date,payType:z.enum(["salary","hourly"]).default("salary"),basePayMinor:money.default(0),currency:z.string().length(3).toUpperCase().default("UGX"),userId:z.string().optional().nullable(),profilePhotoFileId:z.string().optional().nullable(),notes:nullableText(4000),emergencyContact:emergencyContact.optional()
}).strict();
const staffUpdate = staffCreate.omit({staffNumber:true,emergencyContact:true}).partial().strict();
const staffPosition = z.object({departmentId:z.string().optional().nullable(),campusId:z.string().optional().nullable(),code:z.string().min(1).max(40),name:z.string().min(2).max(160),description:nullableText(1000),jobGrade:nullableText(80),isTeaching:z.boolean().default(false),isManagement:z.boolean().default(false),active:z.boolean().default(true)}).strict();
const staffQualification = z.object({qualificationType:z.string().min(1).max(80),qualificationName:z.string().min(2).max(180),institution:nullableText(180),fieldOfStudy:nullableText(160),level:nullableText(80),grade:nullableText(80),awardedOn:date.optional().nullable(),expiresOn:date.optional().nullable(),registrationNumber:nullableText(120),fileId:z.string().optional().nullable()}).strict();
const staffSubject = z.object({subjectId:z.string(),isPrimary:z.boolean().default(false),proficiencyLevel:nullableText(80)}).strict();
const staffAssignment = z.object({academicYearId:z.string().optional().nullable(),termId:z.string().optional().nullable(),campusId:z.string().optional().nullable(),classId:z.string(),streamId:z.string().optional().nullable(),subjectId:z.string(),assignmentRole:z.string().max(80).default("teacher"),startsOn:date.optional().nullable(),endsOn:date.optional().nullable(),active:z.boolean().default(true)}).strict();
const staffDocument = z.object({documentType:z.string().min(1).max(100),name:z.string().min(1).max(300),fileId:z.string(),issuedOn:date.optional().nullable(),expiresOn:date.optional().nullable(),notes:nullableText(1000)}).strict();
const staffCompensation = z.object({code:z.string().min(1).max(40),name:z.string().min(2).max(120),componentType:z.enum(["earning","deduction"]),category:z.enum(["salary","commission","allowance","bonus","overtime","benefit","deduction","loan_recovery","salary_advance","other"]),calculationType:z.enum(["fixed","percentage"]).default("fixed"),amountMinor:money.optional().nullable(),rateMicros:money.optional().nullable(),taxable:z.boolean().default(false),pensionable:z.boolean().default(false),effectiveFrom:date,effectiveTo:date.optional().nullable(),active:z.boolean().default(true),metadata:z.record(z.string(),z.unknown()).default({})}).strict().refine(v=>v.calculationType==="fixed"?v.amountMinor!=null:v.rateMicros!=null,{message:"Fixed components require amountMinor and percentage components require rateMicros"});
const staffAdjustment = z.object({inputDate:date,type:z.enum(["commission","allowance","bonus","overtime","benefit","other_earning","deduction","loan_recovery","salary_advance","other_deduction","leave_unpaid"]),amountMinor:money,unitsMicros:money.default(0),notes:nullableText(1000)}).strict();

const setupSchemas = {
  branches:z.object({code:z.string().min(1).max(40),name:z.string().min(1).max(180),registrationNumber:z.string().max(120).optional().nullable(),phone:z.string().max(40).optional().nullable(),email:z.email().optional().nullable(),physicalAddress:z.string().max(1000).optional().nullable(),postalAddress:z.string().max(500).optional().nullable(),districtRegion:z.string().max(160).optional().nullable(),locationText:z.string().max(500).optional().nullable(),principalName:z.string().max(200).optional().nullable(),isMain:z.boolean().default(false),active:z.boolean().default(true)}).strict(),
  academicYears:z.object({code:z.string().min(1).max(40),name:z.string().min(1).max(120),startsOn:date,endsOn:date,status:z.enum(["planned","active","closed","archived"]).default("planned"),isCurrent:z.boolean().default(false)}).strict(),
  terms:z.object({academicYearId:z.string(),code:z.string().min(1).max(40),name:z.string().min(1).max(120),sequenceNo:z.number().int().min(1).max(20),startsOn:date,endsOn:date,status:z.enum(["planned","active","closed","archived"]).default("planned"),isCurrent:z.boolean().default(false)}).strict(),
  departments:z.object({campusId:z.string().optional().nullable(),code:z.string().min(1).max(40),name:z.string().min(1).max(180),description:z.string().max(1000).optional().nullable(),headUserId:z.string().optional().nullable(),parentId:z.string().optional().nullable(),active:z.boolean().default(true)}).strict(),
  classLevels:z.object({code:z.string().min(1).max(40),name:z.string().min(1).max(120),sequenceNo:z.number().int().min(1).max(100),educationLevel:z.string().max(120).optional().nullable(),promotionLevelId:z.string().optional().nullable(),terminal:z.boolean().default(false),active:z.boolean().default(true)}).strict(),
  classes:z.object({academicYearId:z.string().optional().nullable(),campusId:z.string().optional().nullable(),classLevelId:z.string(),departmentId:z.string().optional().nullable(),code:z.string().min(1).max(40),name:z.string().min(1).max(180),capacity:z.number().int().positive().optional().nullable(),classTeacherUserId:z.string().optional().nullable(),active:z.boolean().default(true)}).strict(),
  streams:z.object({classId:z.string(),campusId:z.string().optional().nullable(),code:z.string().min(1).max(40),name:z.string().min(1).max(120),capacity:z.number().int().positive().optional().nullable(),classTeacherUserId:z.string().optional().nullable(),active:z.boolean().default(true)}).strict(),
  subjects:z.object({departmentId:z.string().optional().nullable(),code:z.string().min(1).max(40),name:z.string().min(1).max(180),shortName:z.string().max(60).optional().nullable(),subjectType:z.enum(["compulsory","optional","elective"]).default("compulsory"),curriculumCode:z.string().max(100).optional().nullable(),passMark:z.number().min(0).max(100).optional().nullable(),maxMark:z.number().positive().default(100),active:z.boolean().default(true),metadata:z.record(z.string(),z.unknown()).default({})}).strict(),
  classSubjects:z.object({classLevelId:z.string(),subjectId:z.string(),academicYearId:z.string().optional().nullable(),compulsory:z.boolean().default(true),periodsPerWeek:z.number().int().min(0).max(100).optional().nullable(),teacherUserId:z.string().optional().nullable(),active:z.boolean().default(true)}).strict(),
  gradingScales:z.object({code:z.string().min(1).max(40),name:z.string().min(1).max(120),curriculum:z.string().max(160).optional().nullable(),isDefault:z.boolean().default(false),active:z.boolean().default(true)}).strict(),
  gradeBoundaries:z.object({gradingScaleId:z.string(),grade:z.string().min(1).max(20),minScore:z.number(),maxScore:z.number(),points:z.number().optional().nullable(),aggregatePoints:z.number().int().optional().nullable(),remark:z.string().max(200).optional().nullable(),colorHex:z.string().max(20).optional().nullable(),sequenceNo:z.number().int().default(0)}).strict(),
  divisions:z.object({gradingScaleId:z.string().optional().nullable(),code:z.string().min(1).max(40),name:z.string().min(1).max(120),minAggregate:z.number().int().optional().nullable(),maxAggregate:z.number().int().optional().nullable(),minSubjects:z.number().int().optional().nullable(),rule:z.record(z.string(),z.unknown()).default({}),sequenceNo:z.number().int().default(0),active:z.boolean().default(true)}).strict(),
  assessmentTypes:z.object({code:z.string().min(1).max(40),name:z.string().min(1).max(120),weightPercent:z.number().min(0).max(100).default(100),maxScore:z.number().positive().default(100),sequenceNo:z.number().int().default(0),active:z.boolean().default(true)}).strict(),
  promotionRules:z.object({classLevelId:z.string().optional().nullable(),name:z.string().min(1).max(180),minimumAverage:z.number().min(0).max(100).optional().nullable(),maximumFailedSubjects:z.number().int().min(0).optional().nullable(),minimumAttendancePercent:z.number().min(0).max(100).optional().nullable(),targetClassLevelId:z.string().optional().nullable(),allowManualOverride:z.boolean().default(true),rule:z.record(z.string(),z.unknown()).default({}),active:z.boolean().default(true)}).strict(),
  calendar:z.object({campusId:z.string().optional().nullable(),academicYearId:z.string().optional().nullable(),termId:z.string().optional().nullable(),eventType:z.enum(["holiday","weekend","school_event","teaching_day_override","closure","other"]),title:z.string().min(1).max(200),description:z.string().max(2000).optional().nullable(),startsAt:z.string(),endsAt:z.string(),allDay:z.boolean().default(true),teachingDay:z.boolean().default(false),recurrenceRule:z.string().max(500).optional().nullable()}).strict(),
  lessonPeriods:z.object({campusId:z.string().optional().nullable(),code:z.string().min(1).max(40),name:z.string().min(1).max(120),sequenceNo:z.number().int().min(1),startsAt:z.string().regex(/^\d{2}:\d{2}/),endsAt:z.string().regex(/^\d{2}:\d{2}/),periodType:z.enum(["lesson","break","lunch","assembly","other"]).default("lesson"),teachingPeriod:z.boolean().default(true),active:z.boolean().default(true)}).strict(),
  feeCategories:z.object({code:z.string().min(1).max(40),name:z.string().min(1).max(160),description:z.string().max(1000).optional().nullable(),incomeAccountId:z.string().optional().nullable(),receivableAccountId:z.string().optional().nullable(),productId:z.string().optional().nullable(),taxable:z.boolean().default(false),taxCode:z.string().max(40).optional().nullable(),refundable:z.boolean().default(false),mandatory:z.boolean().default(false),active:z.boolean().default(true),metadata:z.record(z.string(),z.unknown()).default({})}).strict(),
  paymentMethods:z.object({code:z.string().min(1).max(40),name:z.string().min(1).max(160),methodType:z.enum(["cash","bank","mobile_money","card","cheque","online","other"]),accountId:z.string().optional().nullable(),configuration:z.record(z.string(),z.unknown()).default({}),active:z.boolean().default(true)}).strict(),
  templates:z.object({campusId:z.string().optional().nullable(),templateType:z.enum(["letterhead","receipt","invoice","report_card","id_card","admission","transfer","other"]),name:z.string().min(1).max(180),fileId:z.string().optional().nullable(),version:z.number().int().min(1).default(1),content:z.record(z.string(),z.unknown()).default({}),isDefault:z.boolean().default(false),active:z.boolean().default(true)}).strict(),
} as const;

const contracts:SystemContract[] = [
  {method:"POST",path:"/api/v1/school/student-management/students",schema:studentCreate,
   notes:["admissionDate is required and must be YYYY-MM-DD.","Use Ledgerly IDs for class/year/stream/campus reference fields. Do not send class or academicYear labels."],
   aliases:{class:"currentClassId",academicYear:"currentAcademicYearId",stream:"currentStreamId"},
   references:{campusId:"GET /api/v1/school/setup/branches",admissionClassLevelId:"GET /api/v1/school/setup/classLevels",currentAcademicYearId:"GET /api/v1/school/setup/academicYears",currentClassId:"GET /api/v1/school/setup/classes",currentStreamId:"GET /api/v1/school/setup/streams"}},
  {method:"PUT",path:"/api/v1/school/student-management/students/:id",schema:studentUpdate,
   references:{campusId:"GET /api/v1/school/setup/branches",admissionClassLevelId:"GET /api/v1/school/setup/classLevels",currentAcademicYearId:"GET /api/v1/school/setup/academicYears",currentClassId:"GET /api/v1/school/setup/classes",currentStreamId:"GET /api/v1/school/setup/streams"}},
  {method:"POST",path:"/api/v1/school/student-management/admissions",schema:admissionCreate},
  {method:"POST",path:"/api/v1/school/student-management/admissions/:id/enroll",schema:admissionEnroll,
   references:{academicYearId:"GET /api/v1/school/setup/academicYears",classId:"GET /api/v1/school/setup/classes",streamId:"GET /api/v1/school/setup/streams",campusId:"GET /api/v1/school/setup/branches"}},
  {method:"POST",path:"/api/v1/school/staff-management/staff",schema:staffCreate,
   notes:["Teacher is represented by isTeacher:true.","employmentType is the contract/employment field; contractType is not accepted."],
   aliases:{contractType:"employmentType",phoneNumber:"phone",role:"isTeacher (use true only when the person is a teacher)"},
   references:{departmentId:"GET /api/v1/school/setup/departments",positionId:"GET /api/v1/school/staff-management/positions",campusId:"GET /api/v1/school/setup/branches"}},
  {method:"PUT",path:"/api/v1/school/staff-management/staff/:id",schema:staffUpdate,
   references:{departmentId:"GET /api/v1/school/setup/departments",positionId:"GET /api/v1/school/staff-management/positions",campusId:"GET /api/v1/school/setup/branches"}},
  {method:"POST",path:"/api/v1/school/staff-management/positions",schema:staffPosition},
  {method:"PUT",path:"/api/v1/school/staff-management/positions/:id",schema:staffPosition.partial().strict()},
  {method:"POST",path:"/api/v1/school/staff-management/staff/:id/qualifications",schema:staffQualification},
  {method:"POST",path:"/api/v1/school/staff-management/staff/:id/subjects",schema:staffSubject,references:{subjectId:"GET /api/v1/school/setup/subjects"}},
  {method:"POST",path:"/api/v1/school/staff-management/staff/:id/assignments",schema:staffAssignment,references:{academicYearId:"GET /api/v1/school/setup/academicYears",termId:"GET /api/v1/school/setup/terms",campusId:"GET /api/v1/school/setup/branches",classId:"GET /api/v1/school/setup/classes",streamId:"GET /api/v1/school/setup/streams",subjectId:"GET /api/v1/school/setup/subjects"}},
  {method:"POST",path:"/api/v1/school/staff-management/staff/:id/documents",schema:staffDocument},
  {method:"POST",path:"/api/v1/school/staff-management/staff/:id/compensation",schema:staffCompensation},
  {method:"POST",path:"/api/v1/school/staff-management/staff/:id/payroll-adjustments",schema:staffAdjustment},
];

for(const [key,schema] of Object.entries(setupSchemas)){
  contracts.push({method:"POST",path:`/api/v1/school/setup/${key}`,schema,
    notes:["Fields ending in Id must use a real Ledgerly record ID, not a display name or code unless explicitly documented."],
    references:setupReferences(key)});
  contracts.push({method:"PUT",path:`/api/v1/school/setup/${key}/:id`,schema:schema.partial().strict(),
    notes:["Only send fields being changed. Fields ending in Id must use real Ledgerly IDs."],references:setupReferences(key)});
}

function setupReferences(key:string):Record<string,string>|undefined{
  const common:Record<string,string>={campusId:"GET /api/v1/school/setup/branches",academicYearId:"GET /api/v1/school/setup/academicYears",termId:"GET /api/v1/school/setup/terms",departmentId:"GET /api/v1/school/setup/departments",classLevelId:"GET /api/v1/school/setup/classLevels",classId:"GET /api/v1/school/setup/classes",streamId:"GET /api/v1/school/setup/streams",subjectId:"GET /api/v1/school/setup/subjects",gradingScaleId:"GET /api/v1/school/setup/gradingScales",targetClassLevelId:"GET /api/v1/school/setup/classLevels",promotionLevelId:"GET /api/v1/school/setup/classLevels",incomeAccountId:"GET /api/v1/accounts",receivableAccountId:"GET /api/v1/accounts",accountId:"GET /api/v1/accounts",productId:"GET /api/v1/products"};
  const schema=(setupSchemas as Record<string,any>)[key];
  if(!schema)return undefined;
  const shape=(schema as any).shape as Record<string,unknown>|undefined;
  if(!shape)return undefined;
  const out:Record<string,string>={};for(const field of Object.keys(shape))if(common[field])out[field]=common[field]!;
  return Object.keys(out).length?out:undefined;
}

function cleanPath(value:string){return String(value||"").trim().split("?")[0].replace(/\/+$/,"")||"/";}
function pathMatches(template:string,actual:string){const expected=cleanPath(template).split("/").filter(Boolean),received=cleanPath(actual).split("/").filter(Boolean);if(expected.length!==received.length)return false;return expected.every((part,index)=>part.startsWith(":")||part===received[index]||/^\{\{.+\}\}$/.test(received[index]||""));}

export function findSystemContract(method:string,path:string){const verb=String(method||"").toUpperCase();return contracts.find(item=>item.method===verb&&pathMatches(item.path,path))||null;}
export function hasSystemContract(method:string,path:string){return Boolean(findSystemContract(method,path));}

export function describeSystemContract(method:string,path:string){const contract=findSystemContract(method,path);if(!contract)return{available:false,method:String(method||"").toUpperCase(),path:cleanPath(path),guidance:["No structured request-body contract is registered for this route yet.","Do not guess field names or enum values. Use system_catalog/system_read and, if the write is rejected, use the exact Ledgerly validation reason to correct the payload before preparing another confirmation."]};
  let bodySchema:unknown;try{bodySchema=z.toJSONSchema(contract.schema);}catch{bodySchema={description:"Structured validator is registered but JSON-schema rendering was unavailable."};}
  return{available:true,method:contract.method,path:contract.path,bodySchema,aliases:contract.aliases||{},references:contract.references||{},notes:contract.notes||[],globalRules:["Use exact field names and types from bodySchema.","Never send display names where an *Id field is expected; resolve the real ID with system_read.","Do not invent required dates, amounts, identifiers or enum values. Ask the user only when the value cannot be resolved from Ledgerly.","A confirmation card must only be created after this contract validates the payload."]};
}

function formatIssues(error:z.ZodError){return error.issues.slice(0,20).map(issue=>`${issue.path.length?issue.path.join("."):"body"}: ${issue.message}`).join(" · ");}
export function validateSystemMutation(method:string,path:string,body:unknown){const contract=findSystemContract(method,path);if(!contract)return{known:false,body};const parsed=contract.schema.safeParse(body);if(!parsed.success){const aliases=contract.aliases&&Object.keys(contract.aliases).length?` Known field corrections: ${Object.entries(contract.aliases).map(([bad,good])=>`${bad} → ${good}`).join(", ")}.`:"";const references=contract.references&&Object.keys(contract.references).length?` Resolve reference IDs with: ${Object.entries(contract.references).map(([field,lookup])=>`${field}: ${lookup}`).join("; ")}.`:"";throw new Error(`Payload does not satisfy Ledgerly contract for ${contract.method} ${contract.path}: ${formatIssues(parsed.error)}.${aliases}${references}`)}return{known:true,body:parsed.data,contractPath:contract.path};}

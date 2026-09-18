// Curated request-body field lists for the write endpoints AI employees are
// most likely to prepare system.api.request actions against. system_catalog
// only knows method+path pairs (from Hono's route table), not each route's
// validation rules, so a model guessing field names from convention alone
// reliably gets enum values, required fields (e.g. hireDate) and true field
// names (e.g. isTeacher vs employmentType) wrong. This gives the model the
// real shape before it prepares an action, so the prepared body actually
// validates once approved and executed.
export type SchemaField = { name: string; type: string; required: boolean; enum?: string[]; notes?: string };
export type EndpointSchema = { method: string; fields: SchemaField[] };

export const SYSTEM_ACTION_SCHEMAS: Record<string, EndpointSchema> = {
  "/api/v1/school/staff-management/staff": {
    method: "POST",
    fields: [
      { name: "firstName", type: "string", required: true },
      { name: "lastName", type: "string", required: true },
      { name: "middleName", type: "string", required: false },
      { name: "gender", type: "string", required: false },
      { name: "dateOfBirth", type: "date (YYYY-MM-DD)", required: false },
      { name: "phone", type: "string", required: false },
      { name: "email", type: "string", required: false },
      { name: "departmentId", type: "string (department id)", required: false },
      { name: "positionId", type: "string (position id)", required: false },
      { name: "campusId", type: "string (campus id)", required: false },
      { name: "employmentType", type: "enum", required: false, enum: ["permanent", "contract", "part_time", "casual", "intern", "volunteer"], notes: "Defaults to permanent. This is NOT where you mark someone as a teacher — use isTeacher." },
      { name: "employmentStatus", type: "enum", required: false, enum: ["active", "on_leave", "suspended", "terminated", "resigned", "retired", "inactive"], notes: "Defaults to active. Field name is employmentStatus, not status." },
      { name: "isTeacher", type: "boolean", required: false, notes: "Set true to mark this staff member as a teacher. Defaults to false." },
      { name: "hireDate", type: "date (YYYY-MM-DD)", required: true, notes: "Required — there is no default. Use today's date unless told otherwise." },
      { name: "payType", type: "enum", required: false, enum: ["salary", "hourly"] },
      { name: "basePayMinor", type: "integer (minor currency units)", required: false },
      { name: "notes", type: "string", required: false },
    ],
  },
  "/api/v1/school/student-management/students": {
    method: "POST",
    fields: [
      { name: "firstName", type: "string", required: true },
      { name: "lastName", type: "string", required: true },
      { name: "admissionDate", type: "date (YYYY-MM-DD)", required: true },
      { name: "admissionNumber", type: "string", required: false, notes: "Auto-generated if omitted." },
      { name: "studentNumber", type: "string", required: false, notes: "Auto-generated if omitted." },
      { name: "gender", type: "string", required: false },
      { name: "dateOfBirth", type: "date (YYYY-MM-DD)", required: false },
      { name: "admissionClassLevelId", type: "string (class level id)", required: false },
      { name: "currentAcademicYearId", type: "string (academic year id)", required: false },
      { name: "currentClassId", type: "string (class id)", required: false },
      { name: "currentStreamId", type: "string (stream id)", required: false },
      { name: "residencyStatus", type: "enum", required: false, enum: ["day", "boarding", "hybrid"] },
      { name: "status", type: "enum", required: false, enum: ["applicant", "active", "inactive", "graduated", "transferred", "withdrawn", "suspended", "deceased", "alumni"] },
      { name: "guardian", type: "object", required: false, notes: "{ firstName, lastName, phonePrimary, relationship, primaryGuardian }" },
    ],
  },
  "/api/v1/school/setup/academicYears": {
    method: "POST",
    fields: [
      { name: "code", type: "string", required: true },
      { name: "name", type: "string", required: true },
      { name: "startsOn", type: "date (YYYY-MM-DD)", required: true },
      { name: "endsOn", type: "date (YYYY-MM-DD)", required: true },
      { name: "status", type: "enum", required: false, enum: ["planned", "active", "closed", "archived"] },
      { name: "isCurrent", type: "boolean", required: false },
    ],
  },
  "/api/v1/school/setup/terms": {
    method: "POST",
    fields: [
      { name: "academicYearId", type: "string (academic year id)", required: true },
      { name: "code", type: "string", required: true },
      { name: "name", type: "string", required: true },
      { name: "sequenceNo", type: "integer 1-20", required: true },
      { name: "startsOn", type: "date (YYYY-MM-DD)", required: true },
      { name: "endsOn", type: "date (YYYY-MM-DD)", required: true },
      { name: "status", type: "enum", required: false, enum: ["planned", "active", "closed", "archived"] },
      { name: "isCurrent", type: "boolean", required: false },
    ],
  },
  "/api/v1/school/setup/departments": {
    method: "POST",
    fields: [
      { name: "code", type: "string", required: true },
      { name: "name", type: "string", required: true },
      { name: "campusId", type: "string (campus id)", required: false },
      { name: "description", type: "string", required: false },
      { name: "headUserId", type: "string (user id)", required: false },
      { name: "parentId", type: "string (department id)", required: false },
      { name: "active", type: "boolean", required: false },
    ],
  },
  "/api/v1/school/setup/classLevels": {
    method: "POST",
    fields: [
      { name: "code", type: "string", required: true },
      { name: "name", type: "string", required: true },
      { name: "sequenceNo", type: "integer 1-100", required: true, notes: "Order among grade levels, e.g. Senior 1 = 1." },
      { name: "educationLevel", type: "string", required: false },
      { name: "promotionLevelId", type: "string (next class level id)", required: false },
      { name: "terminal", type: "boolean", required: false, notes: "True if this is the final/graduating level." },
      { name: "active", type: "boolean", required: false },
    ],
  },
  "/api/v1/school/setup/classes": {
    method: "POST",
    fields: [
      { name: "classLevelId", type: "string (class level id)", required: true, notes: "Required — look this up via system_read on /api/v1/school/setup/classLevels first." },
      { name: "code", type: "string", required: true },
      { name: "name", type: "string", required: true },
      { name: "academicYearId", type: "string (academic year id)", required: false },
      { name: "campusId", type: "string (campus id)", required: false },
      { name: "departmentId", type: "string (department id)", required: false },
      { name: "capacity", type: "integer, positive", required: false },
      { name: "classTeacherUserId", type: "string (user id)", required: false },
      { name: "active", type: "boolean", required: false },
    ],
  },
  "/api/v1/school/setup/streams": {
    method: "POST",
    fields: [
      { name: "classId", type: "string (class id)", required: true, notes: "Required — look this up via system_read on /api/v1/school/setup/classes first." },
      { name: "code", type: "string", required: true },
      { name: "name", type: "string", required: true },
      { name: "campusId", type: "string (campus id)", required: false },
      { name: "capacity", type: "integer, positive", required: false },
      { name: "classTeacherUserId", type: "string (user id)", required: false },
      { name: "active", type: "boolean", required: false },
    ],
  },
  "/api/v1/school/setup/subjects": {
    method: "POST",
    fields: [
      { name: "code", type: "string", required: true },
      { name: "name", type: "string", required: true },
      { name: "departmentId", type: "string (department id)", required: false },
      { name: "shortName", type: "string", required: false },
      { name: "subjectType", type: "enum", required: false, enum: ["compulsory", "optional", "elective"] },
      { name: "curriculumCode", type: "string", required: false },
      { name: "passMark", type: "number 0-100", required: false },
      { name: "maxMark", type: "number, positive", required: false, notes: "Defaults to 100." },
      { name: "active", type: "boolean", required: false },
    ],
  },
};

export function lookupSystemSchema(path: string): EndpointSchema | null {
  const clean = path.split("?")[0]!.replace(/\/$/, "");
  return SYSTEM_ACTION_SCHEMAS[clean] || null;
}

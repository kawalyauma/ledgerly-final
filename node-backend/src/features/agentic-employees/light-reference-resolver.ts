type RefSpec = {
  table: string;
  returnColumn?: string;
  textColumns: string[];
  fullNameColumns?: string[];
  activeColumn?: string;
};

const REFS: Record<string, RefSpec> = {
  campusid: { table: "school_branches", textColumns: ["code", "name"], activeColumn: "active" },
  academicyearid: { table: "school_academic_years", textColumns: ["code", "name"] },
  currentacademicyearid: { table: "school_academic_years", textColumns: ["code", "name"] },
  termid: { table: "school_terms", textColumns: ["code", "name"] },
  classlevelid: { table: "school_class_levels", textColumns: ["code", "name"], activeColumn: "active" },
  admissionclasslevelid: { table: "school_class_levels", textColumns: ["code", "name"], activeColumn: "active" },
  promotionlevelid: { table: "school_class_levels", textColumns: ["code", "name"], activeColumn: "active" },
  classid: { table: "school_classes", textColumns: ["code", "name"], activeColumn: "active" },
  currentclassid: { table: "school_classes", textColumns: ["code", "name"], activeColumn: "active" },
  streamid: { table: "school_streams", textColumns: ["code", "name"], activeColumn: "active" },
  currentstreamid: { table: "school_streams", textColumns: ["code", "name"], activeColumn: "active" },
  subjectid: { table: "school_subjects", textColumns: ["code", "name"], activeColumn: "active" },
  departmentid: { table: "school_departments", textColumns: ["code", "name"], activeColumn: "active" },
  positionid: { table: "school_staff_positions", textColumns: ["code", "name"], activeColumn: "active" },
  gradingscaleid: { table: "school_grading_scales", textColumns: ["code", "name"], activeColumn: "active" },
  feecategoryid: { table: "school_fee_categories", textColumns: ["code", "name"], activeColumn: "active" },
  paymentmethodid: { table: "school_payment_methods", textColumns: ["code", "name"], activeColumn: "active" },
  studentid: { table: "school_students", textColumns: ["admission_number", "student_number", "first_name", "last_name"], fullNameColumns: ["first_name", "middle_name", "last_name"] },
  guardianid: { table: "school_guardians", textColumns: ["first_name", "last_name", "phone_primary", "email"], fullNameColumns: ["first_name", "middle_name", "last_name"], activeColumn: "active" },
  staffid: { table: "school_staff_profiles", textColumns: ["staff_number", "first_name", "last_name", "preferred_name"], fullNameColumns: ["first_name", "middle_name", "last_name"] },
  teacheruserid: { table: "school_staff_profiles", returnColumn: "user_id", textColumns: ["staff_number", "first_name", "last_name", "preferred_name"], fullNameColumns: ["first_name", "middle_name", "last_name"] },
  classteacheruserid: { table: "school_staff_profiles", returnColumn: "user_id", textColumns: ["staff_number", "first_name", "last_name", "preferred_name"], fullNameColumns: ["first_name", "middle_name", "last_name"] },
  headuserid: { table: "school_staff_profiles", returnColumn: "user_id", textColumns: ["staff_number", "first_name", "last_name", "preferred_name"], fullNameColumns: ["first_name", "middle_name", "last_name"] },
  assigneeuserid: { table: "school_staff_profiles", returnColumn: "user_id", textColumns: ["staff_number", "first_name", "last_name", "preferred_name"], fullNameColumns: ["first_name", "middle_name", "last_name"] },
  accountid: { table: "accounts", textColumns: ["code", "name"] },
  incomeaccountid: { table: "accounts", textColumns: ["code", "name"] },
  receivableaccountid: { table: "accounts", textColumns: ["code", "name"] },
  productid: { table: "products", textColumns: ["sku", "name"] },
  contactid: { table: "contacts", textColumns: ["code", "name", "email"] },
};

const CONTEXT_KEY: Record<string, string> = {
  student: "studentId",
  guardian: "guardianId",
  staff: "staffId",
  teacher: "staffId",
  class: "classId",
  stream: "streamId",
  subject: "subjectId",
  academic_year: "academicYearId",
  academicyear: "academicYearId",
  term: "termId",
  department: "departmentId",
  position: "positionId",
  account: "accountId",
  contact: "contactId",
  product: "productId",
};

function normalizeKey(value: string) { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function looksLikeId(value: string) { return /^[a-z]{2,18}_[A-Za-z0-9-]{4,}$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value); }
function searchExpressions(spec: RefSpec, fuzzy: boolean) {
  const op = fuzzy ? "LIKE lower(?)" : "=lower(?)";
  const expressions = spec.textColumns.map(column => `lower(coalesce(${column},'')) ${op}`);
  if (spec.fullNameColumns?.length) expressions.push(`lower(trim(concat_ws(' ',${spec.fullNameColumns.map(column => `nullif(${column},'')`).join(",")}))) ${op}`);
  return expressions;
}

async function resolveOne(db: D1Database, organizationId: string, key: string, value: string) {
  if (!value || looksLikeId(value)) return { value };
  const spec = REFS[normalizeKey(key)];
  if (!spec) return { value };
  const returnColumn = spec.returnColumn || "id", active = spec.activeColumn ? ` AND ${spec.activeColumn}=true` : "";
  const exactExpressions = searchExpressions(spec, false), exactArgs = exactExpressions.map(() => value);
  const exactRows = await db.prepare(`SELECT ${returnColumn} AS resolved FROM ${spec.table} WHERE organization_id=?${active} AND (${exactExpressions.join(" OR ")}) LIMIT 3`).bind(organizationId, ...exactArgs).all<{ resolved: string | null }>();
  const exactValues = [...new Set(exactRows.results.map(row => row.resolved).filter((item): item is string => Boolean(item)))];
  if (exactValues.length === 1) return { value: exactValues[0] };
  if (exactValues.length > 1) return { value, issue: `${key} “${value}” matches multiple Ledgerly records.` };

  const fuzzyExpressions = searchExpressions(spec, true), fuzzyArgs = fuzzyExpressions.map(() => `%${value}%`);
  const fuzzyRows = await db.prepare(`SELECT ${returnColumn} AS resolved FROM ${spec.table} WHERE organization_id=?${active} AND (${fuzzyExpressions.join(" OR ")}) LIMIT 3`).bind(organizationId, ...fuzzyArgs).all<{ resolved: string | null }>();
  const fuzzyValues = [...new Set(fuzzyRows.results.map(row => row.resolved).filter((item): item is string => Boolean(item)))];
  if (fuzzyValues.length === 1) return { value: fuzzyValues[0] };
  if (!fuzzyValues.length) return { value, issue: `Could not resolve ${key} from “${value}”.` };
  return { value, issue: `${key} “${value}” matches multiple Ledgerly records.` };
}

async function resolveContextualId(db: D1Database, organizationId: string, object: Record<string, unknown>, idKey: "sourceId" | "entityId") {
  const raw = object[idKey];
  if (typeof raw !== "string" || !raw || looksLikeId(raw)) return null;
  const typeKey = idKey === "sourceId" ? "sourceType" : "entityType", entityType = String(object[typeKey] || "").toLowerCase().replace(/[ -]/g, "_");
  const referenceKey = CONTEXT_KEY[entityType];
  if (!referenceKey) return null;
  return resolveOne(db, organizationId, referenceKey, raw);
}

export async function resolveLightReferences(db: D1Database, organizationId: string, input: unknown): Promise<{ value: unknown; issues: string[] }> {
  if (Array.isArray(input)) {
    const value: unknown[] = [], issues: string[] = [];
    for (const item of input) { const result = await resolveLightReferences(db, organizationId, item); value.push(result.value); issues.push(...result.issues); }
    return { value, issues };
  }
  if (!input || typeof input !== "object") return { value: input, issues: [] };

  const source = input as Record<string, unknown>, value: Record<string, unknown> = {}, issues: string[] = [];
  const sourceIdResolution = await resolveContextualId(db, organizationId, source, "sourceId");
  const entityIdResolution = await resolveContextualId(db, organizationId, source, "entityId");

  for (const [key, raw] of Object.entries(source)) {
    if (key === "sourceId" && sourceIdResolution) { value[key] = sourceIdResolution.value; if (sourceIdResolution.issue) issues.push(sourceIdResolution.issue); continue; }
    if (key === "entityId" && entityIdResolution) { value[key] = entityIdResolution.value; if (entityIdResolution.issue) issues.push(entityIdResolution.issue); continue; }
    if (typeof raw === "string" && /id$/i.test(key)) {
      const result = await resolveOne(db, organizationId, key, raw);
      value[key] = result.value;
      if (result.issue) issues.push(result.issue);
      continue;
    }
    if (Array.isArray(raw) && /ids$/i.test(key)) {
      const singular = key.replace(/s$/i, ""), values: unknown[] = [];
      for (const item of raw) {
        if (typeof item !== "string") { values.push(item); continue; }
        const result = await resolveOne(db, organizationId, singular, item);
        values.push(result.value);
        if (result.issue) issues.push(result.issue);
      }
      value[key] = values;
      continue;
    }
    const nested = await resolveLightReferences(db, organizationId, raw);
    value[key] = nested.value;
    issues.push(...nested.issues);
  }
  return { value, issues: [...new Set(issues)] };
}

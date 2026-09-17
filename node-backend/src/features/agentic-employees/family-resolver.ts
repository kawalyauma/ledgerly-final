export type FamilyGenderFilter = "all" | "male" | "female";

export function normalizeGuardianQuery(value: string) {
  return value
    .trim()
    .replace(/^(mr|mrs|ms|miss|dr|prof|sir|madam)\.?\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesGender(value: unknown, filter: FamilyGenderFilter) {
  if (filter === "all") return true;
  const gender = String(value || "").trim().toLowerCase();
  if (filter === "male") return ["male", "m", "boy"].includes(gender);
  return ["female", "f", "girl"].includes(gender);
}

export async function resolveGuardianFamily(
  db: D1Database,
  organizationId: string,
  rawQuery: string,
  gender: FamilyGenderFilter = "all",
) {
  const query = normalizeGuardianQuery(rawQuery);
  if (!query) return { found: false, ambiguous: false, query, candidates: [], students: [] };
  const like = `%${query.toLowerCase()}%`;
  const candidates = await db.prepare(`
    SELECT id,first_name AS firstName,middle_name AS middleName,last_name AS lastName,
           phone_primary AS phonePrimary,phone_secondary AS phoneSecondary,email,
           relationship_default AS relationshipDefault
    FROM school_guardians
    WHERE organization_id=? AND active=true AND (
      id=? OR phone_primary=? OR phone_secondary=? OR LOWER(COALESCE(email,''))=LOWER(?) OR
      LOWER(TRIM(first_name||' '||COALESCE(middle_name||' ','')||last_name)) LIKE ? OR
      LOWER(first_name) LIKE ? OR LOWER(last_name) LIKE ?
    )
    ORDER BY CASE
      WHEN id=? OR phone_primary=? OR phone_secondary=? OR LOWER(COALESCE(email,''))=LOWER(?) THEN 0
      WHEN LOWER(TRIM(first_name||' '||COALESCE(middle_name||' ','')||last_name))=LOWER(?) THEN 1
      ELSE 2 END,
      last_name,first_name
    LIMIT 10
  `).bind(
    organizationId, rawQuery.trim(), rawQuery.trim(), rawQuery.trim(), rawQuery.trim(), like, like, like,
    rawQuery.trim(), rawQuery.trim(), rawQuery.trim(), rawQuery.trim(), query,
  ).all<Record<string, unknown>>();

  if (!candidates.results.length) return { found: false, ambiguous: false, query, candidates: [], students: [] };

  const exact = candidates.results.filter(row => {
    const fullName = [row.firstName, row.middleName, row.lastName].filter(Boolean).join(" ").toLowerCase();
    return String(row.id) === rawQuery.trim()
      || String(row.phonePrimary || "") === rawQuery.trim()
      || String(row.phoneSecondary || "") === rawQuery.trim()
      || String(row.email || "").toLowerCase() === rawQuery.trim().toLowerCase()
      || fullName === query.toLowerCase();
  });
  const selected = exact.length === 1 ? exact[0] : candidates.results.length === 1 ? candidates.results[0] : null;
  if (!selected) return { found: true, ambiguous: true, query, candidates: candidates.results, students: [] };

  const rows = await db.prepare(`
    SELECT s.id,s.admission_number AS admissionNumber,s.student_number AS studentNumber,
           s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS lastName,
           s.gender,s.status,s.current_academic_year_id AS academicYearId,
           s.current_class_id AS classId,s.current_stream_id AS streamId,
           c.name AS className,st.name AS streamName,
           sg.relationship,sg.is_primary AS isPrimary,
           sg.is_financially_responsible AS isFinanciallyResponsible,
           sg.receives_academic_updates AS receivesAcademicUpdates,
           sg.receives_financial_updates AS receivesFinancialUpdates
    FROM school_student_guardians sg
    JOIN school_students s ON s.id=sg.student_id AND s.organization_id=sg.organization_id
    LEFT JOIN school_classes c ON c.id=s.current_class_id AND c.organization_id=s.organization_id
    LEFT JOIN school_streams st ON st.id=s.current_stream_id AND st.organization_id=s.organization_id
    WHERE sg.organization_id=? AND sg.guardian_id=? AND s.deleted_at IS NULL
    ORDER BY s.last_name,s.first_name
  `).bind(organizationId, String(selected.id)).all<Record<string, unknown>>();

  const students = rows.results.filter(row => matchesGender(row.gender, gender));
  return { found: true, ambiguous: false, query, guardian: selected, gender, students, linkedStudentCount: rows.results.length };
}

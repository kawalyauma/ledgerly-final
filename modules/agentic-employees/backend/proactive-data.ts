export async function proactiveContext(db: D1Database, organizationId: string, workflowKey: string) {
  if (workflowKey === "dos_daily_review") {
    const [overview, plans, schemes] = await Promise.all([
      db.prepare(`SELECT
        (SELECT COUNT(*) FROM school_lesson_plans WHERE organization_id=? AND status NOT IN ('delivered','cancelled')) AS openPlans,
        (SELECT COUNT(*) FROM school_academic_observations WHERE organization_id=? AND status<>'closed') AS openObservations,
        (SELECT COUNT(*) FROM school_academic_record_inspections WHERE organization_id=? AND status<>'closed') AS openInspections,
        (SELECT COALESCE(
          ROUND(
            100.0 * SUM(CASE WHEN i.completion_status='completed' THEN 1 ELSE 0 END)
            / NULLIF(COUNT(i.id),0),
            1
          ),0)
         FROM school_schemes_of_work s
         LEFT JOIN school_scheme_items i ON i.scheme_id=s.id AND i.organization_id=s.organization_id
         WHERE s.organization_id=? AND s.status<>'archived') AS averageCoverage
      `).bind(organizationId,organizationId,organizationId,organizationId).first(),

      db.prepare(`SELECT p.lesson_date AS lessonDate,p.topic,p.status,
          c.name AS className,s.name AS subjectName,
          TRIM(sp.first_name||' '||sp.last_name) AS teacherName
        FROM school_lesson_plans p
        JOIN school_classes c ON c.id=p.class_id
        JOIN school_subjects s ON s.id=p.subject_id
        LEFT JOIN school_staff_profiles sp
          ON sp.id=p.teacher_staff_id AND sp.organization_id=p.organization_id
        WHERE p.organization_id=? AND p.status NOT IN ('delivered','cancelled')
        ORDER BY p.lesson_date DESC,p.updated_at DESC LIMIT 30
      `).bind(organizationId).all(),

      db.prepare(`WITH scheme_rows AS (
          SELECT s.id,s.title,s.status,s.class_id,s.subject_id,s.teacher_staff_id,s.updated_at,
            COALESCE(
              ROUND(
                100.0 * SUM(CASE WHEN i.completion_status='completed' THEN 1 ELSE 0 END)
                / NULLIF(COUNT(i.id),0),
                1
              ),0
            ) AS coverage_percent
          FROM school_schemes_of_work s
          LEFT JOIN school_scheme_items i
            ON i.scheme_id=s.id AND i.organization_id=s.organization_id
          WHERE s.organization_id=? AND s.status<>'archived'
          GROUP BY s.id,s.title,s.status,s.class_id,s.subject_id,s.teacher_staff_id,s.updated_at
        )
        SELECT r.title,r.status,r.coverage_percent AS coveragePercent,
          c.name AS className,su.name AS subjectName,
          TRIM(sp.first_name||' '||sp.last_name) AS teacherName
        FROM scheme_rows r
        JOIN school_classes c ON c.id=r.class_id
        JOIN school_subjects su ON su.id=r.subject_id
        LEFT JOIN school_staff_profiles sp ON sp.id=r.teacher_staff_id
        ORDER BY r.coverage_percent ASC,r.updated_at DESC LIMIT 30
      `).bind(organizationId).all(),
    ]);

    return { overview, lessonPlans: plans.results, schemes: schemes.results };
  }

  if (workflowKey === "bursar_daily_review") {
    const totals = await db.prepare(`WITH fee_docs AS (
        SELECT document_id,SUM(amount_minor) AS billed_minor
        FROM school_student_fee_charges
        WHERE organization_id=?
        GROUP BY document_id
      )
      SELECT COALESCE(SUM(fd.billed_minor),0) AS billedMinor,
        0 AS creditedMinor,
        0 AS writtenOffMinor,
        COALESCE(SUM(CASE
          WHEN COALESCE(d.paid_minor,0)<fd.billed_minor THEN COALESCE(d.paid_minor,0)
          ELSE fd.billed_minor END),0) AS paidMinor,
        COALESCE(SUM(CASE
          WHEN fd.billed_minor>COALESCE(d.paid_minor,0)
          THEN fd.billed_minor-COALESCE(d.paid_minor,0)
          ELSE 0 END),0) AS outstandingMinor
      FROM fee_docs fd
      JOIN documents d ON d.id=fd.document_id
      WHERE d.status IN ('open','partially_paid','paid')
    `).bind(organizationId).first();

    const arrears = await db.prepare(`WITH fee_docs AS (
        SELECT student_id,document_id,SUM(amount_minor) AS billed_minor
        FROM school_student_fee_charges
        WHERE organization_id=?
        GROUP BY student_id,document_id
      ),
      balances AS (
        SELECT fd.student_id,
          SUM(CASE WHEN fd.billed_minor>COALESCE(d.paid_minor,0)
            THEN fd.billed_minor-COALESCE(d.paid_minor,0)
            ELSE 0 END) AS balance_minor
        FROM fee_docs fd
        JOIN documents d ON d.id=fd.document_id
        WHERE d.status IN ('open','partially_paid','paid')
        GROUP BY fd.student_id
      )
      SELECT s.admission_number AS admissionNumber,
        s.first_name||' '||s.last_name AS studentName,
        ROUND(b.balance_minor) AS balanceMinor
      FROM balances b
      JOIN school_students s ON s.id=b.student_id
      WHERE b.balance_minor>0
      ORDER BY b.balance_minor DESC LIMIT 20
    `).bind(organizationId).all();

    return { totals, largestArrears: arrears.results };
  }

  if (workflowKey === "hr_daily_review") {
    const dashboard = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM hr_employees WHERE organization_id=? AND employment_status='active') AS activeEmployees,
      (SELECT COUNT(*) FROM hr_departments WHERE organization_id=? AND active=TRUE) AS departments,
      (SELECT COUNT(*) FROM hr_leave_requests WHERE organization_id=? AND status='pending') AS pendingLeave,
      (SELECT COUNT(*) FROM hr_onboarding_tasks WHERE organization_id=? AND status='pending') AS pendingOnboarding
    `).bind(organizationId,organizationId,organizationId,organizationId).first();

    const leave = await db.prepare(`SELECT
        e.employee_number AS employeeNumber,
        COALESCE(c.name,u.display_name,sp.first_name||' '||sp.last_name) AS employeeName,
        t.name AS leaveType,r.starts_on AS startsOn,r.ends_on AS endsOn,r.reason
      FROM hr_leave_requests r
      JOIN hr_employees e ON e.id=r.employee_id
      JOIN hr_leave_types t ON t.id=r.leave_type_id
      LEFT JOIN contacts c ON c.id=e.contact_id
      LEFT JOIN users u ON u.id=e.user_id
      LEFT JOIN school_staff_profiles sp ON sp.id=e.school_staff_id
      WHERE r.organization_id=? AND r.status='pending'
      ORDER BY r.created_at DESC LIMIT 20
    `).bind(organizationId).all();

    return { dashboard, pendingLeave: leave.results };
  }

  if (workflowKey === "secretary_daily_review") {
    const [school, comms] = await Promise.all([
      db.prepare(`SELECT
        (SELECT COUNT(*) FROM school_students WHERE organization_id=? AND deleted_at IS NULL AND status='active') AS activeStudents,
        (SELECT COUNT(*) FROM school_staff_profiles WHERE organization_id=? AND deleted_at IS NULL AND employment_status='active') AS activeStaff,
        (SELECT COUNT(*) FROM school_guardians WHERE organization_id=? AND active=TRUE) AS activeGuardians
      `).bind(organizationId,organizationId,organizationId).first(),

      db.prepare(`SELECT COUNT(*) AS campaigns,
        SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) AS scheduled,
        SUM(sent_count) AS sent,SUM(failed_count) AS failed
        FROM communication_campaigns WHERE organization_id=?
      `).bind(organizationId).first(),
    ]);

    return { school, communications: comms };
  }

  if (workflowKey === "librarian_weekly_review") {
    const stock = await db.prepare(`SELECT book_type AS bookType,
      COALESCE(SUM(CASE WHEN reversed_at IS NULL THEN quantity_delta ELSE 0 END),0) AS receivedOrAdjusted
      FROM book_stock_movements
      WHERE organization_id=? GROUP BY book_type
    `).bind(organizationId).all();

    const issued = await db.prepare(`SELECT book_type AS bookType,
      COALESCE(SUM(CASE WHEN reversed_at IS NULL THEN quantity ELSE 0 END),0) AS issued
      FROM book_distributions
      WHERE organization_id=? GROUP BY book_type
    `).bind(organizationId).all();

    return { stock: stock.results, distributions: issued.results };
  }

  return {};
}

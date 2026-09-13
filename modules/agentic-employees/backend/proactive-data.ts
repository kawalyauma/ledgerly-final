export async function proactiveContext(db: D1Database, organizationId: string, workflowKey: string) {
  if (workflowKey === "dos_daily_review") {
    const [overview, plans, schemes] = await Promise.all([
      db.prepare(`SELECT
        (SELECT COUNT(*) FROM acad_lesson_plans WHERE organization_id=? AND status<>'delivered') AS openPlans,
        (SELECT COUNT(*) FROM acad_observations WHERE organization_id=? AND status<>'closed') AS openObservations,
        (SELECT COUNT(*) FROM acad_inspections WHERE organization_id=? AND status<>'closed') AS openInspections,
        (SELECT ROUND(AVG(coverage_percent),1) FROM acad_schemes WHERE organization_id=? AND status<>'archived') AS averageCoverage`).bind(organizationId, organizationId, organizationId, organizationId).first(),
      db.prepare(`SELECT p.lesson_date AS lessonDate,p.topic,p.status,c.name AS className,s.name AS subjectName,TRIM(sp.first_name||' '||sp.last_name) AS teacherName
        FROM acad_lesson_plans p JOIN school_classes c ON c.id=p.class_id JOIN school_subjects s ON s.id=p.subject_id LEFT JOIN school_staff_profiles sp ON sp.organization_id=p.organization_id AND sp.user_id=p.teacher_user_id
        WHERE p.organization_id=? AND p.status<>'delivered' ORDER BY p.lesson_date DESC,p.updated_at DESC LIMIT 30`).bind(organizationId).all(),
      db.prepare(`SELECT s.title,s.status,s.coverage_percent AS coveragePercent,c.name AS className,su.name AS subjectName,TRIM(sp.first_name||' '||sp.last_name) AS teacherName
        FROM acad_schemes s JOIN school_classes c ON c.id=s.class_id JOIN school_subjects su ON su.id=s.subject_id LEFT JOIN school_staff_profiles sp ON sp.organization_id=s.organization_id AND sp.user_id=s.teacher_user_id
        WHERE s.organization_id=? AND s.status<>'archived' ORDER BY s.coverage_percent ASC,s.updated_at DESC LIMIT 30`).bind(organizationId).all(),
    ]);
    return { overview, lessonPlans: plans.results, schemes: schemes.results };
  }

  if (workflowKey === "bursar_daily_review") {
    const totals = await db.prepare(`SELECT
      COALESCE(SUM(c.total_minor),0) AS billedMinor,
      COALESCE(SUM(c.credited_minor),0) AS creditedMinor,
      COALESCE(SUM(c.written_off_minor),0) AS writtenOffMinor,
      COALESCE(SUM(COALESCE(p.paid_minor,0)),0) AS paidMinor,
      COALESCE(SUM(c.total_minor-c.credited_minor-c.written_off_minor-COALESCE(p.paid_minor,0)),0) AS outstandingMinor
      FROM school_student_fee_charges c JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
      LEFT JOIN (SELECT organization_id,document_id,SUM(amount_minor) AS paid_minor FROM payment_allocations WHERE reversed_at IS NULL GROUP BY organization_id,document_id) p ON p.organization_id=c.organization_id AND p.document_id=c.document_id
      WHERE c.organization_id=? AND c.status<>'voided' AND d.status IN ('open','partially_paid','paid')`).bind(organizationId).first();
    const arrears = await db.prepare(`SELECT s.admission_number AS admissionNumber,s.first_name||' '||s.last_name AS studentName,
      ROUND(SUM(c.total_minor-c.credited_minor-c.written_off_minor-COALESCE(p.paid_minor,0))) AS balanceMinor
      FROM school_student_fee_charges c JOIN school_students s ON s.id=c.student_id AND s.organization_id=c.organization_id JOIN documents d ON d.id=c.document_id AND d.organization_id=c.organization_id
      LEFT JOIN (SELECT organization_id,document_id,SUM(amount_minor) AS paid_minor FROM payment_allocations WHERE reversed_at IS NULL GROUP BY organization_id,document_id) p ON p.organization_id=c.organization_id AND p.document_id=c.document_id
      WHERE c.organization_id=? AND c.status<>'voided' AND d.status IN ('open','partially_paid','paid') GROUP BY s.id HAVING balanceMinor>0 ORDER BY balanceMinor DESC LIMIT 20`).bind(organizationId).all();
    return { totals, largestArrears: arrears.results };
  }

  if (workflowKey === "hr_daily_review") {
    const dashboard = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM hr_employees WHERE organization_id=? AND employment_status='active') AS activeEmployees,
      (SELECT COUNT(*) FROM hr_departments WHERE organization_id=? AND active=1) AS departments,
      (SELECT COUNT(*) FROM hr_leave_requests WHERE organization_id=? AND status='pending') AS pendingLeave,
      (SELECT COUNT(*) FROM hr_onboarding_tasks WHERE organization_id=? AND status='pending') AS pendingOnboarding`).bind(organizationId, organizationId, organizationId, organizationId).first();
    const leave = await db.prepare(`SELECT e.employee_number AS employeeNumber,COALESCE(c.name,u.display_name,sp.first_name||' '||sp.last_name) AS employeeName,t.name AS leaveType,r.starts_on AS startsOn,r.ends_on AS endsOn,r.reason
      FROM hr_leave_requests r JOIN hr_employees e ON e.id=r.employee_id JOIN hr_leave_types t ON t.id=r.leave_type_id LEFT JOIN contacts c ON c.id=e.contact_id LEFT JOIN users u ON u.id=e.user_id LEFT JOIN school_staff_profiles sp ON sp.id=e.school_staff_id
      WHERE r.organization_id=? AND r.status='pending' ORDER BY r.created_at DESC LIMIT 20`).bind(organizationId).all();
    return { dashboard, pendingLeave: leave.results };
  }

  if (workflowKey === "secretary_daily_review") {
    const [school, comms] = await Promise.all([
      db.prepare(`SELECT
        (SELECT COUNT(*) FROM school_students WHERE organization_id=? AND deleted_at IS NULL AND status='active') AS activeStudents,
        (SELECT COUNT(*) FROM school_staff_profiles WHERE organization_id=? AND deleted_at IS NULL AND employment_status='active') AS activeStaff,
        (SELECT COUNT(*) FROM school_guardians WHERE organization_id=? AND active=1) AS activeGuardians`).bind(organizationId, organizationId, organizationId).first(),
      db.prepare(`SELECT COUNT(*) AS campaigns,SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) AS scheduled,SUM(sent_count) AS sent,SUM(failed_count) AS failed FROM communication_campaigns WHERE organization_id=?`).bind(organizationId).first(),
    ]);
    return { school, communications: comms };
  }

  if (workflowKey === "librarian_weekly_review") {
    const stock = await db.prepare(`SELECT book_type AS bookType,COALESCE(SUM(CASE WHEN reversed_at IS NULL THEN quantity_delta ELSE 0 END),0) AS receivedOrAdjusted FROM bks_stock_movements WHERE organization_id=? GROUP BY book_type`).bind(organizationId).all();
    const issued = await db.prepare(`SELECT book_type AS bookType,COALESCE(SUM(CASE WHEN reversed_at IS NULL THEN quantity ELSE 0 END),0) AS issued FROM bks_distributions WHERE organization_id=? GROUP BY book_type`).bind(organizationId).all();
    return { stock: stock.results, distributions: issued.results };
  }

  return {};
}

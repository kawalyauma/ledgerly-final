import type { BackendFeature } from "../types.js";
import { createSchoolRoutes } from "./routes.js";
import { createStudentRoutes } from "./students.js";
import { createStudentIntegrityRoutes } from "./student-integrity.js";
import { createAdmissionRoutes } from "./admissions.js";
import { createSchoolIamRoutes } from "./iam.js";
import { createStaffRoutes } from "./staff.js";
import { createStaffIntegrityRoutes } from "./staff-integrity.js";
import { createPromotionRoutes } from "./promotions.js";
import { createDisciplineRoutes } from "./discipline.js";
import { createSchoolFileRoutes } from "./files.js";
import { createSchoolFeeRoutes } from "./fees.js";
import { createSchoolFeeParityRoutes } from "./fees-parity.js";
import { createSchoolFeeReportRoutes } from "./fees-reports.js";
import { createSchoolFeeOperationRoutes } from "./fees-operations.js";
import { createSchoolFeeBillingIntegrityRoutes } from "./fees-billing.js";
import { sweepSchoolFeeInstallments } from "./fees-jobs.js";
import { createAttendanceRoutes } from "./attendance.js";
import { createClinicRoutes } from "./clinic.js";
import { createClinicRecordRoutes } from "./clinic-records.js";
import { createSchoolIntegrityRoutes } from "./integrity.js";

export const schoolFeature: BackendFeature = {
  key: "school-management",
  version: "3.8.0",
  mount(app,runtime){
    app.route("/api/v1/school",createSchoolIntegrityRoutes(runtime));
    app.route("/api/v1/school",createSchoolRoutes(runtime));
    app.route("/api/v1/school/student-management",createStudentIntegrityRoutes(runtime));
    app.route("/api/v1/school/student-management",createStudentRoutes(runtime));
    app.route("/api/v1/school/student-management",createAdmissionRoutes(runtime));
    app.route("/api/v1/school/iam",createSchoolIamRoutes(runtime));
    app.route("/api/v1/school/staff-management",createStaffIntegrityRoutes(runtime));
    app.route("/api/v1/school/staff-management",createStaffRoutes(runtime));
    app.route("/api/v1/school/promotion",createPromotionRoutes(runtime));
    app.route("/api/v1/school/discipline",createDisciplineRoutes(runtime));
    app.route("/api/v1/school/files",createSchoolFileRoutes(runtime));
    app.route("/api/v1/school/fees",createSchoolFeeBillingIntegrityRoutes(runtime));
    app.route("/api/v1/school/fees",createSchoolFeeOperationRoutes(runtime));
    app.route("/api/v1/school/fees",createSchoolFeeParityRoutes(runtime));
    app.route("/api/v1/school/fees",createSchoolFeeReportRoutes(runtime));
    app.route("/api/v1/school/fees",createSchoolFeeRoutes(runtime));
    app.route("/api/v1/school/attendance",createAttendanceRoutes(runtime));
    app.route("/api/v1/school/clinic",createClinicRecordRoutes(runtime));
    app.route("/api/v1/school/clinic",createClinicRoutes(runtime));
  },
  registerJobs(registry){registry.register("school.fees.installment_sweep",sweepSchoolFeeInstallments);},
  schedules:[{name:"school-fee-installment-sweep",cron:"15 0 * * *",kind:"school.fees.installment_sweep",queue:"school",maxAttempts:3}],
};

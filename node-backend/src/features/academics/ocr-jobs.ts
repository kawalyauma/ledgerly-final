import type { ClaimedJob } from "../../queue/postgres-queue.js";
import type { Runtime } from "../../runtime.js";
import { extractLessonPlanFromImage } from "./ocr-extract.js";

// Background handler for academics.ocr.lesson_plan — runs the (slow: container
// spin-up + real model call, often 30s-a few minutes) image OCR off the
// request/response cycle. The HTTP route only creates the job row and
// publishes this; the frontend polls GET .../extract/:jobId for the result.
export async function processLessonPlanOcrJob(job: ClaimedJob, runtime: Runtime) {
  const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
    ? job.payload as Record<string, unknown>
    : {};
  const jobId = typeof payload.jobId === "string" ? payload.jobId : "";
  if (!jobId) throw new Error("academics.ocr.lesson_plan job is missing jobId");

  const row = await runtime.db.query<{
    organizationId: string; userId: string; fileId: string; planId:string|null; objectKey: string; originalName: string;
  }>(
    `SELECT j.organization_id AS "organizationId", j.created_by AS "userId",j.plan_id AS "planId", f.id AS "fileId",
            f.object_key AS "objectKey", f.original_name AS "originalName"
       FROM school_academic_ocr_jobs j JOIN school_files f ON f.id=j.file_id
      WHERE j.id=$1 AND j.status='processing'`,
    [jobId],
  );
  const info = row.rows[0];
  if (!info) return;

  try {
    const bytes = await runtime.storage.get(info.objectKey);
    if (!bytes) throw new Error("Uploaded file could not be read from storage");
    const draft = await extractLessonPlanFromImage({
      runtime, organizationId: info.organizationId, userId: info.userId ?? "unknown",
      fileBytes: bytes, fileName: info.originalName,
    });
    await runtime.db.query(
      `UPDATE school_academic_ocr_jobs SET status='done', result_json=$1::jsonb, completed_at=CURRENT_TIMESTAMP WHERE id=$2`,
      [JSON.stringify(draft), jobId],
    );
    if(info.planId){
      await runtime.db.query(
        `UPDATE school_scheme_lesson_plans SET
          prior_knowledge=COALESCE(NULLIF(prior_knowledge,''),$1),
          introduction_text=COALESCE(NULLIF(introduction_text,''),$2),
          lesson_development=COALESCE(NULLIF(lesson_development,''),$3),
          teacher_activities=COALESCE(NULLIF(teacher_activities,''),$4),
          learner_activities=COALESCE(NULLIF(learner_activities,''),$5),
          differentiated_instruction=COALESCE(NULLIF(differentiated_instruction,''),$6),
          special_needs_accommodations=COALESCE(NULLIF(special_needs_accommodations,''),$7),
          lesson_conclusion=COALESCE(NULLIF(lesson_conclusion,''),$8),
          homework=COALESCE(NULLIF(homework,''),$9),
          ai_fill_status='done',ai_fill_error=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE id=$10 AND organization_id=$11 AND status='draft'`,
        [draft.priorKnowledge??null,draft.introductionText??null,draft.lessonDevelopment??null,
         draft.teacherActivities??null,draft.learnerActivities??null,draft.differentiatedInstruction??null,
         draft.specialNeedsAccommodations??null,draft.lessonConclusion??null,draft.homework??null,
         info.planId,info.organizationId],
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await runtime.db.query(
      `UPDATE school_academic_ocr_jobs SET status='failed', error_text=$1, completed_at=CURRENT_TIMESTAMP WHERE id=$2`,
      [message.slice(0, 2000), jobId],
    );
    await runtime.db.query(
      `UPDATE school_scheme_lesson_plans p SET ai_fill_status='failed',ai_fill_error=$1,updated_at=CURRENT_TIMESTAMP
        FROM school_academic_ocr_jobs j WHERE j.id=$2 AND j.plan_id=p.id AND p.organization_id=j.organization_id`,
      [message.slice(0,2000),jobId],
    );
  }
}

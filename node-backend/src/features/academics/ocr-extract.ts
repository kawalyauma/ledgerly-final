import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";
import { getLedgerlyAiFoundationService } from "../ledgerly-ai/runtime-service.js";

const OPEN = "[[LEDGERLY_AI_LESSON_PLAN_EXTRACT]]";
const CLOSE = "[[/LEDGERLY_AI_LESSON_PLAN_EXTRACT]]";

export type LessonPlanExtraction = {
  priorKnowledge?: string;
  introductionText?: string;
  lessonDevelopment?: string;
  teacherActivities?: string;
  learnerActivities?: string;
  differentiatedInstruction?: string;
  specialNeedsAccommodations?: string;
  lessonConclusion?: string;
  homework?: string;
  notes?: string;
};

function parseExtraction(text: string): LessonPlanExtraction | null {
  const start = text.indexOf(OPEN), end = text.indexOf(CLOSE);
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(text.slice(start + OPEN.length, end).trim());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as LessonPlanExtraction;
  } catch { return null; }
}

// A lightweight, single-shot, read-only provider call — not the incident/
// engineering-QA pipeline (no git worktree, no verification checks, no
// staging). It writes the uploaded image into a scratch directory the
// sandboxed CLI can see, asks it to transcribe/structure the content, and
// returns structured fields for a draft that was already saved. The background
// worker fills only blank fields; a human still reviews the result before the
// normal lesson-plan submission workflow can continue.
export async function extractLessonPlanFromImage(input: {
  runtime: Runtime;
  organizationId: string;
  userId: string;
  fileBytes: Uint8Array;
  fileName: string;
}): Promise<LessonPlanExtraction> {
  const service = getLedgerlyAiFoundationService(input.runtime);
  await service.start();
  const jobId = createId("aocr");
  const scratchDir = path.join(service.config.LEDGERLY_AI_WORK_ROOT, "academics-ocr", jobId);
  await mkdir(scratchDir, { recursive: true });
  const safeName = input.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120) || "scan.png";
  await writeFile(path.join(scratchDir, safeName), input.fileBytes);
  try {
    const prompt = [
      "You are Ledgerly Academics' handwriting/print transcription assistant.",
      `Read the image file "${safeName}" in this workspace directory. It is a photo or scan of a teacher's lesson plan.`,
      "Transcribe its content into the lesson plan fields below. Use only what is actually visible in the image — never invent content for a field you cannot read; leave it out instead.",
      "Return ONLY this envelope, with a JSON object matching this shape (all fields optional strings):",
      `${OPEN}{"priorKnowledge":"","introductionText":"","lessonDevelopment":"","teacherActivities":"","learnerActivities":"","differentiatedInstruction":"","specialNeedsAccommodations":"","lessonConclusion":"","homework":"","notes":"anything you could not confidently read"}${CLOSE}`,
    ].join("\n");
    const result = await service.providers.execute({
      id: jobId,
      organizationId: input.organizationId,
      userId: input.userId,
      correlationId: "academics:ocr:" + jobId,
      prompt,
      taskKind: "analysis",
      workspacePath: scratchDir,
      sandbox: "read-only",
      timeoutMs: Math.min(service.config.LEDGERLY_AI_JOB_TIMEOUT_MS, 180_000),
    });
    const parsed = parseExtraction(result.text);
    if (!parsed) throw new AppError(502, "OCR_EXTRACTION_FAILED", "Could not read structured content from this image. Try a clearer photo or enter the lesson plan manually.");
    return parsed;
  } finally {
    await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const SCHEME_OPEN = "[[LEDGERLY_AI_SCHEME_EXTRACT]]";
const SCHEME_CLOSE = "[[/LEDGERLY_AI_SCHEME_EXTRACT]]";

export type SchemeLessonExtraction = {
  title: string;
  subtopic?: string;
  learningOutcomes?: string;
  teachingMethods?: string;
  learningResources?: string;
  assessmentStrategy?: string;
};
export type SchemeTopicExtraction = {
  title: string;
  theme?: string;
  weekFrom?: number;
  weekTo?: number;
  lessons: SchemeLessonExtraction[];
};
export type SchemeExtraction = {
  title?: string;
  topics: SchemeTopicExtraction[];
  notes?: string;
};

function parseSchemeExtraction(text: string): SchemeExtraction | null {
  const start = text.indexOf(SCHEME_OPEN), end = text.indexOf(SCHEME_CLOSE);
  if (start === -1 || end === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(text.slice(start + SCHEME_OPEN.length, end).trim());
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as SchemeExtraction).topics)) return null;
    return parsed as SchemeExtraction;
  } catch { return null; }
}

// Same lightweight, single-shot, read-only pattern as extractLessonPlanFromImage,
// but reads a whole scheme-of-work document (photographed/scanned pages) and
// returns a topics→lessons draft. Never writes anything — the caller (the
// academics.scheme.import_from_document tool) still requires human approval
// before any of this is actually created.
export async function extractSchemeFromDocument(input: {
  runtime: Runtime;
  organizationId: string;
  userId: string;
  fileBytes: Uint8Array;
  fileName: string;
}): Promise<SchemeExtraction> {
  const service = getLedgerlyAiFoundationService(input.runtime);
  await service.start();
  const jobId = createId("aocr");
  const scratchDir = path.join(service.config.LEDGERLY_AI_WORK_ROOT, "academics-ocr", jobId);
  await mkdir(scratchDir, { recursive: true });
  const safeName = input.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120) || "scheme.png";
  await writeFile(path.join(scratchDir, safeName), input.fileBytes);
  try {
    const prompt = [
      "You are Ledgerly Academics' scheme-of-work transcription assistant.",
      `Read the image file "${safeName}" in this workspace directory. It is a photo or scan of a teacher's scheme of work (a term's curriculum broken into weekly topics and lessons).`,
      "Many real schemes use a four-level table: a broad THEME spanning several weeks (e.g. 'LIVING TOGETHER IN AFRICA'), containing one or more TOPICs, each with weekly/periodic lessons — a single topic can legitimately have many lesson rows (one per week/period), each with its own competences, methods and activities even when the topic (and sub-topic) text is the same across several weeks because that cell was merged in the source table.",
      "Group the content into topics, each with its lessons, and capture the theme label for each topic when the document shows one. Use only what is actually visible in the image — never invent a topic, lesson, theme or week number you cannot read.",
      "Return ONLY this envelope, with a JSON object matching this shape:",
      `${SCHEME_OPEN}{"title":"optional scheme title if visible","topics":[{"title":"","theme":"optional theme label if visible","weekFrom":1,"weekTo":1,"lessons":[{"title":"","subtopic":"","learningOutcomes":"","teachingMethods":"","learningResources":"","assessmentStrategy":""}]}],"notes":"anything you could not confidently read"}${SCHEME_CLOSE}`,
    ].join("\n");
    const result = await service.providers.execute({
      id: jobId,
      organizationId: input.organizationId,
      userId: input.userId,
      correlationId: "academics:ocr:" + jobId,
      prompt,
      taskKind: "analysis",
      workspacePath: scratchDir,
      sandbox: "read-only",
      timeoutMs: Math.min(service.config.LEDGERLY_AI_JOB_TIMEOUT_MS, 240_000),
    });
    const parsed = parseSchemeExtraction(result.text);
    if (!parsed || !parsed.topics.length) throw new AppError(502, "OCR_EXTRACTION_FAILED", "Could not read a scheme structure from this image. Try clearer photos of each page, or create the scheme manually.");
    return parsed;
  } finally {
    await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// @ts-nocheck
import {Hono} from "hono";
import type {AppVariables,Env} from "../../../src/types";
import {requireScope} from "../../../src/lib/auth";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {AppError} from "../../../src/lib/errors";
import {schoolPermission} from "../../school/backend/common";
import * as L from "./learning-cycle-service";
import * as Legacy from "./service";

export const academicsLearningCycleRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
academicsLearningCycleRoutes.use("*",requireModuleEnabled("school-management"));
academicsLearningCycleRoutes.use("*",requireModuleEnabled("academics"));
academicsLearningCycleRoutes.use("*",requireScope("school:read"));
const read=schoolPermission("school.academics:read");
const write=[requireScope("school:write"),schoolPermission("school.academics:write")];
const approve=[requireScope("school:write"),schoolPermission("school.academics:approve")];
const body=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const required=(v:any,label:string)=>{const x=String(v??"").trim();if(!x)throw new AppError(422,"VALIDATION_ERROR",`${label} is required`);return x;};
const principal=(c:any)=>c.get("principal");

academicsLearningCycleRoutes.get("/learning/dashboard",read,async c=>c.json({data:await L.learningDashboard(c.env.FINANCE_DB,principal(c).organizationId)}));
academicsLearningCycleRoutes.get("/learning/schemes",read,async c=>c.json({data:await L.listLearningSchemes(c.env.FINANCE_DB,principal(c).organizationId)}));
academicsLearningCycleRoutes.post("/learning/schemes",...write,async c=>{const p=principal(c),d=await body(c);required(d.academicYearId,"Academic year");required(d.termId,"Term");required(d.classId,"Class");required(d.subjectId,"Subject");return c.json({data:await L.createLearningScheme(c.env.FINANCE_DB,p.organizationId,p.userId,d)},201);});
academicsLearningCycleRoutes.get("/learning/schemes/:id",read,async c=>c.json({data:await L.learningSchemeDetail(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("id"))}));

academicsLearningCycleRoutes.post("/learning/schemes/:id/topics",...write,async c=>{const p=principal(c),d=await body(c);required(d.title,"Topic");return c.json({data:await L.addTopic(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),d)},201);});
academicsLearningCycleRoutes.patch("/learning/topics/:id",...write,async c=>{const p=principal(c);return c.json({data:await L.updateTopic(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),await body(c))});});
academicsLearningCycleRoutes.post("/learning/topics/:id/lessons",...write,async c=>{const p=principal(c),d=await body(c);required(d.title,"Lesson title");return c.json({data:await L.addLesson(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),d)},201);});
academicsLearningCycleRoutes.patch("/learning/lessons/:id",...write,async c=>{const p=principal(c);return c.json({data:await L.updateLesson(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),await body(c))});});
academicsLearningCycleRoutes.put("/learning/lessons/:id/competencies",...write,async c=>{const p=principal(c),d=await body(c),items=Array.isArray(d)?d:d.competencies;return c.json({data:await L.replaceCompetencies(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),items)});});
academicsLearningCycleRoutes.post("/learning/lessons/:id/lesson-plan",...write,async c=>{const p=principal(c);return c.json({data:await L.createPlanFromLesson(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),await body(c))},201);});
academicsLearningCycleRoutes.post("/learning/lessons/:id/deliver",...write,async c=>{const p=principal(c);return c.json({data:await L.recordDelivery(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),await body(c))});});

async function schemeReadiness(db:D1Database,org:string,id:string){
  const counts=await db.prepare(`SELECT
    (SELECT COUNT(*) FROM acad_scheme_topics WHERE organization_id=? AND scheme_id=?) topics,
    (SELECT COUNT(*) FROM acad_scheme_lessons WHERE organization_id=? AND scheme_id=?) lessons,
    (SELECT COUNT(*) FROM acad_scheme_lessons l WHERE l.organization_id=? AND l.scheme_id=? AND NOT EXISTS(SELECT 1 FROM acad_lesson_competencies c WHERE c.organization_id=l.organization_id AND c.scheme_lesson_id=l.id)) lessonsWithoutCompetencies`).bind(org,id,org,id,org,id).first<any>();
  return{topics:Number(counts?.topics||0),lessons:Number(counts?.lessons||0),lessonsWithoutCompetencies:Number(counts?.lessonsWithoutCompetencies||0)};
}
academicsLearningCycleRoutes.post("/learning/schemes/:id/submit",...write,async c=>{const p=principal(c),id=c.req.param("id"),ready=await schemeReadiness(c.env.FINANCE_DB,p.organizationId,id);if(!ready.topics||!ready.lessons)throw new AppError(409,"SCHEME_INCOMPLETE","Add at least one topic and lesson before submitting the scheme.",ready);if(ready.lessonsWithoutCompetencies)throw new AppError(409,"COMPETENCIES_INCOMPLETE",`${ready.lessonsWithoutCompetencies} lesson${ready.lessonsWithoutCompetencies===1?" has":"s have"} no competencies.`,ready);return c.json({data:await Legacy.schemeWorkflow(c.env.FINANCE_DB,p.organizationId,id,p.userId,"submit_hod")});});
academicsLearningCycleRoutes.post("/learning/schemes/:id/hod-approve",...approve,async c=>{const p=principal(c),d=await body(c);return c.json({data:await Legacy.schemeWorkflow(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),p.userId,"hod_approve",d.feedback)});});
academicsLearningCycleRoutes.post("/learning/schemes/:id/submit-dos",...write,async c=>{const p=principal(c);return c.json({data:await Legacy.schemeWorkflow(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),p.userId,"submit_dos")});});
academicsLearningCycleRoutes.post("/learning/schemes/:id/dos-approve",...approve,async c=>{const p=principal(c),d=await body(c);return c.json({data:await Legacy.schemeWorkflow(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),p.userId,"dos_approve",d.feedback)});});
academicsLearningCycleRoutes.post("/learning/schemes/:id/reject",...approve,async c=>{const p=principal(c),d=await body(c);return c.json({data:await Legacy.schemeWorkflow(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),p.userId,"reject",d.feedback||"Revise and resubmit")});});

academicsLearningCycleRoutes.get("/learning/lesson-plans/:id",read,async c=>c.json({data:await L.lessonPlanLearningDetail(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("id"))}));
academicsLearningCycleRoutes.post("/learning/lesson-plans/:id/submit",...write,async c=>{const p=principal(c);return c.json({data:await L.lessonPlanWorkflow(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),p.userId,"submit")});});
academicsLearningCycleRoutes.post("/learning/lesson-plans/:id/resubmit",...write,async c=>{const p=principal(c);return c.json({data:await L.lessonPlanWorkflow(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),p.userId,"resubmit")});});
academicsLearningCycleRoutes.post("/learning/lesson-plans/:id/approve",...approve,async c=>{const p=principal(c),d=await body(c);return c.json({data:await L.lessonPlanWorkflow(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),p.userId,"approve",d.feedback)});});
academicsLearningCycleRoutes.post("/learning/lesson-plans/:id/reject",...approve,async c=>{const p=principal(c),d=await body(c);return c.json({data:await L.lessonPlanWorkflow(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),p.userId,"reject",d.feedback||"Revise and resubmit")});});

academicsLearningCycleRoutes.get("/learning/lesson-plans/:id/assessment",read,async c=>c.json({data:await L.assessmentRoster(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("id"))}));
academicsLearningCycleRoutes.put("/learning/lesson-plans/:id/assessment",...write,async c=>{const p=principal(c);return c.json({data:await L.saveAssessment(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),await body(c))});});
academicsLearningCycleRoutes.post("/learning/lesson-plans/:id/assessment/submit",...write,async c=>{const p=principal(c);return c.json({data:await L.submitAssessment(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"))});});
academicsLearningCycleRoutes.post("/learning/lesson-plans/:id/assessment/reopen",...approve,async c=>{const p=principal(c);return c.json({data:await L.reopenAssessment(c.env.FINANCE_DB,p.organizationId,c.req.param("id"))});});

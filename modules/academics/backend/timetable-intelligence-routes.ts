// @ts-nocheck
import {Hono} from "hono";
import type {AppVariables,Env} from "../../../src/types";
import {requireScope} from "../../../src/lib/auth";
import {requireModuleEnabled} from "../../../src/lib/modules";
import {schoolPermission} from "../../school/backend/common";
import {AppError} from "../../../src/lib/errors";
import * as T from "./timetable-intelligence-service";
import {syncCurriculumLoadRules} from "./timetable-load-rules";
import {recoveryOptions,substituteCandidates} from "./timetable-recovery-service";

export const academicsTimetableIntelligenceRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();
academicsTimetableIntelligenceRoutes.use("*",requireModuleEnabled("school-management"));
academicsTimetableIntelligenceRoutes.use("*",requireModuleEnabled("academics"));
academicsTimetableIntelligenceRoutes.use("*",requireScope("school:read"));
const read=schoolPermission("school.academics:read");
const write=[requireScope("school:write"),schoolPermission("school.academics:write")];
const approve=[requireScope("school:write"),schoolPermission("school.academics:approve")];
const body=async(c:any)=>c.req.json<Record<string,any>>().catch(()=>({}));
const req=(v:any,label:string)=>{const x=String(v??"").trim();if(!x)throw new AppError(422,"VALIDATION_ERROR",`${label} is required`);return x;};
const principal=(c:any)=>c.get("principal");

academicsTimetableIntelligenceRoutes.get("/timetables/:id/rules",read,async c=>c.json({data:await T.listRules(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("id"))}));
academicsTimetableIntelligenceRoutes.post("/timetables/:id/rules",...write,async c=>{const p=principal(c);return c.json({data:await T.createRule(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),await body(c))},201);});
academicsTimetableIntelligenceRoutes.delete("/timetables/:id/rules/:ruleId",...write,async c=>c.json({data:await T.deleteRule(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("id"),c.req.param("ruleId"))}));
academicsTimetableIntelligenceRoutes.get("/timetables/:id/matrix",read,async c=>c.json({data:await T.matrix(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("id"))}));
academicsTimetableIntelligenceRoutes.get("/timetables/:id/validation",read,async c=>c.json({data:await T.validateTimetable(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("id"))}));

// Generating a draft is advisory. Before each run Ledgerly refreshes professional
// weekly subject load defaults from School Management's class-subject setup.
// Explicit timetable rules have higher priority and remain the final school decision.
academicsTimetableIntelligenceRoutes.post("/timetables/:id/drafts",...write,async c=>{const p=principal(c),d=await body(c),id=c.req.param("id");const curriculumLoad=await syncCurriculumLoadRules(c.env.FINANCE_DB,p.organizationId,p.userId,id);const draft=await T.generateDraft(c.env.FINANCE_DB,p.organizationId,p.userId,id,d);return c.json({data:{...draft,curriculumLoad}},201);});
academicsTimetableIntelligenceRoutes.get("/timetables/:id/drafts/:draftId",read,async c=>c.json({data:await T.getDraft(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("draftId"))}));
academicsTimetableIntelligenceRoutes.post("/timetables/:id/drafts/:draftId/apply",...approve,async c=>{const p=principal(c);return c.json({data:await T.applyDraft(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),c.req.param("draftId"))});});

academicsTimetableIntelligenceRoutes.get("/timetables/:id/week",read,async c=>c.json({data:await T.weekView(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("id"),c.req.query("start")||new Date().toISOString().slice(0,10))}));
academicsTimetableIntelligenceRoutes.post("/timetables/:id/week/materialize",...write,async c=>{const p=principal(c),d=await body(c);return c.json({data:await T.materializeWeek(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),req(d.startDate,"Week start date"))});});
academicsTimetableIntelligenceRoutes.get("/timetables/:id/lesson-context",read,async c=>c.json({data:await T.lessonPeriodContext(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("id"),c.req.query("date"))}));
academicsTimetableIntelligenceRoutes.get("/timetable-occurrences/:occurrenceId/substitute-options",read,async c=>c.json({data:await substituteCandidates(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("occurrenceId"))}));
academicsTimetableIntelligenceRoutes.get("/timetable-occurrences/:occurrenceId/recovery-options",read,async c=>c.json({data:await recoveryOptions(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("occurrenceId"),Number(c.req.query("days")||21))}));

academicsTimetableIntelligenceRoutes.get("/timetables/:id/exceptions",read,async c=>c.json({data:await T.listExceptions(c.env.FINANCE_DB,principal(c).organizationId,c.req.param("id"))}));
academicsTimetableIntelligenceRoutes.post("/timetables/:id/exceptions",...write,async c=>{const p=principal(c);return c.json({data:await T.createException(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),await body(c))},201);});
academicsTimetableIntelligenceRoutes.post("/timetables/:id/exceptions/:exceptionId/resolve",...write,async c=>{const p=principal(c),d=await body(c);return c.json({data:await T.resolveException(c.env.FINANCE_DB,p.organizationId,p.userId,c.req.param("id"),c.req.param("exceptionId"),d.notes)});});

import type {MobileSession} from "../auth";
import {ledgerlyRequest,type SessionUpdater} from "../apiClient";

export type LearningClient={session:MobileSession;onSession?:SessionUpdater};
export type LearningCompetency={id?:string;competencyType:string;code?:string;title:string;description?:string;successCriteria?:string};
export type LearningLesson={id:string;topicId:string;lessonNo?:number;sequenceNo:number;title:string;subtopic?:string;plannedDate?:string;durationMinutes?:number;learningOutcomes?:string;teachingMethods?:string;learningResources?:string;learnerActivities?:string;assessmentStrategy?:string;valuesAndCrossCutting?:string;status:string;lessonPlanId?:string;lessonPlanStatus?:string;assessmentId?:string;assessmentStatus?:string;markedLearners?:number;competencies:LearningCompetency[]};
export type LearningTopic={id:string;sequenceNo:number;title:string;description?:string;weekFrom?:number;weekTo?:number;status:string;lessons:LearningLesson[]};
export type LearningScheme={id:string;title:string;status:string;academicYearId?:string;academicYearName?:string;termId:string;termName?:string;classId:string;className?:string;streamId?:string;streamName?:string;subjectId:string;subjectName?:string;teacherUserId:string;teacherName?:string;coveragePercent?:number;topicCount?:number;lessonCount?:number;lessonPlanCount?:number;assessedLessonCount?:number;topics?:LearningTopic[];summary?:Record<string,number>;[key:string]:any};
export type LearningRosterRow={id:string;admissionNumber?:string;studentNumber?:string;name:string;mark?:{studentId:string;score?:number|null;absent?:boolean|number;competencyLevel?:string;remark?:string}|null};
export type LearningAssessment={planId:string;planStatus:string;schemeLessonId?:string|null;assessment?:{id:string;title:string;assessmentType:string;maxScore:number;status:string}|null;competencies:LearningCompetency[];learners:LearningRosterRow[];summary:{learners:number;recorded:number;scored:number;absent:number;average:number|null}};

const req=<T>(c:LearningClient,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,`/academics/learning${path}`,init,c.onSession);
const json=(method:string,body?:unknown):RequestInit=>({method,headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});

export const academicsLearningApi={
 dashboard:(c:LearningClient)=>req<any>(c,"/dashboard"),
 schemes:(c:LearningClient)=>req<LearningScheme[]>(c,"/schemes"),
 scheme:(c:LearningClient,id:string)=>req<LearningScheme>(c,`/schemes/${id}`),
 createScheme:(c:LearningClient,body:any)=>req<LearningScheme>(c,"/schemes",json("POST",body)),
 addTopic:(c:LearningClient,schemeId:string,body:any)=>req<any>(c,`/schemes/${schemeId}/topics`,json("POST",body)),
 updateTopic:(c:LearningClient,id:string,body:any)=>req<any>(c,`/topics/${id}`,json("PATCH",body)),
 addLesson:(c:LearningClient,topicId:string,body:any)=>req<any>(c,`/topics/${topicId}/lessons`,json("POST",body)),
 updateLesson:(c:LearningClient,id:string,body:any)=>req<any>(c,`/lessons/${id}`,json("PATCH",body)),
 replaceCompetencies:(c:LearningClient,lessonId:string,competencies:LearningCompetency[])=>req<LearningCompetency[]>(c,`/lessons/${lessonId}/competencies`,json("PUT",{competencies})),
 createLessonPlan:(c:LearningClient,lessonId:string,body:any)=>req<any>(c,`/lessons/${lessonId}/lesson-plan`,json("POST",body)),
 deliverLesson:(c:LearningClient,lessonId:string,body:any)=>req<any>(c,`/lessons/${lessonId}/deliver`,json("POST",body)),
 submitScheme:(c:LearningClient,id:string)=>req<any>(c,`/schemes/${id}/submit`,json("POST",{})),
 hodApproveScheme:(c:LearningClient,id:string,feedback?:string)=>req<any>(c,`/schemes/${id}/hod-approve`,json("POST",{feedback})),
 submitSchemeToDos:(c:LearningClient,id:string)=>req<any>(c,`/schemes/${id}/submit-dos`,json("POST",{})),
 dosApproveScheme:(c:LearningClient,id:string,feedback?:string)=>req<any>(c,`/schemes/${id}/dos-approve`,json("POST",{feedback})),
 rejectScheme:(c:LearningClient,id:string,feedback?:string)=>req<any>(c,`/schemes/${id}/reject`,json("POST",{feedback})),
 plan:(c:LearningClient,id:string)=>req<any>(c,`/lesson-plans/${id}`),
 submitPlan:(c:LearningClient,id:string)=>req<any>(c,`/lesson-plans/${id}/submit`,json("POST",{})),
 resubmitPlan:(c:LearningClient,id:string)=>req<any>(c,`/lesson-plans/${id}/resubmit`,json("POST",{})),
 approvePlan:(c:LearningClient,id:string,feedback?:string)=>req<any>(c,`/lesson-plans/${id}/approve`,json("POST",{feedback})),
 rejectPlan:(c:LearningClient,id:string,feedback?:string)=>req<any>(c,`/lesson-plans/${id}/reject`,json("POST",{feedback})),
 assessment:(c:LearningClient,id:string)=>req<LearningAssessment>(c,`/lesson-plans/${id}/assessment`),
 saveAssessment:(c:LearningClient,id:string,body:any)=>req<LearningAssessment>(c,`/lesson-plans/${id}/assessment`,json("PUT",body)),
 submitAssessment:(c:LearningClient,id:string)=>req<LearningAssessment>(c,`/lesson-plans/${id}/assessment/submit`,json("POST",{})),
 reopenAssessment:(c:LearningClient,id:string)=>req<LearningAssessment>(c,`/lesson-plans/${id}/assessment/reopen`,json("POST",{})),
};

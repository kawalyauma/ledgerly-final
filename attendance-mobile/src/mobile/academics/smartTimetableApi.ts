import type {MobileSession} from "../auth";
import {ledgerlyRequest,query,type SessionUpdater} from "../apiClient";

type Client={session:MobileSession;onSession?:SessionUpdater};
const req=<T>(c:Client,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,`/academics${path}`,init,c.onSession);
const body=(method:string,value?:unknown):RequestInit=>({method,body:value===undefined?undefined:JSON.stringify(value)});
export const smartTimetableApi={
 setup:(c:Client)=>req<any>(c,"/setup"),
 timetables:(c:Client)=>req<any[]>(c,"/timetables"),
 matrix:(c:Client,id:string)=>req<any>(c,`/timetables/${id}/matrix`),
 rules:(c:Client,id:string)=>req<any>(c,`/timetables/${id}/rules`),
 validation:(c:Client,id:string)=>req<any>(c,`/timetables/${id}/validation`),
 draft:(c:Client,id:string,mode:"replace"|"fill_gaps"="replace")=>req<any>(c,`/timetables/${id}/drafts`,body("POST",{mode})),
 applyDraft:(c:Client,id:string,draftId:string)=>req<any>(c,`/timetables/${id}/drafts/${draftId}/apply`,body("POST",{})),
 week:(c:Client,id:string,start:string)=>req<any>(c,`/timetables/${id}/week${query({start})}`),
 materializeWeek:(c:Client,id:string,startDate:string)=>req<any>(c,`/timetables/${id}/week/materialize`,body("POST",{startDate})),
 exceptions:(c:Client,id:string)=>req<any[]>(c,`/timetables/${id}/exceptions`),
 createException:(c:Client,id:string,value:any)=>req<any>(c,`/timetables/${id}/exceptions`,body("POST",value)),
};

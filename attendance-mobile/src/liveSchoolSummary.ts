import {fetchBootstrap} from "./api";
import {readKioskActivity} from "./kioskActivity";
import {OfflineStore} from "./native";
import {cacheBootstrap,cachedBootstrap} from "./storage";
import type {Bootstrap,Registration} from "./types";

export type LiveSchoolSummary={
  generatedAt:string;
  online:boolean;
  source:"live"|"cached";
  deviceName:string;
  locationName?:string;
  studentTotal:number;
  staffTotal:number;
  studentPresent:number;
  staffPresent:number;
  studentAbsent:number;
  staffAbsent:number;
  studentAttendancePct:number;
  staffAttendancePct:number;
  checkIns:number;
  checkOuts:number;
  activityCount:number;
  pendingSync:number;
  failedSync:number;
  lastActivityAt?:string;
  groups:Array<{name:string;present:number;total:number;pct:number}>;
};

function pct(value:number,total:number){return total?Math.round(value/total*100):0}

export async function loadLiveSchoolSummary(registration:Registration):Promise<LiveSchoolSummary>{
  let bootstrap:Bootstrap|null=null;
  let online=false;
  let source:"live"|"cached"="cached";
  try{
    bootstrap=await fetchBootstrap(registration);
    await cacheBootstrap(bootstrap);
    online=true;
    source="live";
  }catch{
    bootstrap=await cachedBootstrap();
  }
  const state=await readKioskActivity();
  const roster=bootstrap?.roster||[];
  const students=roster.filter(person=>!person.staffNumber);
  const staff=roster.filter(person=>!!person.staffNumber);
  const studentPresent=Object.values(state.people).filter(x=>x.personType==="student"&&x.direction==="IN").length;
  const staffPresent=Object.values(state.people).filter(x=>x.personType==="staff"&&x.direction==="IN").length;
  const groupsMap=new Map<string,{present:number;total:number}>();
  for(const person of roster){
    const name=person.groupName?.trim();
    if(!name)continue;
    const current=groupsMap.get(name)||{present:0,total:0};
    current.total+=1;
    const type=person.staffNumber?"staff":"student";
    if(state.people[`${type}:${person.id}`]?.direction==="IN")current.present+=1;
    groupsMap.set(name,current);
  }
  const groups=[...groupsMap.entries()].map(([name,x])=>({name,present:x.present,total:x.total,pct:pct(x.present,x.total)})).sort((a,b)=>b.present-a.present||a.name.localeCompare(b.name)).slice(0,6);
  const activityTimes=Object.values(state.people).map(x=>x.capturedAt).sort();
  const lastActivityAt=activityTimes.length?activityTimes[activityTimes.length-1]:undefined;
  const[pendingSync,failedSync]=await Promise.all([OfflineStore.count().catch(()=>0),OfflineStore.failedCount().catch(()=>0)]);
  return{
    generatedAt:new Date().toISOString(),online,source,
    deviceName:bootstrap?.device.name||"Attendance kiosk",
    locationName:bootstrap?.device.locationName,
    studentTotal:students.length,staffTotal:staff.length,
    studentPresent,staffPresent,
    studentAbsent:Math.max(0,students.length-studentPresent),staffAbsent:Math.max(0,staff.length-staffPresent),
    studentAttendancePct:pct(studentPresent,students.length),staffAttendancePct:pct(staffPresent,staff.length),
    checkIns:state.checkIns,checkOuts:state.checkOuts,activityCount:state.events,pendingSync,failedSync,lastActivityAt,groups,
  };
}

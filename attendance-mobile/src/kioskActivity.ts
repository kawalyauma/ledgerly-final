import {OfflineStore} from "./native";
import type {AttendanceEvent} from "./types";

const STATE_KEY="kiosk.live-display.activity.v1";
export type KioskPersonState={personType:"student"|"staff";personId:string;direction:"IN"|"OUT";capturedAt:string};
export type KioskActivityState={day:string;events:number;checkIns:number;checkOuts:number;people:Record<string,KioskPersonState>};

function dayKey(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}
function emptyState():KioskActivityState{return{day:dayKey(),events:0,checkIns:0,checkOuts:0,people:{}}}

export async function readKioskActivity():Promise<KioskActivityState>{
  try{
    const raw=await OfflineStore.getSecure(STATE_KEY);
    const parsed=raw?JSON.parse(raw) as KioskActivityState:null;
    if(!parsed||parsed.day!==dayKey())return emptyState();
    return parsed;
  }catch{return emptyState()}
}

export async function recordKioskActivity(event:AttendanceEvent){
  if(event.verificationMode==="TEST")return;
  const state=await readKioskActivity();
  const key=`${event.personType}:${event.personId}`;
  state.events+=1;
  if(event.direction==="IN")state.checkIns+=1;else state.checkOuts+=1;
  state.people[key]={personType:event.personType,personId:event.personId,direction:event.direction,capturedAt:event.capturedAt};
  await OfflineStore.putSecure(STATE_KEY,JSON.stringify(state));
}

import {OfflineStore} from "../native";
import type {Registration} from "../types";
import {DEFAULT_LEDGERLY_API_URL} from "./config";

export type MobileSession={
  accessToken:string;
  refreshToken:string;
  expiresIn:number;
  sessionId:string;
  apiUrl:string;
  identifier:string;
  organizationId?:string;
  userId?:string;
  displayName?:string;
  staffNumber?:string|null;
};

export type MobileAuthContext={apiUrl:string;organizationId:string;deviceToken:string;deviceId:string;userId?:string};
type LoginInput={identifier:string;password:string;organizationId?:string;mfaCode?:string};
type ErrorPayload={error?:{code?:string;message?:string;details?:unknown}};
const SESSION_KEY="mobile.auth.session";
const AUTH_CONTEXT_KEY="mobile.auth.pin-context";
const ONBOARDING_KEY="mobile.onboarding.complete";

export class MobileApiError extends Error{
  constructor(public status:number,public code:string,message:string,public details?:unknown){super(message)}
}
function base(url:string){return(url||DEFAULT_LEDGERLY_API_URL).trim().replace(/\/$/,"")}
async function jsonRequest<T>(url:string,init:RequestInit):Promise<T>{
  let response:Response;
  try{response=await fetch(url,init)}catch{throw new MobileApiError(0,"NETWORK_ERROR","Unable to reach Ledgerly. Check your connection and server address.")}
  const payload=await response.json().catch(()=>({})) as ErrorPayload&{data?:T};
  if(!response.ok)throw new MobileApiError(response.status,payload.error?.code||"REQUEST_FAILED",payload.error?.message||`Request failed (${response.status})`,payload.error?.details);
  return payload.data as T;
}
function decodeJwtClaims(token:string){
  try{
    const raw=token.split(".")[1];if(!raw)return{} as {org?:string;sub?:string};
    const normalized=raw.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(raw.length/4)*4,"=");
    return JSON.parse(atob(normalized)) as {org?:string;sub?:string};
  }catch{return{} as {org?:string;sub?:string}}
}
export async function loginMobile(apiUrl:string,input:LoginInput):Promise<MobileSession>{
  const data=await jsonRequest<Omit<MobileSession,"apiUrl"|"identifier"|"organizationId"|"userId">>(`${base(apiUrl)}/auth/login`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(input)});
  const claims=decodeJwtClaims(data.accessToken);
  return{...data,apiUrl:base(apiUrl),identifier:input.identifier.trim(),organizationId:input.organizationId?.trim()||claims.org,userId:claims.sub};
}
export async function refreshMobile(session:MobileSession):Promise<MobileSession>{
  const data=await jsonRequest<Omit<MobileSession,"apiUrl"|"identifier"|"organizationId"|"userId">>(`${base(session.apiUrl)}/auth/refresh`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({refreshToken:session.refreshToken})});
  const claims=decodeJwtClaims(data.accessToken);
  return{...session,...data,apiUrl:session.apiUrl,identifier:session.identifier,organizationId:session.organizationId||claims.org,userId:session.userId||claims.sub};
}
export async function logoutMobile(session:MobileSession){
  try{await fetch(`${base(session.apiUrl)}/auth/logout`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({refreshToken:session.refreshToken})})}catch{}
}
export async function saveMobileSession(session:MobileSession){await OfflineStore.putSecure(SESSION_KEY,JSON.stringify(session))}
export async function readMobileSession(){const raw=await OfflineStore.getSecure(SESSION_KEY);if(!raw)return null;try{return JSON.parse(raw) as MobileSession}catch{await OfflineStore.removeSecure(SESSION_KEY);return null}}
export async function clearMobileSession(){await OfflineStore.removeSecure(SESSION_KEY)}
export async function readMobileAuthContext(){const raw=await OfflineStore.getSecure(AUTH_CONTEXT_KEY);if(!raw)return null;try{return JSON.parse(raw) as MobileAuthContext}catch{await OfflineStore.removeSecure(AUTH_CONTEXT_KEY);return null}}
export async function clearMobileAuthContext(){await OfflineStore.removeSecure(AUTH_CONTEXT_KEY)}

export async function trustMobileDevice(session:MobileSession):Promise<MobileAuthContext>{
  const claims=decodeJwtClaims(session.accessToken),organizationId=session.organizationId||claims.org,userId=session.userId||claims.sub;
  if(!organizationId||!userId)throw new MobileApiError(422,"ORGANIZATION_REQUIRED","Unable to determine the school employee for this session.");
  const existing=await readMobileAuthContext();
  if(existing&&existing.apiUrl===base(session.apiUrl)&&existing.organizationId===organizationId&&existing.userId===userId&&existing.deviceToken)return existing;
  const data=await jsonRequest<{id:string;deviceToken:string;organizationId:string;userId:string}>(`${base(session.apiUrl)}/api/v1/school/mobile-pin/trusted-devices`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${session.accessToken}`},body:JSON.stringify({label:"Ledgerly Mobile",platform:"android"})});
  const context={apiUrl:base(session.apiUrl),organizationId:data.organizationId,deviceToken:data.deviceToken,deviceId:data.id,userId:data.userId};
  await OfflineStore.putSecure(AUTH_CONTEXT_KEY,JSON.stringify(context));
  return context;
}

export async function pinLoginMobile(input:{apiUrl:string;organizationId:string;pin:string;context?:MobileAuthContext|null;registration?:Registration|null}):Promise<MobileSession>{
  const payload:any={organizationId:input.organizationId,pin:input.pin};
  if(input.context?.deviceToken)payload.deviceToken=input.context.deviceToken;
  else if(input.registration){payload.attendanceDeviceId=input.registration.deviceId;payload.attendanceCredential=input.registration.credential}
  const data=await jsonRequest<Omit<MobileSession,"apiUrl"|"identifier"> & {organizationId:string}>(`${base(input.apiUrl)}/auth/pin-login`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(payload)});
  return{...data,apiUrl:base(input.apiUrl),identifier:"mobile-pin",organizationId:data.organizationId};
}

export async function onboardingComplete(){return(await OfflineStore.getSecure(ONBOARDING_KEY))==="1"}
export async function completeOnboarding(){await OfflineStore.putSecure(ONBOARDING_KEY,"1")}

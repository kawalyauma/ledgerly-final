import { Hono } from "hono";
import { SignJWT } from "jose";
import { z } from "zod";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { hashPassword, randomToken, sha256, verifyPassword } from "../../../src/lib/crypto";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";
import { requireModuleEnabled } from "../../../src/lib/modules";
import { audit, schoolPermission } from "./common";

export const schoolMobilePinPublicRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
export const schoolMobilePinAdminRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const pinSchema=z.string().regex(/^\d{4}$/,"PIN must contain exactly 4 digits");
const weakPins=new Set(["0000","1111","2222","3333","4444","5555","6666","7777","8888","9999","0123","1234","2345","3456","4567","5678","6789","9876","8765","7654","6543","5432","4321","3210"]);
const pinSecret=(env:Env,organizationId:string,pin:string)=>`${env.JWT_SECRET}|mobile-pin|${organizationId}|${pin}`;
const pinFingerprint=(env:Env,organizationId:string,pin:string)=>sha256(`${env.JWT_SECRET}|mobile-pin-fingerprint|${organizationId}|${pin}`);

async function issueTokens(env:Env,userId:string,organizationId:string,role:string,scopes:string[],meta:{ip?:string;userAgent?:string}){
  const now=Math.floor(Date.now()/1000);
  const accessToken=await new SignJWT({org:organizationId,role,scopes})
    .setProtectedHeader({alg:"HS256"}).setSubject(userId).setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE)
    .setIssuedAt(now).setExpirationTime(now+900).sign(new TextEncoder().encode(env.JWT_SECRET));
  const refreshToken=randomToken(48),sessionId=createId("ses");
  await env.FINANCE_DB.prepare("INSERT INTO sessions (id,user_id,organization_id,refresh_token_hash,expires_at,ip_address,user_agent) VALUES (?,?,?,?,datetime('now','+30 days'),?,?)")
    .bind(sessionId,userId,organizationId,await sha256(refreshToken),meta.ip??null,meta.userAgent??null).run();
  return {accessToken,expiresIn:900,refreshToken,sessionId};
}

async function trustedClient(env:Env,organizationId:string,input:{deviceToken?:string;attendanceDeviceId?:string;attendanceCredential?:string}){
  if(input.deviceToken){
    const tokenHash=await sha256(input.deviceToken);
    const device=await env.FINANCE_DB.prepare("SELECT id,created_by AS userId FROM school_mobile_trusted_devices WHERE organization_id=? AND token_hash=? AND revoked_at IS NULL LIMIT 1")
      .bind(organizationId,tokenHash).first<{id:string;userId:string|null}>();
    if(device){
      await env.FINANCE_DB.prepare("UPDATE school_mobile_trusted_devices SET last_used_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(device.id).run();
      return {clientKey:`mobile:${device.id}`,kind:"mobile" as const,id:device.id,userId:device.userId};
    }
  }
  if(input.attendanceDeviceId&&input.attendanceCredential){
    const credentialHash=await sha256(input.attendanceCredential);
    const device=await env.FINANCE_DB.prepare(`SELECT d.id FROM att_devices d
      JOIN att_device_credentials c ON c.device_id=d.id AND c.organization_id=d.organization_id
      WHERE d.organization_id=? AND d.id=? AND d.status='active' AND c.credential_hash=? AND c.revoked_at IS NULL
        AND (c.expires_at IS NULL OR c.expires_at>CURRENT_TIMESTAMP)
      ORDER BY c.created_at DESC LIMIT 1`).bind(organizationId,input.attendanceDeviceId,credentialHash).first<{id:string}>().catch(()=>null);
    if(device)return {clientKey:`attendance:${device.id}`,kind:"attendance" as const,id:device.id,userId:null};
  }
  throw new AppError(401,"TRUSTED_DEVICE_REQUIRED","PIN login is available only on a trusted Ledgerly mobile device or enrolled attendance kiosk");
}

async function rateLimit(db:D1Database,organizationId:string,clientKey:string){
  const row=await db.prepare("SELECT failed_attempts AS failedAttempts,locked_until AS lockedUntil FROM school_mobile_pin_rate_limits WHERE organization_id=? AND client_key=?")
    .bind(organizationId,clientKey).first<{failedAttempts:number;lockedUntil:string|null}>();
  if(row?.lockedUntil&&new Date(row.lockedUntil)>new Date()){
    const seconds=Math.max(1,Math.ceil((new Date(row.lockedUntil).getTime()-Date.now())/1000));
    throw new AppError(429,"PIN_TEMPORARILY_LOCKED",`Too many incorrect PIN attempts. Try again in ${seconds} seconds.`,{retryAfterSeconds:seconds});
  }
  return row;
}

async function failedAttempt(db:D1Database,organizationId:string,clientKey:string,current:{failedAttempts:number;lockedUntil:string|null}|null){
  const previous=current?.lockedUntil&&new Date(current.lockedUntil)<=new Date()?0:Number(current?.failedAttempts||0);
  const attempts=previous+1;
  const lockedUntil=attempts>=5?new Date(Date.now()+5*60_000).toISOString():null;
  await db.prepare(`INSERT INTO school_mobile_pin_rate_limits (organization_id,client_key,failed_attempts,locked_until,updated_at)
    VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(organization_id,client_key) DO UPDATE SET failed_attempts=excluded.failed_attempts,locked_until=excluded.locked_until,updated_at=CURRENT_TIMESTAMP`)
    .bind(organizationId,clientKey,attempts,lockedUntil).run();
  return {attempts,lockedUntil};
}

schoolMobilePinPublicRoutes.post("/pin-login",async c=>{
  const parsed=z.object({organizationId:z.string().min(1),pin:pinSchema,deviceToken:z.string().min(20).max(300).optional(),attendanceDeviceId:z.string().min(1).optional(),attendanceCredential:z.string().min(20).max(300).optional()}).safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid mobile PIN login",parsed.error.flatten());
  const v=parsed.data,db=c.env.FINANCE_DB;
  const moduleEnabled=await db.prepare("SELECT 1 ok FROM organization_modules WHERE organization_id=? AND module_key='school-management' AND enabled=1").bind(v.organizationId).first();
  if(!moduleEnabled)throw new AppError(403,"MODULE_DISABLED","School Management is not enabled for this organization");
  const client=await trustedClient(c.env,v.organizationId,v);
  const limiter=await rateLimit(db,v.organizationId,client.clientKey);
  const fingerprint=await pinFingerprint(c.env,v.organizationId,v.pin);
  const row=await db.prepare(`SELECT p.user_id AS userId,p.pin_hash AS pinHash,u.display_name AS displayName,u.status,
      m.role,m.scopes,sp.staff_number AS staffNumber,sp.status AS schoolStatus,sp.locked_until AS schoolLockedUntil
    FROM school_mobile_pins p
    JOIN users u ON u.id=p.user_id
    JOIN memberships m ON m.user_id=p.user_id AND m.organization_id=p.organization_id
    LEFT JOIN school_user_profiles sp ON sp.user_id=p.user_id AND sp.organization_id=p.organization_id
    WHERE p.organization_id=? AND p.pin_fingerprint=? AND (? IS NULL OR p.user_id=?) LIMIT 1`)
    .bind(v.organizationId,fingerprint,client.userId,client.userId).first<{userId:string;pinHash:string;displayName:string;status:string;role:string;scopes:string;staffNumber:string|null;schoolStatus:string|null;schoolLockedUntil:string|null}>();
  const valid=!!row&&row.status==="active"&&await verifyPassword(pinSecret(c.env,v.organizationId,v.pin),row.pinHash);
  const schoolBlocked=!!row?.schoolStatus&&(row.schoolStatus==="inactive"||row.schoolStatus==="suspended"||(row.schoolStatus==="locked"&&(!row.schoolLockedUntil||new Date(row.schoolLockedUntil)>new Date())));
  if(!valid||schoolBlocked){
    const failure=await failedAttempt(db,v.organizationId,client.clientKey,limiter);
    await db.prepare("INSERT INTO school_login_events (id,organization_id,user_id,identifier,event_type,ip_address,user_agent,reason) VALUES (?,?,?,?, 'failure',?,?,?)")
      .bind(createId("sle"),v.organizationId,row?.userId??client.userId??null,"mobile-pin",c.req.header("CF-Connecting-IP")??null,c.req.header("User-Agent")??null,schoolBlocked?"School account unavailable":"Invalid mobile PIN").run().catch(()=>undefined);
    if(failure.lockedUntil)throw new AppError(429,"PIN_TEMPORARILY_LOCKED","Too many incorrect PIN attempts. This device is locked for 5 minutes.",{retryAfterSeconds:300});
    throw new AppError(401,"INVALID_PIN",`Incorrect PIN. ${Math.max(0,5-failure.attempts)} attempt(s) remain before a temporary lock.`);
  }
  await db.prepare("DELETE FROM school_mobile_pin_rate_limits WHERE organization_id=? AND client_key=?").bind(v.organizationId,client.clientKey).run();
  await db.prepare("UPDATE school_user_profiles SET failed_login_count=0,last_login_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND user_id=?")
    .bind(v.organizationId,row!.userId).run().catch(()=>undefined);
  await db.prepare("INSERT INTO school_login_events (id,organization_id,user_id,identifier,event_type,ip_address,user_agent) VALUES (?,?,?,?, 'success',?,?)")
    .bind(createId("sle"),v.organizationId,row!.userId,"mobile-pin",c.req.header("CF-Connecting-IP")??null,c.req.header("User-Agent")??null).run().catch(()=>undefined);
  const tokenData=await issueTokens(c.env,row!.userId,v.organizationId,row!.role,JSON.parse(row!.scopes||"[]"),{ip:c.req.header("CF-Connecting-IP"),userAgent:c.req.header("User-Agent")});
  return c.json({data:{...tokenData,userId:row!.userId,displayName:row!.displayName,staffNumber:row!.staffNumber,organizationId:v.organizationId}});
});

schoolMobilePinAdminRoutes.use("*",requireModuleEnabled("school-management"));
schoolMobilePinAdminRoutes.use("*",requireScope("school:read"));

schoolMobilePinAdminRoutes.get("/status",schoolPermission("school.users:read"),async c=>{
  const p=c.get("principal");
  const rows=await c.env.FINANCE_DB.prepare("SELECT user_id AS userId,updated_at AS updatedAt,created_at AS createdAt FROM school_mobile_pins WHERE organization_id=? ORDER BY updated_at DESC")
    .bind(p.organizationId).all<{userId:string;updatedAt:string;createdAt:string}>();
  return c.json({data:rows.results.map(x=>({...x,pinConfigured:true}))});
});

schoolMobilePinAdminRoutes.put("/users/:id",requireScope("school:write"),schoolPermission("school.users:write"),async c=>{
  const p=c.get("principal"),userId=c.req.param("id"),parsed=z.object({pin:pinSchema}).safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Enter exactly four PIN digits",parsed.error.flatten());
  const pin=parsed.data.pin;
  if(weakPins.has(pin))throw new AppError(422,"WEAK_PIN","Choose a less predictable 4-digit PIN");
  const membership=await c.env.FINANCE_DB.prepare("SELECT 1 ok FROM memberships WHERE organization_id=? AND user_id=?").bind(p.organizationId,userId).first();
  if(!membership)throw new AppError(404,"SCHOOL_USER_NOT_FOUND","School user not found");
  const fingerprint=await pinFingerprint(c.env,p.organizationId,pin),hash=await hashPassword(pinSecret(c.env,p.organizationId,pin));
  const duplicate=await c.env.FINANCE_DB.prepare("SELECT user_id AS userId FROM school_mobile_pins WHERE organization_id=? AND pin_fingerprint=? AND user_id<>? LIMIT 1").bind(p.organizationId,fingerprint,userId).first<{userId:string}>();
  if(duplicate)throw new AppError(409,"PIN_ALREADY_IN_USE","That PIN is already assigned to another user in this school");
  await c.env.FINANCE_DB.prepare(`INSERT INTO school_mobile_pins (organization_id,user_id,pin_hash,pin_fingerprint,updated_by)
    VALUES (?,?,?,?,?)
    ON CONFLICT(organization_id,user_id) DO UPDATE SET pin_hash=excluded.pin_hash,pin_fingerprint=excluded.pin_fingerprint,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
    .bind(p.organizationId,userId,hash,fingerprint,p.userId).run();
  await audit(c.env.FINANCE_DB,c,"school.mobile_pin.assigned","school_user",userId,{pinConfigured:true});
  return c.json({data:{userId,pinConfigured:true,updatedAt:new Date().toISOString()}});
});

schoolMobilePinAdminRoutes.delete("/users/:id",requireScope("school:write"),schoolPermission("school.users:write"),async c=>{
  const p=c.get("principal"),userId=c.req.param("id");
  await c.env.FINANCE_DB.prepare("DELETE FROM school_mobile_pins WHERE organization_id=? AND user_id=?").bind(p.organizationId,userId).run();
  await audit(c.env.FINANCE_DB,c,"school.mobile_pin.removed","school_user",userId);
  return c.body(null,204);
});

schoolMobilePinAdminRoutes.post("/trusted-devices",async c=>{
  const p=c.get("principal"),parsed=z.object({label:z.string().max(120).optional(),platform:z.string().max(40).optional()}).safeParse(await c.req.json().catch(()=>({})));
  if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid trusted-device request",parsed.error.flatten());
  const token=randomToken(40),id=createId("smd");
  await c.env.FINANCE_DB.prepare("INSERT INTO school_mobile_trusted_devices (id,organization_id,token_hash,label,platform,created_by,last_used_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP)")
    .bind(id,p.organizationId,await sha256(token),parsed.data.label??"Ledgerly Mobile",parsed.data.platform??"android",p.userId).run();
  await audit(c.env.FINANCE_DB,c,"school.mobile_device.trusted","school_mobile_device",id,{label:parsed.data.label??"Ledgerly Mobile"});
  return c.json({data:{id,deviceToken:token,organizationId:p.organizationId,userId:p.userId}},201);
});

schoolMobilePinAdminRoutes.delete("/trusted-devices/:id",async c=>{
  const p=c.get("principal"),id=c.req.param("id");
  await c.env.FINANCE_DB.prepare("UPDATE school_mobile_trusted_devices SET revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=? AND revoked_at IS NULL").bind(id,p.organizationId).run();
  await audit(c.env.FINANCE_DB,c,"school.mobile_device.revoked","school_mobile_device",id);
  return c.body(null,204);
});

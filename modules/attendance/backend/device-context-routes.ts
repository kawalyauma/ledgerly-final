import { Hono } from "hono";
import type { AppVariables,Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { sha256 } from "../../../src/lib/crypto";

export const attendanceDeviceContextRoutes=new Hono<{Bindings:Env;Variables:AppVariables}>();

attendanceDeviceContextRoutes.get("/",async c=>{
  const auth=c.req.header("Authorization")||"";
  const match=/^Device\s+([^\.\s]+)\.([^\s]+)$/.exec(auth);
  if(!match)throw new AppError(401,"DEVICE_AUTH_REQUIRED","A device credential is required");
  const credentialHash=await sha256(match[2]);
  const device=await c.env.FINANCE_DB.prepare(`SELECT d.id,d.organization_id AS organizationId,d.device_code AS deviceCode,d.name,d.location_name AS locationName
    FROM att_devices d
    JOIN att_device_credentials cr ON cr.device_id=d.id AND cr.organization_id=d.organization_id
    JOIN organization_modules om ON om.organization_id=d.organization_id AND om.module_key='attendance' AND om.enabled=1
    WHERE d.id=? AND d.status='active' AND cr.credential_hash=? AND cr.revoked_at IS NULL
      AND (cr.expires_at IS NULL OR cr.expires_at>CURRENT_TIMESTAMP)
    ORDER BY cr.created_at DESC LIMIT 1`).bind(match[1],credentialHash).first<{id:string;organizationId:string;deviceCode:string;name:string;locationName:string|null}>();
  if(!device)throw new AppError(401,"INVALID_DEVICE_CREDENTIAL","Device credential is invalid, expired or revoked");
  return c.json({data:device});
});

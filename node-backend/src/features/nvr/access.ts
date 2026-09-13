import type { MiddlewareHandler } from 'hono';
import type { AppEnv, AuthPrincipal } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { AppError } from '../../http/errors.js';

export async function canAccessNvrCamera(runtime:Runtime,p:AuthPrincipal,cameraId:string){
  if(p.role==='owner'||p.role==='admin')return true;
  const q=await runtime.db.query(`SELECT 1 FROM nvr_cameras c WHERE c.id=$1 AND c.organization_id=$2 AND (NOT EXISTS(SELECT 1 FROM nvr_camera_group_members gm WHERE gm.organization_id=c.organization_id AND gm.camera_id=c.id) OR EXISTS(SELECT 1 FROM nvr_camera_group_members gm JOIN nvr_camera_group_shares gs ON gs.organization_id=gm.organization_id AND gs.group_id=gm.group_id WHERE gm.organization_id=c.organization_id AND gm.camera_id=c.id AND gs.user_id=$3))`,[cameraId,p.organizationId,p.userId]);
  return Boolean(q.rowCount);
}

export async function requireNvrCameraAccess(runtime:Runtime,p:AuthPrincipal,cameraId:string){
  if(!await canAccessNvrCamera(runtime,p,cameraId))throw new AppError(403,'CAMERA_FORBIDDEN','You do not have access to this camera');
}

async function cameraFromRecording(runtime:Runtime,org:string,id:string){const q=await runtime.db.query(`SELECT camera_id FROM nvr_recordings WHERE id=$1 AND organization_id=$2`,[id,org]);return (q.rows[0] as any)?.camera_id as string|undefined;}
async function cameraFromEvent(runtime:Runtime,org:string,id:string){const q=await runtime.db.query(`SELECT camera_id FROM nvr_events WHERE id=$1 AND organization_id=$2`,[id,org]);return (q.rows[0] as any)?.camera_id as string|undefined;}
async function cameraFromSession(runtime:Runtime,org:string,id:string){const q=await runtime.db.query(`SELECT camera_id FROM nvr_stream_sessions WHERE id=$1 AND organization_id=$2`,[id,org]);return (q.rows[0] as any)?.camera_id as string|undefined;}

export function nvrCameraAccessGuard(runtime:Runtime):MiddlewareHandler<AppEnv>{return async(c,next)=>{
  const p=c.get('principal');if(!p||p.role==='owner'||p.role==='admin'||c.req.path.includes('/device/')){await next();return;}
  const path=c.req.path;let cameraId:string|undefined;
  let m=path.match(/\/cameras\/([^/]+)\/live-sessions(?:\/|$)/);if(m)cameraId=m[1];
  if(!cameraId){m=path.match(/\/recordings\/([^/]+)/);if(m)cameraId=await cameraFromRecording(runtime,p.organizationId,m[1]);}
  if(!cameraId){m=path.match(/\/events\/([^/]+)/);if(m)cameraId=await cameraFromEvent(runtime,p.organizationId,m[1]);}
  if(!cameraId){m=path.match(/\/live-sessions\/([^/]+)/);if(m)cameraId=await cameraFromSession(runtime,p.organizationId,m[1]);}
  if(!cameraId&&path.endsWith('/timeline'))cameraId=c.req.query('cameraId')||undefined;
  if(cameraId)await requireNvrCameraAccess(runtime,p,cameraId);
  await next();
};}

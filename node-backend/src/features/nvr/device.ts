import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { randomToken, sha256 } from '../core-identity/security.js';

const pairSchema=z.object({cameraId:z.string().min(1),pairingCode:z.string().regex(/^\d{6}$/),deviceId:z.string().min(3).max(200),appVersion:z.string().max(80).optional(),capabilities:z.record(z.string(),z.unknown()).default({})});
const beatSchema=z.object({status:z.enum(['online','recording','error']).default('online'),capabilities:z.record(z.string(),z.unknown()).optional(),error:z.string().max(1000).nullable().optional(),appVersion:z.string().max(80).optional()});
const bearer=(c:any)=>(c.req.header('Authorization')||'').replace(/^Bearer\s+/i,'').trim();

async function authenticate(runtime:Runtime,secret:string){
  if(!secret)throw new AppError(401,'CAMERA_UNAUTHORIZED','Missing camera credential');
  const q=await runtime.db.query(`SELECT id,organization_id FROM nvr_cameras WHERE device_secret_digest=$1 AND enabled=true AND source_type='phone'`,[sha256(secret)]);
  if(!q.rowCount)throw new AppError(401,'CAMERA_UNAUTHORIZED','Invalid camera credential');
  return q.rows[0] as any;
}

export function createNvrDeviceRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();
  r.post('/device/pair',async c=>{
    const s=pairSchema.safeParse(await c.req.json().catch(()=>null));
    if(!s.success)throw new AppError(422,'VALIDATION_ERROR','Invalid camera pairing request',s.error.flatten());
    const v=s.data;
    const client=await runtime.db.connect();
    try{
      await client.query('BEGIN');
      const q=await client.query(`SELECT id,organization_id,pairing_code_digest,pairing_expires_at FROM nvr_cameras WHERE id=$1 AND source_type='phone' AND enabled=true FOR UPDATE`,[v.cameraId]);
      if(!q.rowCount)throw new AppError(404,'CAMERA_NOT_FOUND','Phone camera not found');
      const cam=q.rows[0] as any;
      if(!cam.pairing_code_digest||!cam.pairing_expires_at||new Date(cam.pairing_expires_at).getTime()<=Date.now()||cam.pairing_code_digest!==sha256(v.pairingCode))throw new AppError(409,'PAIRING_CODE_INVALID','Pairing code is invalid or expired');
      const secret=randomToken(32);
      await client.query(`UPDATE nvr_cameras SET device_identifier=$1,device_secret_digest=$2,paired_at=CURRENT_TIMESTAMP,pairing_code_digest=NULL,pairing_expires_at=NULL,capabilities=$3::jsonb,status='online',last_seen_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$4`,[v.deviceId,sha256(secret),JSON.stringify(v.capabilities),v.cameraId]);
      await client.query('COMMIT');
      return c.json({data:{cameraId:v.cameraId,credential:secret,status:'online'}});
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
  });
  r.post('/device/heartbeat',async c=>{
    const cam=await authenticate(runtime,bearer(c));
    const s=beatSchema.safeParse(await c.req.json().catch(()=>null));
    if(!s.success)throw new AppError(422,'VALIDATION_ERROR','Invalid camera heartbeat',s.error.flatten());
    const q=await runtime.db.query(`UPDATE nvr_cameras SET status=$1,capabilities=COALESCE($2::jsonb,capabilities),last_error=$3,last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND organization_id=$5 AND enabled=true RETURNING id`,[s.data.status,s.data.capabilities?JSON.stringify(s.data.capabilities):null,s.data.error??null,cam.id,cam.organization_id]);
    if(!q.rowCount)throw new AppError(404,'CAMERA_NOT_FOUND','Camera not found or disabled');
    return c.json({data:{cameraId:cam.id,status:s.data.status,serverTime:new Date().toISOString()}});
  });
  return r;
}

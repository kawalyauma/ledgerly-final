import { randomInt } from 'node:crypto';
import { Hono } from 'hono';
import { AppError } from '../../http/errors.js';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { requireScope, sha256 } from '../core-identity/security.js';

export function createNvrPairingRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();
  r.use('*',requireScope('school:write'));
  r.post('/cameras/:id/pairing-code',async c=>{
    const p=c.get('principal');
    const cameraId=c.req.param('id');
    const exists=await runtime.db.query(`SELECT id,source_type FROM nvr_cameras WHERE id=$1 AND organization_id=$2 AND enabled=true`,[cameraId,p.organizationId]);
    if(!exists.rowCount)throw new AppError(404,'CAMERA_NOT_FOUND','Camera not found or disabled');
    if(String((exists.rows[0] as any).source_type)!=='phone')throw new AppError(409,'PAIRING_UNSUPPORTED','Pairing codes are only available for phone cameras');
    const code=String(randomInt(0,1000000)).padStart(6,'0');
    const expiresAt=new Date(Date.now()+10*60*1000).toISOString();
    await runtime.db.query(`UPDATE nvr_cameras SET pairing_code_digest=$1,pairing_expires_at=$2,device_identifier=NULL,device_secret_digest=NULL,paired_at=NULL,status='offline',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$3 AND organization_id=$4`,[sha256(code),expiresAt,cameraId,p.organizationId]);
    return c.json({data:{cameraId,code,expiresAt}});
  });
  r.post('/cameras/:id/revoke-device',async c=>{
    const p=c.get('principal');
    const q=await runtime.db.query(`UPDATE nvr_cameras SET device_identifier=NULL,device_secret_digest=NULL,paired_at=NULL,pairing_code_digest=NULL,pairing_expires_at=NULL,status='offline',updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND source_type='phone' RETURNING id`,[c.req.param('id'),p.organizationId]);
    if(!q.rowCount)throw new AppError(404,'CAMERA_NOT_FOUND','Phone camera not found');
    return c.json({data:{id:c.req.param('id'),paired:false}});
  });
  return r;
}

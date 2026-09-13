import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { createId } from '../core-identity/security.js';
import { authenticateNvrCamera, nvrBearer } from './device.js';

const bodySchema=z.object({type:z.enum(['answer','ice','ready','close','error']),payload:z.record(z.string(),z.unknown()).default({})});

export function createNvrDeviceSignalRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();
  r.get('/device/live-sessions',async c=>{const cam=await authenticateNvrCamera(runtime,nvrBearer(c));const q=await runtime.db.query(`SELECT id,status,transport,expires_at AS "expiresAt",created_at AS "createdAt" FROM nvr_stream_sessions WHERE organization_id=$1 AND camera_id=$2 AND status IN ('requested','active') AND expires_at>CURRENT_TIMESTAMP ORDER BY created_at`,[cam.organization_id,cam.id]);return c.json({data:q.rows});});
  r.get('/device/live-sessions/:id/signals',async c=>{const cam=await authenticateNvrCamera(runtime,nvrBearer(c));const s=await runtime.db.query(`SELECT id FROM nvr_stream_sessions WHERE id=$1 AND organization_id=$2 AND camera_id=$3`,[c.req.param('id'),cam.organization_id,cam.id]);if(!s.rowCount)throw new AppError(404,'LIVE_SESSION_NOT_FOUND','Live session not found');const q=await runtime.db.query(`SELECT id,sender_type AS "senderType",signal_type AS type,payload,created_at AS "createdAt" FROM nvr_stream_signals WHERE organization_id=$1 AND session_id=$2 ORDER BY created_at,id LIMIT 500`,[cam.organization_id,c.req.param('id')]);return c.json({data:q.rows});});
  r.post('/device/live-sessions/:id/signals',async c=>{const cam=await authenticateNvrCamera(runtime,nvrBearer(c));const x=bodySchema.safeParse(await c.req.json().catch(()=>null));if(!x.success)throw new AppError(422,'VALIDATION_ERROR','Invalid signal',x.error.flatten());const s=await runtime.db.query(`SELECT id FROM nvr_stream_sessions WHERE id=$1 AND organization_id=$2 AND camera_id=$3 AND status IN ('requested','active') AND expires_at>CURRENT_TIMESTAMP`,[c.req.param('id'),cam.organization_id,cam.id]);if(!s.rowCount)throw new AppError(404,'LIVE_SESSION_NOT_FOUND','Live session not found');const id=createId('nvrSig');await runtime.db.query(`INSERT INTO nvr_stream_signals(id,organization_id,session_id,camera_id,sender_type,signal_type,payload) VALUES($1,$2,$3,$4,'camera',$5,$6::jsonb)`,[id,cam.organization_id,c.req.param('id'),cam.id,x.data.type,JSON.stringify(x.data.payload)]);if(['answer','ready'].includes(x.data.type))await runtime.db.query(`UPDATE nvr_stream_sessions SET status='active' WHERE id=$1 AND organization_id=$2 AND status='requested'`,[c.req.param('id'),cam.organization_id]);if(['close','error'].includes(x.data.type))await runtime.db.query(`UPDATE nvr_stream_sessions SET status=$1,closed_at=CURRENT_TIMESTAMP WHERE id=$2 AND organization_id=$3`,[x.data.type==='close'?'closed':'failed',c.req.param('id'),cam.organization_id]);return c.json({data:{id}},201);});
  return r;
}

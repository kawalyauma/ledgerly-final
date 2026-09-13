import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { createId, requireScope } from '../core-identity/security.js';

const bodySchema=z.object({type:z.enum(['offer','ice','close']),payload:z.record(z.string(),z.unknown()).default({})});

export function createNvrViewerSignalRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();
  r.get('/live-sessions/:id/signals',requireScope('school:read'),async c=>{
    const p=c.get('principal');
    const s=await runtime.db.query(`SELECT id,requested_by,expires_at FROM nvr_stream_sessions WHERE id=$1 AND organization_id=$2`,[c.req.param('id'),p.organizationId]);
    if(!s.rowCount)throw new AppError(404,'LIVE_SESSION_NOT_FOUND','Live session not found');
    const row=s.rows[0] as any;if(row.requested_by&&row.requested_by!==p.userId&&!['owner','admin'].includes(p.role))throw new AppError(403,'LIVE_SESSION_FORBIDDEN','This live session belongs to another user');
    const q=await runtime.db.query(`SELECT id,sender_type AS "senderType",signal_type AS type,payload,created_at AS "createdAt" FROM nvr_stream_signals WHERE organization_id=$1 AND session_id=$2 ORDER BY created_at,id LIMIT 500`,[p.organizationId,row.id]);
    return c.json({data:q.rows});
  });
  r.post('/live-sessions/:id/signals',requireScope('school:read'),async c=>{
    const p=c.get('principal'),x=bodySchema.safeParse(await c.req.json().catch(()=>null));if(!x.success)throw new AppError(422,'VALIDATION_ERROR','Invalid signal',x.error.flatten());
    const s=await runtime.db.query(`SELECT id,camera_id,requested_by FROM nvr_stream_sessions WHERE id=$1 AND organization_id=$2 AND status IN ('requested','active') AND expires_at>CURRENT_TIMESTAMP`,[c.req.param('id'),p.organizationId]);if(!s.rowCount)throw new AppError(404,'LIVE_SESSION_NOT_FOUND','Live session not found');
    const row=s.rows[0] as any;if(row.requested_by&&row.requested_by!==p.userId&&!['owner','admin'].includes(p.role))throw new AppError(403,'LIVE_SESSION_FORBIDDEN','This live session belongs to another user');
    const id=createId('nvrSig');await runtime.db.query(`INSERT INTO nvr_stream_signals(id,organization_id,session_id,camera_id,sender_type,sender_user_id,signal_type,payload) VALUES($1,$2,$3,$4,'viewer',$5,$6,$7::jsonb)`,[id,p.organizationId,row.id,row.camera_id,p.userId,x.data.type,JSON.stringify(x.data.payload)]);
    if(x.data.type==='close')await runtime.db.query(`UPDATE nvr_stream_sessions SET status='closed',closed_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`,[row.id,p.organizationId]);
    return c.json({data:{id}},201);
  });
  return r;
}

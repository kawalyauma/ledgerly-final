import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { createId } from '../core-identity/security.js';
import { authenticateNvrCamera, nvrBearer } from './device.js';

const schema=z.object({eventType:z.string().min(1).max(80),severity:z.enum(['info','warning','critical']).default('warning'),title:z.string().min(1).max(200),details:z.record(z.string(),z.unknown()).default({}),occurredAt:z.string().datetime().optional()});

export function createNvrDeviceEventRoutes(runtime:Runtime){const r=new Hono<AppEnv>();
 r.post('/device/events',async c=>{const cam=await authenticateNvrCamera(runtime,nvrBearer(c)),s=schema.safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,'VALIDATION_ERROR','Invalid camera event',s.error.flatten());const id=createId('nvrEvt');await runtime.db.query(`INSERT INTO nvr_events(id,organization_id,camera_id,event_type,severity,title,details,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,COALESCE($8::timestamptz,CURRENT_TIMESTAMP))`,[id,cam.organization_id,cam.id,s.data.eventType,s.data.severity,s.data.title,JSON.stringify(s.data.details),s.data.occurredAt??null]);return c.json({data:{id,accepted:true}},202);});
 return r;}

import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { AppError } from '../../http/errors.js';
import { requireScope } from '../core-identity/security.js';
import { requireNvrCameraAccess } from './access.js';

const qSchema=z.object({cameraId:z.string().optional(),from:z.string().datetime().optional(),to:z.string().datetime().optional(),limit:z.coerce.number().int().min(1).max(500).default(200)});
export function createNvrAccessTimelineRoutes(runtime:Runtime){const r=new Hono<AppEnv>();r.use('*',requireScope('school:read'));
r.get('/timeline',async c=>{const p=c.get('principal'),s=qSchema.safeParse(c.req.query());if(!s.success)throw new AppError(422,'VALIDATION_ERROR','Invalid timeline query',s.error.flatten());const v=s.data,priv=p.role==='owner'||p.role==='admin';if(v.cameraId)await requireNvrCameraAccess(runtime,p,v.cameraId);const params:any[]=[p.organizationId,p.userId,priv],filters:string[]=[];if(v.cameraId){params.push(v.cameraId);filters.push(`camera_id=$${params.length}`)}if(v.from){params.push(v.from);filters.push(`ts>=$${params.length}`)}if(v.to){params.push(v.to);filters.push(`ts<=$${params.length}`)}params.push(v.limit);const access=`($3::boolean OR camera_id IS NULL OR NOT EXISTS(SELECT 1 FROM nvr_camera_group_members gm WHERE gm.organization_id=$1 AND gm.camera_id=x.camera_id) OR EXISTS(SELECT 1 FROM nvr_camera_group_members gm JOIN nvr_camera_group_shares gs ON gs.organization_id=gm.organization_id AND gs.group_id=gm.group_id WHERE gm.organization_id=$1 AND gm.camera_id=x.camera_id AND gs.user_id=$2))`;const sql=`SELECT * FROM ((SELECT id,camera_id,'event'::text AS kind,occurred_at AS ts,event_type AS type,severity,title,details,NULL::text AS status,NULL::bigint AS size_bytes FROM nvr_events WHERE organization_id=$1) UNION ALL (SELECT id,camera_id,'recording'::text AS kind,started_at AS ts,NULL::text AS type,NULL::text AS severity,NULL::text AS title,jsonb_build_object('endedAt',ended_at,'durationSeconds',duration_seconds,'mimeType',mime_type),status,size_bytes FROM nvr_recordings WHERE organization_id=$1 AND status<>'deleted')) x WHERE ${access}${filters.length?' AND '+filters.join(' AND '):''} ORDER BY ts DESC LIMIT $${params.length}`;const q=await runtime.db.query(sql,params);return c.json({data:q.rows});});
return r;}

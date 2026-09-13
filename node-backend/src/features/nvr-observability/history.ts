import { Hono } from 'hono';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { requireScope } from '../core-identity/security.js';

export function createNvrHistoryRoutes(runtime:Runtime){const r=new Hono<AppEnv>();r.use('*',requireScope('school:read'));
r.get('/audit',async c=>{const p=c.get('principal'),limit=Math.min(500,Math.max(1,Number(c.req.query('limit')||200)));const q=await runtime.db.query(`SELECT id,actor_id AS "actorId",action,entity_type AS "entityType",entity_id AS "entityId",before_data AS "before",after_data AS "after",created_at AS "createdAt" FROM audit_logs WHERE organization_id=$1 AND (entity_type LIKE 'nvr%' OR action LIKE 'nvr.%') ORDER BY created_at DESC LIMIT $2`,[p.organizationId,limit]);return c.json({data:q.rows});});
r.get('/history',async c=>{const org=c.get('principal').organizationId;const q=await runtime.db.query(`SELECT id,'event'::text kind,title AS summary,severity,occurred_at AS "createdAt" FROM nvr_events WHERE organization_id=$1 UNION ALL SELECT id,'export'::text kind,'Recording export'::text summary,'info'::text severity,created_at AS "createdAt" FROM nvr_recording_exports WHERE organization_id=$1 UNION ALL SELECT id,'hold'::text kind,reason AS summary,'warning'::text severity,held_at AS "createdAt" FROM nvr_recording_holds WHERE organization_id=$1 ORDER BY "createdAt" DESC LIMIT 500`,[org]);return c.json({data:q.rows});});
return r;}

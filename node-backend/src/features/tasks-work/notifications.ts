import { Hono } from 'hono';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { requireScope } from '../core-identity/security.js';

export function createWorkNotificationRoutes(runtime:Runtime){const r=new Hono<AppEnv>();r.use('*',requireScope('work:read'));
r.get('/notifications',async c=>{const p=c.get('principal'),q=await runtime.db.query(`SELECT * FROM work_notifications WHERE organization_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 200`,[p.organizationId,p.userId]);return c.json({data:q.rows});});
r.post('/notifications/read-all',async c=>{const p=c.get('principal'),q=await runtime.db.query(`UPDATE work_notifications SET read_at=CURRENT_TIMESTAMP WHERE organization_id=$1 AND user_id=$2 AND read_at IS NULL`,[p.organizationId,p.userId]);return c.json({data:{updated:q.rowCount??0}});});
r.post('/notifications/:id/read',async c=>{const p=c.get('principal'),q=await runtime.db.query(`UPDATE work_notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=$1 AND organization_id=$2 AND user_id=$3 RETURNING *`,[c.req.param('id'),p.organizationId,p.userId]);return q.rowCount?c.json({data:q.rows[0]}):c.json({error:{code:'NOT_FOUND',message:'Notification not found'}},404);});
return r;}

import { Hono } from 'hono';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { requireScope } from '../core-identity/security.js';

export function createNvrHealthRoutes(runtime:Runtime){const r=new Hono<AppEnv>();r.use('*',requireScope('school:read'));
r.get('/dashboard/health',async c=>{const org=c.get('principal').organizationId;
const cams=await runtime.db.query(`SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='online')::int online,COUNT(*) FILTER(WHERE status='recording')::int recording,COUNT(*) FILTER(WHERE status='offline')::int offline,COUNT(*) FILTER(WHERE status='error')::int errors,COUNT(*) FILTER(WHERE enabled AND (last_seen_at IS NULL OR last_seen_at<CURRENT_TIMESTAMP-INTERVAL '90 seconds'))::int stale FROM nvr_cameras WHERE organization_id=$1`,[org]);
const recs=await runtime.db.query(`SELECT COUNT(*) FILTER(WHERE status='ready')::int ready,COUNT(*) FILTER(WHERE status='recording')::int active,COUNT(*) FILTER(WHERE started_at>=CURRENT_TIMESTAMP-INTERVAL '24 hours')::int "last24h",COALESCE(SUM(size_bytes) FILTER(WHERE status='ready'),0)::bigint bytes FROM nvr_recordings WHERE organization_id=$1`,[org]);
const ev=await runtime.db.query(`SELECT COUNT(*) FILTER(WHERE occurred_at>=CURRENT_TIMESTAMP-INTERVAL '24 hours')::int "last24h",COUNT(*) FILTER(WHERE acknowledged_at IS NULL AND severity='critical')::int critical,COUNT(*) FILTER(WHERE acknowledged_at IS NULL AND severity='warning')::int warning FROM nvr_events WHERE organization_id=$1`,[org]);
const live=await runtime.db.query(`SELECT COUNT(*) FILTER(WHERE status='active' AND expires_at>CURRENT_TIMESTAMP)::int active,COUNT(*) FILTER(WHERE status='requested' AND expires_at>CURRENT_TIMESTAMP)::int requested FROM nvr_stream_sessions WHERE organization_id=$1`,[org]);
return c.json({data:{cameras:cams.rows[0],recordings:recs.rows[0],events:ev.rows[0],liveSessions:live.rows[0]}});});return r;}

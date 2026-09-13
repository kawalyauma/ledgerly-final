import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { AppError } from '../../http/errors.js';
import { requireScope } from '../core-identity/security.js';

const policySchema=z.object({enabled:z.boolean().default(true),recordingDays:z.number().int().min(0).max(3650).default(14)});
export function createNvrRetentionRoutes(runtime:Runtime){const r=new Hono<AppEnv>();r.use('*',requireScope('school:read'));
 r.get('/retention/policy',async c=>{const org=c.get('principal').organizationId,q=await runtime.db.query(`SELECT enabled,recording_days AS "recordingDays",updated_at AS "updatedAt" FROM nvr_retention_policies WHERE organization_id=$1`,[org]);return c.json({data:q.rows[0]??{enabled:true,recordingDays:14}});});
 r.put('/retention/policy',requireScope('school:write'),async c=>{const p=c.get('principal'),s=policySchema.safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,'VALIDATION_ERROR','Invalid NVR retention policy',s.error.flatten());await runtime.db.query(`INSERT INTO nvr_retention_policies(organization_id,enabled,recording_days,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id) DO UPDATE SET enabled=EXCLUDED.enabled,recording_days=EXCLUDED.recording_days,updated_by=EXCLUDED.updated_by,updated_at=CURRENT_TIMESTAMP`,[p.organizationId,s.data.enabled,s.data.recordingDays,p.userId]);return c.json({data:s.data});});
 r.get('/recordings/:id/chunks',async c=>{const p=c.get('principal'),q=await runtime.db.query(`SELECT chunk_index AS "chunkIndex",mime_type AS "mimeType",size_bytes AS "sizeBytes",checksum_sha256 AS "checksumSha256",created_at AS "createdAt" FROM nvr_recording_chunks WHERE organization_id=$1 AND recording_id=$2 ORDER BY chunk_index`,[p.organizationId,c.req.param('id')]);return c.json({data:q.rows});});
 return r;}

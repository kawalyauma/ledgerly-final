import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { createId, requireScope } from '../core-identity/security.js';

const holdSchema=z.object({reason:z.string().min(2).max(1000)});
const MAX_DOWNLOAD_BYTES=128*1024*1024;

async function recording(runtime:Runtime,org:string,id:string){
  const q=await runtime.db.query(`SELECT r.id,r.camera_id AS "cameraId",c.name AS "cameraName",r.object_key AS "objectKey",r.mime_type AS "mimeType",r.size_bytes AS "sizeBytes",r.started_at AS "startedAt",r.ended_at AS "endedAt",r.duration_seconds AS "durationSeconds",r.status,r.upload_state AS "uploadState",r.chunk_count AS "chunkCount",r.checksum_sha256 AS "checksumSha256",r.retention_until AS "retentionUntil" FROM nvr_recordings r JOIN nvr_cameras c ON c.id=r.camera_id AND c.organization_id=r.organization_id WHERE r.id=$1 AND r.organization_id=$2`,[id,org]);
  if(!q.rowCount)throw new AppError(404,'RECORDING_NOT_FOUND','Recording not found');
  return q.rows[0] as any;
}

export function createNvrPlaybackRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();
  r.use('*',requireScope('school:read'));
  r.get('/recordings/:id/playback',async c=>{
    const p=c.get('principal'),rec=await recording(runtime,p.organizationId,c.req.param('id'));
    if(rec.status!=='ready')throw new AppError(409,'RECORDING_NOT_READY','Recording is not ready for playback');
    const chunks=await runtime.db.query(`SELECT chunk_index AS "chunkIndex",mime_type AS "mimeType",size_bytes AS "sizeBytes",checksum_sha256 AS "checksumSha256" FROM nvr_recording_chunks WHERE organization_id=$1 AND recording_id=$2 ORDER BY chunk_index`,[p.organizationId,rec.id]);
    const hold=await runtime.db.query(`SELECT id,reason,held_at AS "heldAt",held_by AS "heldBy" FROM nvr_recording_holds WHERE organization_id=$1 AND recording_id=$2 AND released_at IS NULL LIMIT 1`,[p.organizationId,rec.id]);
    return c.json({data:{...rec,legalHold:hold.rows[0]??null,chunks:(chunks.rows as any[]).map(x=>({...x,url:`/api/v1/nvr/recordings/${rec.id}/chunks/${x.chunkIndex}/content`}))}});
  });
  r.get('/recordings/:id/chunks/:index/content',async c=>{
    const p=c.get('principal'),idx=Number(c.req.param('index'));if(!Number.isInteger(idx)||idx<0)throw new AppError(422,'INVALID_CHUNK_INDEX','Chunk index must be a non-negative integer');
    const q=await runtime.db.query(`SELECT ch.object_key,ch.mime_type,ch.checksum_sha256,r.status FROM nvr_recording_chunks ch JOIN nvr_recordings r ON r.id=ch.recording_id AND r.organization_id=ch.organization_id WHERE ch.organization_id=$1 AND ch.recording_id=$2 AND ch.chunk_index=$3`,[p.organizationId,c.req.param('id'),idx]);
    if(!q.rowCount)throw new AppError(404,'RECORDING_CHUNK_NOT_FOUND','Recording chunk not found');const x=q.rows[0] as any;if(x.status!=='ready')throw new AppError(409,'RECORDING_NOT_READY','Recording is not ready');const bytes=await runtime.storage.get(x.object_key);if(!bytes)throw new AppError(404,'RECORDING_OBJECT_MISSING','Recording object is missing');c.header('Content-Type',x.mime_type||'application/octet-stream');c.header('X-Checksum-SHA256',x.checksum_sha256||'');c.header('Cache-Control','private, max-age=60');return c.body(bytes);
  });
  r.get('/recordings/:id/download',async c=>{
    const p=c.get('principal'),rec=await recording(runtime,p.organizationId,c.req.param('id'));if(rec.status!=='ready')throw new AppError(409,'RECORDING_NOT_READY','Recording is not ready');if(Number(rec.sizeBytes||0)>MAX_DOWNLOAD_BYTES)throw new AppError(422,'RECORDING_TOO_LARGE','Recording is too large for assembled API download; use playback chunks');
    const parts:Uint8Array[]=[];
    if(rec.uploadState==='chunked'){
      const q=await runtime.db.query(`SELECT object_key FROM nvr_recording_chunks WHERE organization_id=$1 AND recording_id=$2 ORDER BY chunk_index`,[p.organizationId,rec.id]);for(const row of q.rows as any[]){const b=await runtime.storage.get(row.object_key);if(!b)throw new AppError(404,'RECORDING_OBJECT_MISSING','A recording chunk is missing');parts.push(b);}
    }else{const b=await runtime.storage.get(rec.objectKey);if(!b)throw new AppError(404,'RECORDING_OBJECT_MISSING','Recording object is missing');parts.push(b);}
    const total=parts.reduce((n,b)=>n+b.byteLength,0),out=new Uint8Array(total);let off=0;for(const b of parts){out.set(b,off);off+=b.byteLength;}await runtime.db.query(`INSERT INTO nvr_recording_exports(id,organization_id,recording_id,requested_by,export_type,details) VALUES($1,$2,$3,$4,'download',$5::jsonb)`,[createId('nvrExp'),p.organizationId,rec.id,p.userId,JSON.stringify({sizeBytes:total})]);c.header('Content-Type',rec.mimeType||'application/octet-stream');c.header('Content-Disposition',`attachment; filename="${rec.id}.bin"`);return c.body(out);
  });
  r.post('/recordings/:id/legal-holds',requireScope('school:write'),async c=>{const p=c.get('principal'),s=holdSchema.safeParse(await c.req.json().catch(()=>null));if(!s.success)throw new AppError(422,'VALIDATION_ERROR','Invalid legal hold',s.error.flatten());await recording(runtime,p.organizationId,c.req.param('id'));const id=createId('nvrHold');const q=await runtime.db.query(`INSERT INTO nvr_recording_holds(id,organization_id,recording_id,reason,held_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id,recording_id) WHERE released_at IS NULL DO UPDATE SET reason=EXCLUDED.reason,held_by=EXCLUDED.held_by,held_at=CURRENT_TIMESTAMP RETURNING id,reason,held_at AS "heldAt"`,[id,p.organizationId,c.req.param('id'),s.data.reason,p.userId]);return c.json({data:q.rows[0]},201);});
  r.post('/recordings/:id/legal-holds/release',requireScope('school:write'),async c=>{const p=c.get('principal'),q=await runtime.db.query(`UPDATE nvr_recording_holds SET released_by=$1,released_at=CURRENT_TIMESTAMP WHERE organization_id=$2 AND recording_id=$3 AND released_at IS NULL RETURNING id,released_at AS "releasedAt"`,[p.userId,p.organizationId,c.req.param('id')]);if(!q.rowCount)throw new AppError(404,'LEGAL_HOLD_NOT_FOUND','Active legal hold not found');return c.json({data:q.rows[0]});});
  r.get('/recordings/:id/export',async c=>{const p=c.get('principal'),rec=await recording(runtime,p.organizationId,c.req.param('id')),chunks=await runtime.db.query(`SELECT chunk_index AS "chunkIndex",size_bytes AS "sizeBytes",checksum_sha256 AS "checksumSha256",mime_type AS "mimeType" FROM nvr_recording_chunks WHERE organization_id=$1 AND recording_id=$2 ORDER BY chunk_index`,[p.organizationId,rec.id]),id=createId('nvrExp');await runtime.db.query(`INSERT INTO nvr_recording_exports(id,organization_id,recording_id,requested_by,export_type,details) VALUES($1,$2,$3,$4,'manifest',$5::jsonb)`,[id,p.organizationId,rec.id,p.userId,JSON.stringify({chunkCount:chunks.rowCount??0})]);return c.json({data:{exportId:id,recording:rec,chunks:chunks.rows,exportedAt:new Date().toISOString()}});});
  return r;
}

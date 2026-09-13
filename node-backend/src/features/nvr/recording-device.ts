import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../../http/errors.js';
import type { AppEnv } from '../../http/types.js';
import type { Runtime } from '../../runtime.js';
import { authenticateNvrCamera, nvrBearer } from './device.js';
import { completeRecording, startRecording, storeRecordingChunk } from './recording-service.js';

const startSchema=z.object({mimeType:z.string().min(1).max(120).default('video/mp4'),startedAt:z.string().datetime().optional()});
const completeSchema=z.object({expectedChunks:z.number().int().min(1).max(100000),durationSeconds:z.number().int().min(0).max(86400),endedAt:z.string().datetime().optional()});

export function createNvrRecordingDeviceRoutes(runtime:Runtime){
  const r=new Hono<AppEnv>();
  r.post('/device/recordings',async c=>{
    const cam=await authenticateNvrCamera(runtime,nvrBearer(c));
    const s=startSchema.safeParse(await c.req.json().catch(()=>({})));
    if(!s.success)throw new AppError(422,'VALIDATION_ERROR','Invalid recording start request',s.error.flatten());
    const data=await startRecording(runtime,cam,s.data.mimeType,s.data.startedAt??new Date().toISOString());
    await runtime.db.query(`UPDATE nvr_cameras SET status='recording',last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`,[cam.id,cam.organization_id]);
    return c.json({data},201);
  });
  r.put('/device/recordings/:id/chunks/:index',async c=>{
    const cam=await authenticateNvrCamera(runtime,nvrBearer(c));
    const index=Number(c.req.param('index'));
    if(!Number.isInteger(index)||index<0||index>99999)throw new AppError(422,'INVALID_CHUNK_INDEX','Chunk index must be a non-negative integer');
    const bytes=new Uint8Array(await c.req.arrayBuffer());
    if(!bytes.byteLength||bytes.byteLength>10*1024*1024)throw new AppError(422,'INVALID_CHUNK_SIZE','Chunk must contain between 1 byte and 10 MB');
    const data=await storeRecordingChunk(runtime,cam,c.req.param('id'),index,bytes,c.req.header('Content-Type')||undefined);
    return c.json({data});
  });
  r.post('/device/recordings/:id/complete',async c=>{
    const cam=await authenticateNvrCamera(runtime,nvrBearer(c));
    const s=completeSchema.safeParse(await c.req.json().catch(()=>null));
    if(!s.success)throw new AppError(422,'VALIDATION_ERROR','Invalid recording completion request',s.error.flatten());
    const data=await completeRecording(runtime,cam,c.req.param('id'),s.data.expectedChunks,s.data.durationSeconds,s.data.endedAt??new Date().toISOString());
    await runtime.db.query(`UPDATE nvr_cameras SET status='online',last_seen_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`,[cam.id,cam.organization_id]);
    return c.json({data});
  });
  return r;
}

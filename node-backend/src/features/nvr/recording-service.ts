import { createHash } from 'node:crypto';
import type { Runtime } from '../../runtime.js';
import { AppError } from '../../http/errors.js';
import { createId } from '../core-identity/security.js';

export async function startRecording(runtime:Runtime,cam:{id:string;organization_id:string},mimeType:string,startedAt:string){
  const policy=await runtime.db.query(`SELECT recording_days FROM nvr_retention_policies WHERE organization_id=$1`,[cam.organization_id]);
  const days=Number((policy.rows[0] as any)?.recording_days??14),id=createId('nvrRec'),retention=new Date(Date.now()+days*86400000).toISOString(),prefix=`nvr/${cam.organization_id}/${cam.id}/${id}`;
  await runtime.db.query(`INSERT INTO nvr_recordings(id,organization_id,camera_id,object_key,mime_type,started_at,status,retention_until,upload_state) VALUES($1,$2,$3,$4,$5,$6,'recording',$7,'chunked')`,[id,cam.organization_id,cam.id,prefix,mimeType,startedAt,retention]);
  return {recordingId:id,retentionUntil:retention,maxChunkBytes:10485760};
}

export async function storeRecordingChunk(runtime:Runtime,cam:{id:string;organization_id:string},recordingId:string,index:number,bytes:Uint8Array,mimeType?:string){
  const rec=await runtime.db.query(`SELECT object_key,mime_type,status FROM nvr_recordings WHERE id=$1 AND organization_id=$2 AND camera_id=$3`,[recordingId,cam.organization_id,cam.id]);
  if(!rec.rowCount)throw new AppError(404,'RECORDING_NOT_FOUND','Recording not found');
  if(String((rec.rows[0] as any).status)!=='recording')throw new AppError(409,'RECORDING_CLOSED','Recording upload is already closed');
  const key=`${(rec.rows[0] as any).object_key}/chunks/${String(index).padStart(6,'0')}`,mime=mimeType||String((rec.rows[0] as any).mime_type),checksum=createHash('sha256').update(bytes).digest('hex');
  await runtime.storage.put(key,bytes,mime);
  try{await runtime.db.query(`INSERT INTO nvr_recording_chunks(id,organization_id,recording_id,chunk_index,object_key,mime_type,size_bytes,checksum_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[createId('nvrChunk'),cam.organization_id,recordingId,index,key,mime,bytes.byteLength,checksum]);}
  catch(e:any){await runtime.storage.delete(key).catch(()=>{});if(e?.code==='23505')throw new AppError(409,'CHUNK_EXISTS','Recording chunk already exists');throw e;}
  return {recordingId,chunkIndex:index,sizeBytes:bytes.byteLength,checksumSha256:checksum};
}

export async function completeRecording(runtime:Runtime,cam:{id:string;organization_id:string},recordingId:string,expectedChunks:number,durationSeconds:number,endedAt:string){
  const client=await runtime.db.connect();
  try{await client.query('BEGIN');const rec=await client.query(`SELECT status FROM nvr_recordings WHERE id=$1 AND organization_id=$2 AND camera_id=$3 FOR UPDATE`,[recordingId,cam.organization_id,cam.id]);if(!rec.rowCount)throw new AppError(404,'RECORDING_NOT_FOUND','Recording not found');if(String((rec.rows[0] as any).status)!=='recording')throw new AppError(409,'RECORDING_CLOSED','Recording upload is already closed');const chunks=await client.query(`SELECT chunk_index,size_bytes FROM nvr_recording_chunks WHERE organization_id=$1 AND recording_id=$2 ORDER BY chunk_index`,[cam.organization_id,recordingId]);if(chunks.rowCount!==expectedChunks)throw new AppError(409,'RECORDING_INCOMPLETE','Expected recording chunks have not all arrived');for(let i=0;i<expectedChunks;i++)if(Number((chunks.rows[i] as any).chunk_index)!==i)throw new AppError(409,'RECORDING_INCOMPLETE','Recording chunks are not contiguous');const total=(chunks.rows as any[]).reduce((n,x)=>n+Number(x.size_bytes||0),0);await client.query(`UPDATE nvr_recordings SET ended_at=$1,duration_seconds=$2,size_bytes=$3,chunk_count=$4,status='ready' WHERE id=$5 AND organization_id=$6`,[endedAt,durationSeconds,total,expectedChunks,recordingId,cam.organization_id]);await client.query('COMMIT');return {recordingId,status:'ready',chunkCount:expectedChunks,sizeBytes:total};}catch(e){await client.query('ROLLBACK');throw e}finally{client.release();}
}

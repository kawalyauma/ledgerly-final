// @ts-nocheck
import { Hono } from "hono";
import type { AppVariables, Env } from "../../../src/types";
import { requireScope } from "../../../src/lib/auth";
import { AppError } from "../../../src/lib/errors";
import { createId } from "../../../src/lib/ids";

export const fileManagerRoutes = new Hono<{Bindings:Env;Variables:AppVariables}>();
fileManagerRoutes.use("*",requireScope("documents:read"));

const MAX_FILE_BYTES=50*1024*1024;
const safeName=(name:string)=>{const value=String(name||"file").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");return(value||"file").slice(0,180)};
const normalizeFolderName=(name:string)=>String(name||"").trim().replace(/\s+/g," ").toLocaleLowerCase();
const hex=(buffer:ArrayBuffer)=>Array.from(new Uint8Array(buffer)).map(x=>x.toString(16).padStart(2,"0")).join("");
const sourceLabel=(source:string)=>({upload:"Uploaded",ai_generated:"AI generated",school_file:"School file",scannerly:"Scanned",report_export:"Report",system_generated:"System generated",finance_attachment:"Finance attachment",printerly:"Printerly"}[source]||source);

async function folder(db:D1Database,organizationId:string,id:string|null|undefined){
  if(!id)return null;
  const row=await db.prepare("SELECT id,name,parent_id parentId FROM file_folders WHERE id=? AND organization_id=? AND deleted_at IS NULL").bind(id,organizationId).first<any>();
  if(!row)throw new AppError(422,"INVALID_FOLDER","Choose a valid document folder");
  return row;
}
async function item(db:D1Database,organizationId:string,id:string,includeTrashed=true){
  const row=await db.prepare(`SELECT i.*,f.name folder_name FROM file_items i LEFT JOIN file_folders f ON f.id=i.folder_id AND f.organization_id=i.organization_id
    WHERE i.id=? AND i.organization_id=? ${includeTrashed?"":"AND i.status<>'trashed'"} AND i.deleted_at IS NULL`).bind(id,organizationId).first<any>();
  if(!row)throw new AppError(404,"FILE_NOT_FOUND","Document or file not found");
  return row;
}
function bucket(env:Env,name:string){return name==="reports"?env.REPORTS_BUCKET:env.WORK_FILES_BUCKET}
function mapItem(row:any){return{
  id:row.id,folderId:row.folder_id??row.folderId??null,folderName:row.folder_name??row.folderName??null,title:row.title,filename:row.filename,mimeType:row.mime_type??row.mimeType,
  sizeBytes:Number(row.size_bytes??row.sizeBytes??0),checksumSha256:row.checksum_sha256??row.checksumSha256??null,sourceType:row.source_type??row.sourceType,
  sourceLabel:sourceLabel(row.source_type??row.sourceType),sourceModule:row.source_module??row.sourceModule??null,sourceEntityType:row.source_entity_type??row.sourceEntityType??null,
  sourceEntityId:row.source_entity_id??row.sourceEntityId??null,status:row.status,currentVersion:Number(row.current_version??row.currentVersion??1),
  hasPreview:Boolean(row.preview_object_key??row.previewObjectKey),previewMimeType:row.preview_mime_type??row.previewMimeType??null,
  tags:safeJson(row.tags_json??row.tagsJson,[]),metadata:safeJson(row.metadata_json??row.metadataJson,{}),createdBy:row.created_by??row.createdBy??null,
  createdAt:row.created_at??row.createdAt,updatedAt:row.updated_at??row.updatedAt,
  contentUrl:`/api/v1/files/items/${row.id}/content`,previewUrl:(row.preview_object_key??row.previewObjectKey)?`/api/v1/files/items/${row.id}/content?preview=1`:null
}}
function safeJson(value:any,fallback:any){try{return value?JSON.parse(String(value)):fallback}catch{return fallback}}
async function audit(db:D1Database,organizationId:string,userId:string,action:string,itemId:string,details:any={}){
  try{await db.prepare(`INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type,entity_id,after_data) VALUES(?,?,?,?,?,?,?)`).bind(createId("aud"),organizationId,userId,action,"file_item",itemId,JSON.stringify(details)).run()}catch{/* audit schemas vary across runtimes; file state remains authoritative */}
}

fileManagerRoutes.get("/manifest",c=>c.json({data:{key:"file-manager",name:"Documents & Files",version:"1.0.0",features:["folders","uploads","generated-documents","versions","record-links","preview","archive"]}}));

fileManagerRoutes.get("/summary",async c=>{
  const p=c.get("principal"),row=await c.env.FINANCE_DB.prepare(`SELECT
    COUNT(*) totalFiles,
    COALESCE(SUM(CASE WHEN source_type='upload' THEN 1 ELSE 0 END),0) uploadedFiles,
    COALESCE(SUM(CASE WHEN source_type<>'upload' THEN 1 ELSE 0 END),0) generatedFiles,
    COALESCE(SUM(CASE WHEN status='archived' THEN 1 ELSE 0 END),0) archivedFiles,
    COALESCE(SUM(CASE WHEN status='trashed' THEN 1 ELSE 0 END),0) trashedFiles,
    COALESCE(SUM(CASE WHEN status<>'trashed' THEN size_bytes ELSE 0 END),0) storageBytes
    FROM file_items WHERE organization_id=? AND deleted_at IS NULL`).bind(p.organizationId).first<any>();
  return c.json({data:{totalFiles:Number(row?.totalFiles||0),uploadedFiles:Number(row?.uploadedFiles||0),generatedFiles:Number(row?.generatedFiles||0),archivedFiles:Number(row?.archivedFiles||0),trashedFiles:Number(row?.trashedFiles||0),storageBytes:Number(row?.storageBytes||0)}});
});

fileManagerRoutes.get("/folders",async c=>{
  const p=c.get("principal"),rows=await c.env.FINANCE_DB.prepare(`SELECT f.id,f.parent_id parentId,f.name,f.created_at createdAt,f.updated_at updatedAt,
    (SELECT COUNT(*) FROM file_items i WHERE i.organization_id=f.organization_id AND i.folder_id=f.id AND i.status<>'trashed' AND i.deleted_at IS NULL) fileCount
    FROM file_folders f WHERE f.organization_id=? AND f.deleted_at IS NULL ORDER BY f.name COLLATE NOCASE`).bind(p.organizationId).all<any>();
  return c.json({data:(rows.results||[]).map((r:any)=>({...r,fileCount:Number(r.fileCount||0)}))});
});
fileManagerRoutes.post("/folders",requireScope("documents:write"),async c=>{
  const p=c.get("principal"),body=await c.req.json().catch(()=>({})),name=String(body.name||"").trim().replace(/\s+/g," ").slice(0,120),parentId=body.parentId?String(body.parentId):null;
  if(!name)throw new AppError(422,"FOLDER_NAME_REQUIRED","Folder name is required");await folder(c.env.FINANCE_DB,p.organizationId,parentId);
  const id=createId("fld");try{await c.env.FINANCE_DB.prepare("INSERT INTO file_folders(id,organization_id,parent_id,name,name_normalized,created_by,updated_by) VALUES(?,?,?,?,?,?,?)").bind(id,p.organizationId,parentId,name,normalizeFolderName(name),p.userId,p.userId).run()}catch(error){throw new AppError(409,"FOLDER_EXISTS","A folder with this name already exists here")}
  return c.json({data:{id,parentId,name,fileCount:0}},201);
});
fileManagerRoutes.patch("/folders/:id",requireScope("documents:write"),async c=>{
  const p=c.get("principal"),id=c.req.param("id"),current=await folder(c.env.FINANCE_DB,p.organizationId,id),body=await c.req.json().catch(()=>({})),name=body.name===undefined?current.name:String(body.name||"").trim().replace(/\s+/g," ").slice(0,120),parentId=body.parentId===undefined?current.parentId:(body.parentId?String(body.parentId):null);
  if(!name)throw new AppError(422,"FOLDER_NAME_REQUIRED","Folder name is required");if(parentId===id)throw new AppError(422,"INVALID_FOLDER_PARENT","A folder cannot contain itself");await folder(c.env.FINANCE_DB,p.organizationId,parentId);
  let cursor=parentId;while(cursor){if(cursor===id)throw new AppError(422,"INVALID_FOLDER_PARENT","A folder cannot be moved inside one of its descendants");const next=await folder(c.env.FINANCE_DB,p.organizationId,cursor);cursor=next?.parentId||null}
  try{await c.env.FINANCE_DB.prepare("UPDATE file_folders SET parent_id=?,name=?,name_normalized=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(parentId,name,normalizeFolderName(name),p.userId,id,p.organizationId).run()}catch{throw new AppError(409,"FOLDER_EXISTS","A folder with this name already exists here")}
  return c.json({data:{id,parentId,name}});
});
fileManagerRoutes.delete("/folders/:id",requireScope("documents:write"),async c=>{
  const p=c.get("principal"),id=c.req.param("id");await folder(c.env.FINANCE_DB,p.organizationId,id);
  const usage=await c.env.FINANCE_DB.prepare(`SELECT
    EXISTS(SELECT 1 FROM file_folders WHERE organization_id=? AND parent_id=? AND deleted_at IS NULL) hasChildren,
    EXISTS(SELECT 1 FROM file_items WHERE organization_id=? AND folder_id=? AND status<>'trashed' AND deleted_at IS NULL) hasFiles`).bind(p.organizationId,id,p.organizationId,id).first<any>();
  if(usage?.hasChildren||usage?.hasFiles)throw new AppError(409,"FOLDER_NOT_EMPTY","Move or archive the folder's files and subfolders before deleting it");
  await c.env.FINANCE_DB.prepare("UPDATE file_folders SET deleted_at=CURRENT_TIMESTAMP,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(p.userId,id,p.organizationId).run();return c.body(null,204);
});

fileManagerRoutes.get("/items",async c=>{
  const p=c.get("principal"),params:any[]=[p.organizationId],where=["i.organization_id=?","i.deleted_at IS NULL"],q=String(c.req.query("q")||"").trim(),folderId=c.req.query("folderId"),source=c.req.query("source"),status=c.req.query("status")||"active",entityType=c.req.query("entityType"),entityId=c.req.query("entityId");
  if(status!=="all"){where.push("i.status=?");params.push(status)}if(folderId!==undefined){if(folderId){where.push("i.folder_id=?");params.push(folderId)}else where.push("i.folder_id IS NULL")}if(source&&source!=="all"){where.push("i.source_type=?");params.push(source)}
  if(q){where.push("(LOWER(i.title) LIKE ? OR LOWER(i.filename) LIKE ? OR LOWER(COALESCE(i.source_module,'')) LIKE ?)");const like=`%${q.toLowerCase()}%`;params.push(like,like,like)}
  if(entityType&&entityId){where.push("EXISTS(SELECT 1 FROM file_links l WHERE l.organization_id=i.organization_id AND l.file_item_id=i.id AND l.entity_type=? AND l.entity_id=?)");params.push(entityType,entityId)}
  const limit=Math.min(250,Math.max(1,Number(c.req.query("limit")||100))),offset=Math.max(0,Number(c.req.query("offset")||0));params.push(limit,offset);
  const rows=await c.env.FINANCE_DB.prepare(`SELECT i.*,f.name folder_name FROM file_items i LEFT JOIN file_folders f ON f.id=i.folder_id AND f.organization_id=i.organization_id WHERE ${where.join(" AND ")} ORDER BY i.updated_at DESC LIMIT ? OFFSET ?`).bind(...params).all<any>();
  return c.json({data:(rows.results||[]).map(mapItem)});
});
fileManagerRoutes.get("/items/:id",async c=>{
  const p=c.get("principal"),record=await item(c.env.FINANCE_DB,p.organizationId,c.req.param("id")),[versions,links]=await Promise.all([
    c.env.FINANCE_DB.prepare(`SELECT id,version_number versionNumber,filename,mime_type mimeType,size_bytes sizeBytes,checksum_sha256 checksumSha256,created_by createdBy,created_at createdAt FROM file_versions WHERE organization_id=? AND file_item_id=? ORDER BY version_number DESC`).bind(p.organizationId,record.id).all<any>(),
    c.env.FINANCE_DB.prepare(`SELECT id,module_key moduleKey,entity_type entityType,entity_id entityId,label,created_by createdBy,created_at createdAt FROM file_links WHERE organization_id=? AND file_item_id=? ORDER BY created_at DESC`).bind(p.organizationId,record.id).all<any>()
  ]);return c.json({data:{...mapItem(record),versions:versions.results||[],links:links.results||[]}})
});

fileManagerRoutes.post("/upload",requireScope("documents:write"),async c=>{
  const p=c.get("principal"),form=await c.req.formData(),part=form.get("file") as File|null;if(!(part instanceof File))throw new AppError(422,"FILE_REQUIRED","Choose a file to upload");
  if(part.size<=0)throw new AppError(422,"EMPTY_FILE","The selected file is empty");if(part.size>MAX_FILE_BYTES)throw new AppError(413,"FILE_TOO_LARGE","Document library uploads are limited to 50 MB per file");
  const folderId=form.get("folderId")?String(form.get("folderId")):null;await folder(c.env.FINANCE_DB,p.organizationId,folderId);const id=createId("fil"),versionId=createId("fver"),now=new Date(),mime=String(part.type||"application/octet-stream").toLowerCase(),filename=part.name||"file",title=String(form.get("title")||filename.replace(/\.[^.]+$/,"")) .trim().slice(0,240)||filename;
  const bytes=await part.arrayBuffer(),checksum=hex(await crypto.subtle.digest("SHA-256",bytes)),objectKey=`files/${p.organizationId}/${now.getUTCFullYear()}/${String(now.getUTCMonth()+1).padStart(2,"0")}/${id}/v1/${safeName(filename)}`;
  await c.env.WORK_FILES_BUCKET.put(objectKey,bytes,{httpMetadata:{contentType:mime,contentDisposition:`inline; filename="${safeName(filename)}"`},customMetadata:{organizationId:p.organizationId,fileId:id,version:"1",checksum}});
  try{await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare(`INSERT INTO file_items(id,organization_id,folder_id,title,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,source_type,source_module,source_entity_type,source_entity_id,status,current_version,created_by,updated_by) VALUES(?,?,?,?,?,?,?,?,'work',?,'upload','file-manager','file_item',?,'active',1,?,?)`).bind(id,p.organizationId,folderId,title,filename,mime,part.size,checksum,objectKey,id,p.userId,p.userId),
    c.env.FINANCE_DB.prepare(`INSERT INTO file_versions(id,organization_id,file_item_id,version_number,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,created_by) VALUES(?,?,?,?,?,?,?,?,'work',?,?)`).bind(versionId,p.organizationId,id,1,filename,mime,part.size,checksum,objectKey,p.userId)
  ])}catch(error){await c.env.WORK_FILES_BUCKET.delete(objectKey);throw error}
  await audit(c.env.FINANCE_DB,p.organizationId,p.userId,"file.uploaded",id,{filename,mime,sizeBytes:part.size,folderId});return c.json({data:mapItem({id,folder_id:folderId,title,filename,mime_type:mime,size_bytes:part.size,checksum_sha256:checksum,source_type:"upload",source_module:"file-manager",source_entity_type:"file_item",source_entity_id:id,status:"active",current_version:1,created_by:p.userId,created_at:now.toISOString(),updated_at:now.toISOString()})},201);
});

fileManagerRoutes.post("/items/:id/versions",requireScope("documents:write"),async c=>{
  const p=c.get("principal"),current=await item(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),false);if(current.source_type!=="upload")throw new AppError(409,"VERSION_NOT_ALLOWED","New versions can only be uploaded for files owned by the document library");
  const form=await c.req.formData(),part=form.get("file") as File|null;if(!(part instanceof File))throw new AppError(422,"FILE_REQUIRED","Choose the replacement file");if(part.size<=0||part.size>MAX_FILE_BYTES)throw new AppError(413,"FILE_TOO_LARGE","Replacement files must be between 1 byte and 50 MB");
  const next=Number(current.current_version||1)+1,mime=String(part.type||"application/octet-stream").toLowerCase(),bytes=await part.arrayBuffer(),checksum=hex(await crypto.subtle.digest("SHA-256",bytes)),key=`files/${p.organizationId}/${current.id}/v${next}/${safeName(part.name)}`,versionId=createId("fver");
  await c.env.WORK_FILES_BUCKET.put(key,bytes,{httpMetadata:{contentType:mime,contentDisposition:`inline; filename="${safeName(part.name)}"`},customMetadata:{organizationId:p.organizationId,fileId:current.id,version:String(next),checksum}});
  try{await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare(`INSERT INTO file_versions(id,organization_id,file_item_id,version_number,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,created_by) VALUES(?,?,?,?,?,?,?,?,'work',?,?)`).bind(versionId,p.organizationId,current.id,next,part.name,mime,part.size,checksum,key,p.userId),
    c.env.FINANCE_DB.prepare(`UPDATE file_items SET filename=?,mime_type=?,size_bytes=?,checksum_sha256=?,storage_bucket='work',object_key=?,preview_object_key=NULL,preview_mime_type=NULL,preview_size_bytes=NULL,current_version=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?`).bind(part.name,mime,part.size,checksum,key,next,p.userId,current.id,p.organizationId)
  ])}catch(error){await c.env.WORK_FILES_BUCKET.delete(key);throw error}
  await audit(c.env.FINANCE_DB,p.organizationId,p.userId,"file.version.created",current.id,{version:next,filename:part.name});return c.json({data:{id:current.id,currentVersion:next,filename:part.name,mimeType:mime,sizeBytes:part.size,checksumSha256:checksum}},201);
});

fileManagerRoutes.patch("/items/:id",requireScope("documents:write"),async c=>{
  const p=c.get("principal"),current=await item(c.env.FINANCE_DB,p.organizationId,c.req.param("id")),body=await c.req.json().catch(()=>({})),title=body.title===undefined?current.title:String(body.title||"").trim().slice(0,240),folderId=body.folderId===undefined?current.folder_id:(body.folderId?String(body.folderId):null),status=body.status===undefined?current.status:String(body.status),tags=body.tags===undefined?safeJson(current.tags_json,[]):Array.isArray(body.tags)?body.tags.map((x:any)=>String(x).trim()).filter(Boolean).slice(0,30):[];
  if(!title)throw new AppError(422,"TITLE_REQUIRED","Document title is required");if(!["active","archived","trashed"].includes(status))throw new AppError(422,"INVALID_STATUS","Invalid document status");await folder(c.env.FINANCE_DB,p.organizationId,folderId);
  await c.env.FINANCE_DB.prepare("UPDATE file_items SET title=?,folder_id=?,status=?,tags_json=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(title,folderId,status,JSON.stringify(tags),p.userId,current.id,p.organizationId).run();await audit(c.env.FINANCE_DB,p.organizationId,p.userId,"file.updated",current.id,{title,folderId,status,tags});return c.json({data:{id:current.id,title,folderId,status,tags}});
});
fileManagerRoutes.delete("/items/:id",requireScope("documents:write"),async c=>{
  const p=c.get("principal"),current=await item(c.env.FINANCE_DB,p.organizationId,c.req.param("id"));await c.env.FINANCE_DB.prepare("UPDATE file_items SET status='trashed',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(p.userId,current.id,p.organizationId).run();await audit(c.env.FINANCE_DB,p.organizationId,p.userId,"file.trashed",current.id);return c.body(null,204);
});
fileManagerRoutes.post("/items/:id/restore",requireScope("documents:write"),async c=>{const p=c.get("principal"),current=await item(c.env.FINANCE_DB,p.organizationId,c.req.param("id"));await c.env.FINANCE_DB.prepare("UPDATE file_items SET status='active',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(p.userId,current.id,p.organizationId).run();await audit(c.env.FINANCE_DB,p.organizationId,p.userId,"file.restored",current.id);return c.json({data:{id:current.id,status:"active"}})});

fileManagerRoutes.post("/items/:id/links",requireScope("documents:write"),async c=>{
  const p=c.get("principal"),current=await item(c.env.FINANCE_DB,p.organizationId,c.req.param("id"),false),body=await c.req.json().catch(()=>({})),entityType=String(body.entityType||"").trim().slice(0,80),entityId=String(body.entityId||"").trim(),moduleKey=body.moduleKey?String(body.moduleKey).slice(0,80):null,label=body.label?String(body.label).slice(0,160):null;if(!entityType||!entityId)throw new AppError(422,"LINK_TARGET_REQUIRED","Entity type and ID are required");const id=createId("flnk");
  await c.env.FINANCE_DB.prepare("INSERT OR IGNORE INTO file_links(id,organization_id,file_item_id,module_key,entity_type,entity_id,label,created_by) VALUES(?,?,?,?,?,?,?,?)").bind(id,p.organizationId,current.id,moduleKey,entityType,entityId,label,p.userId).run();return c.json({data:{id,fileItemId:current.id,moduleKey,entityType,entityId,label}},201);
});
fileManagerRoutes.delete("/items/:id/links/:linkId",requireScope("documents:write"),async c=>{const p=c.get("principal");await item(c.env.FINANCE_DB,p.organizationId,c.req.param("id"));await c.env.FINANCE_DB.prepare("DELETE FROM file_links WHERE id=? AND file_item_id=? AND organization_id=?").bind(c.req.param("linkId"),c.req.param("id"),p.organizationId).run();return c.body(null,204)});

fileManagerRoutes.get("/items/:id/content",async c=>{
  const p=c.get("principal"),record=await item(c.env.FINANCE_DB,p.organizationId,c.req.param("id")),preview=c.req.query("preview")==="1",objectKey=preview&&record.preview_object_key?record.preview_object_key:record.object_key,mime=preview&&record.preview_object_key?(record.preview_mime_type||"application/pdf"):record.mime_type;
  if(!objectKey)throw new AppError(404,"FILE_OBJECT_MISSING","This catalog entry does not have a stored file object");const obj=await bucket(c.env,record.storage_bucket).get(objectKey);if(!obj)throw new AppError(404,"FILE_OBJECT_MISSING","The stored file object is unavailable");const download=c.req.query("download")==="1",filename=preview&&record.preview_object_key?`${record.title}.pdf`:record.filename;
  c.header("Content-Type",mime||"application/octet-stream");c.header("Content-Disposition",`${download?"attachment":"inline"}; filename="${safeName(filename)}"`);if(obj.size)c.header("Content-Length",String(obj.size));if(obj.httpEtag)c.header("ETag",obj.httpEtag);return c.body(obj.body);
});
fileManagerRoutes.get("/items/:id/versions/:version/content",async c=>{
  const p=c.get("principal"),fileId=c.req.param("id"),version=Number(c.req.param("version"));await item(c.env.FINANCE_DB,p.organizationId,fileId);const row=await c.env.FINANCE_DB.prepare("SELECT * FROM file_versions WHERE organization_id=? AND file_item_id=? AND version_number=?").bind(p.organizationId,fileId,version).first<any>();if(!row)throw new AppError(404,"VERSION_NOT_FOUND","File version not found");const obj=await bucket(c.env,row.storage_bucket).get(row.object_key);if(!obj)throw new AppError(404,"FILE_OBJECT_MISSING","The stored file version is unavailable");c.header("Content-Type",row.mime_type);c.header("Content-Disposition",`attachment; filename="${safeName(row.filename)}"`);return c.body(obj.body);
});

async function syncAi(db:D1Database,org:string){
  try{const rows=await db.prepare("SELECT * FROM ae_generated_documents WHERE organization_id=? AND status<>'deleted'").bind(org).all<any>();let count=0;for(const d of rows.results||[]){const id=`fil_ai_${d.id}`,filename=`${safeName(d.title)}.${d.format}`,status=d.status==="archived"?"archived":"active";const r=await db.prepare(`INSERT OR IGNORE INTO file_items(id,organization_id,title,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,preview_object_key,preview_mime_type,preview_size_bytes,source_type,source_module,source_entity_type,source_entity_id,status,current_version,metadata_json,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'work',?,?,'application/pdf',?,'ai_generated','agentic-employees','generated_document',?,?,1,?,?,?,?)`).bind(id,org,d.title,filename,d.source_mime_type,d.source_size_bytes,d.checksum_sha256,d.source_object_key,d.pdf_object_key,d.pdf_size_bytes,d.id,status,JSON.stringify({agentKey:d.agent_key,conversationId:d.conversation_id,actionId:d.action_id,pdfPageCount:d.pdf_page_count,format:d.format}),d.created_by,d.created_at,d.updated_at).run();if(r.meta?.changes){count++;await db.prepare(`INSERT OR IGNORE INTO file_versions(id,organization_id,file_item_id,version_number,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,preview_object_key,preview_mime_type,preview_size_bytes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,'work',?,?,'application/pdf',?,?,?)`).bind(`fver_ai_${d.id}`,org,id,1,filename,d.source_mime_type,d.source_size_bytes,d.checksum_sha256,d.source_object_key,d.pdf_object_key,d.pdf_size_bytes,d.created_by,d.created_at).run()}}
    return count}catch{return 0}
}
async function syncSchool(db:D1Database,org:string){
  try{const rows=await db.prepare("SELECT * FROM school_files WHERE organization_id=? AND deleted_at IS NULL").bind(org).all<any>();let count=0;for(const d of rows.results||[]){const id=`fil_school_${d.id}`,r=await db.prepare(`INSERT OR IGNORE INTO file_items(id,organization_id,title,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,source_type,source_module,source_entity_type,source_entity_id,status,current_version,metadata_json,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'reports',?,'school_file','school-management','school_file',?,'active',1,?,?,?,?)`).bind(id,org,String(d.original_name||"School file").replace(/\.[^.]+$/,""),d.original_name,d.mime_type,d.size_bytes,d.checksum_sha256,d.object_key,d.id,JSON.stringify({purpose:d.purpose}),d.uploaded_by,d.created_at,d.updated_at).run();if(r.meta?.changes){count++;await db.prepare(`INSERT OR IGNORE INTO file_versions(id,organization_id,file_item_id,version_number,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,'reports',?,?,?)`).bind(`fver_school_${d.id}`,org,id,1,d.original_name,d.mime_type,d.size_bytes,d.checksum_sha256,d.object_key,d.uploaded_by,d.created_at).run()}}
    return count}catch{return 0}
}
async function syncScanner(db:D1Database,org:string){
  try{const rows=await db.prepare(`SELECT d.*,j.title,j.scan_number,j.target_type,j.target_module,j.target_id,j.created_by FROM prn_scan_documents d JOIN prn_scan_jobs j ON j.id=d.scan_job_id AND j.organization_id=d.organization_id WHERE d.organization_id=?`).bind(org).all<any>();let count=0;for(const d of rows.results||[]){const id=`fil_scan_${d.id}`,r=await db.prepare(`INSERT OR IGNORE INTO file_items(id,organization_id,title,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,source_type,source_module,source_entity_type,source_entity_id,status,current_version,metadata_json,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'work',?,'scannerly','printerly','scan_document',?,'active',1,?,?,?,?)`).bind(id,org,d.title||d.original_name,d.original_name,d.mime_type,d.size_bytes,d.checksum_sha256,d.object_key,d.id,JSON.stringify({scanJobId:d.scan_job_id,scanNumber:d.scan_number,targetType:d.target_type,targetModule:d.target_module,targetId:d.target_id}),d.created_by,d.created_at,d.created_at).run();if(r.meta?.changes){count++;await db.prepare(`INSERT OR IGNORE INTO file_versions(id,organization_id,file_item_id,version_number,filename,mime_type,size_bytes,checksum_sha256,storage_bucket,object_key,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,'work',?,?,?)`).bind(`fver_scan_${d.id}`,org,id,1,d.original_name,d.mime_type,d.size_bytes,d.checksum_sha256,d.object_key,d.created_by,d.created_at).run()}}
    return count}catch{return 0}
}
fileManagerRoutes.post("/sync-system",requireScope("documents:write"),async c=>{const p=c.get("principal"),[ai,school,scanner]=await Promise.all([syncAi(c.env.FINANCE_DB,p.organizationId),syncSchool(c.env.FINANCE_DB,p.organizationId),syncScanner(c.env.FINANCE_DB,p.organizationId)]);return c.json({data:{imported:ai+school+scanner,aiGenerated:ai,schoolFiles:school,scannerFiles:scanner}})});

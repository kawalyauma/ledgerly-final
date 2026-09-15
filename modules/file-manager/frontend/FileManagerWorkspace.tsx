import { useEffect,useMemo,useRef,useState } from "react";
import {
  Archive,ArchiveRestore,BrainCircuit,Download,File,FileImage,FileSpreadsheet,FileText,Folder,
  FolderInput,FolderPlus,History,Image,LoaderCircle,MoreHorizontal,Paperclip,RefreshCw,ScanLine,
  Search,Tags,Trash2,Upload,UploadCloud,X
} from "lucide-react";
import { ApiError,authStore,can,del,downloadFile,errorText,get,patch,post,uploadFile } from "../../../web/api";

type Summary={totalFiles:number;uploadedFiles:number;generatedFiles:number;archivedFiles:number;trashedFiles:number;storageBytes:number};
type FolderRow={id:string;parentId:string|null;name:string;fileCount:number;createdAt?:string;updatedAt?:string};
type FileItem={
  id:string;folderId:string|null;folderName:string|null;title:string;filename:string;mimeType:string;sizeBytes:number;checksumSha256:string|null;
  sourceType:string;sourceLabel:string;sourceModule:string|null;sourceEntityType:string|null;sourceEntityId:string|null;status:"active"|"archived"|"trashed";
  currentVersion:number;hasPreview:boolean;previewMimeType:string|null;tags:string[];metadata:Record<string,unknown>;createdBy:string|null;createdAt:string;updatedAt:string;
  contentUrl:string;previewUrl:string|null;
};
type FileVersion={id:string;versionNumber:number;filename:string;mimeType:string;sizeBytes:number;checksumSha256:string|null;createdBy:string|null;createdAt:string};
type FileLink={id:string;moduleKey:string|null;entityType:string;entityId:string;label:string|null;createdBy:string|null;createdAt:string};
type FileDetails=FileItem&{versions:FileVersion[];links:FileLink[]};

const sourceFilters=[
  {key:"all",label:"All documents",icon:File},
  {key:"upload",label:"Uploaded",icon:UploadCloud},
  {key:"ai_generated",label:"AI generated",icon:BrainCircuit},
  {key:"scannerly",label:"Scanned",icon:ScanLine},
  {key:"school_file",label:"School files",icon:FolderInput},
  {key:"system_generated",label:"System generated",icon:RefreshCw},
];
function sizeText(bytes:number){if(bytes<1024)return`${bytes} B`;if(bytes<1024*1024)return`${(bytes/1024).toFixed(bytes<10240?1:0)} KB`;if(bytes<1024*1024*1024)return`${(bytes/1024/1024).toFixed(1)} MB`;return`${(bytes/1024/1024/1024).toFixed(2)} GB`}
function dateText(value?:string){if(!value)return"—";const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString(undefined,{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"})}
function fileIcon(item:Pick<FileItem,"mimeType"|"filename">){const mime=item.mimeType||"",name=item.filename.toLowerCase();if(mime.startsWith("image/"))return FileImage;if(mime.includes("spreadsheet")||mime.includes("excel")||name.endsWith(".xlsx")||name.endsWith(".xls")||name.endsWith(".csv"))return FileSpreadsheet;if(mime.includes("pdf")||mime.includes("word")||name.endsWith(".docx")||name.endsWith(".doc")||mime.startsWith("text/"))return FileText;return File}
function classNames(...values:Array<string|false|null|undefined>){return values.filter(Boolean).join(" ")}

async function authorizedBlob(path:string){
  const response=await fetch(`/api/v1${path}`,{headers:{Authorization:`Bearer ${authStore.getAccess()||""}`}});
  if(!response.ok){const payload=await response.clone().json().catch(()=>({})) as any;throw new ApiError(response.status,payload.error?.code||"PREVIEW_FAILED",payload.error?.message||"Unable to preview this document",payload.error?.details)}
  return response.blob();
}

export function FileManagerWorkspace(){
  const principal=authStore.principal(),write=can(principal,"documents:write");
  const [summary,setSummary]=useState<Summary>({totalFiles:0,uploadedFiles:0,generatedFiles:0,archivedFiles:0,trashedFiles:0,storageBytes:0});
  const [folders,setFolders]=useState<FolderRow[]>([]),[items,setItems]=useState<FileItem[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [query,setQuery]=useState(""),[source,setSource]=useState("all"),[status,setStatus]=useState<"active"|"archived"|"trashed">("active"),[folderId,setFolderId]=useState<string|null>(null);
  const [selected,setSelected]=useState<FileDetails|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [newFolderOpen,setNewFolderOpen]=useState(false),[newFolderName,setNewFolderName]=useState("");
  const [dropActive,setDropActive]=useState(false),[previewUrl,setPreviewUrl]=useState<string|null>(null),[previewMime,setPreviewMime]=useState("");
  const uploadRef=useRef<HTMLInputElement>(null),versionRef=useRef<HTMLInputElement>(null);

  const currentFolder=folderId?folders.find(f=>f.id===folderId)||null:null;
  const childFolders=useMemo(()=>folders.filter(f=>(f.parentId||null)===(folderId||null)),[folders,folderId]);
  const folderTrail=useMemo(()=>{const trail:FolderRow[]=[];let id=folderId;const seen=new Set<string>();while(id&&!seen.has(id)){seen.add(id);const row=folders.find(f=>f.id===id);if(!row)break;trail.unshift(row);id=row.parentId}return trail},[folderId,folders]);

  async function load(showSpinner=true){
    if(showSpinner)setLoading(true);setError("");
    try{
      const params=new URLSearchParams();params.set("status",status);if(source!=="all")params.set("source",source);if(query.trim())params.set("q",query.trim());if(folderId)params.set("folderId",folderId);
      const [s,f,list]=await Promise.all([get<Summary>("/files/summary"),get<FolderRow[]>("/files/folders"),get<FileItem[]>(`/files/items?${params}`)]);
      setSummary(s);setFolders(f);setItems(list);
    }catch(e){setError(errorText(e))}finally{if(showSpinner)setLoading(false)}
  }
  useEffect(()=>{const t=setTimeout(()=>void load(),query?250:0);return()=>clearTimeout(t)},[query,source,status,folderId]);
  useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl)},[previewUrl]);

  async function openDetails(id:string){
    setBusy(true);setError("");try{setSelected(await get<FileDetails>(`/files/items/${id}`))}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  async function createFolder(){
    if(!newFolderName.trim())return;setBusy(true);setError("");try{await post("/files/folders",{name:newFolderName,parentId:folderId});setNewFolderName("");setNewFolderOpen(false);setNotice("Folder created.");await load(false)}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  async function uploadFiles(files:FileList|File[]){
    const list=Array.from(files);if(!list.length)return;setBusy(true);setError("");let complete=0;
    try{for(const file of list){const created=await uploadFile<FileItem>("/files/upload",file,"document");if(folderId)await patch(`/files/items/${created.id}`,{folderId});complete++}setNotice(`${complete} file${complete===1?"":"s"} saved to Documents & Files.`);await load(false)}catch(e){setError(`${complete?`${complete} saved. `:""}${errorText(e)}`);await load(false)}finally{setBusy(false);if(uploadRef.current)uploadRef.current.value=""}
  }
  async function syncSystem(){
    setBusy(true);setError("");try{const r=await post<{imported:number;aiGenerated:number;schoolFiles:number;scannerFiles:number}>("/files/sync-system",{});setNotice(r.imported?`Added ${r.imported} existing system document${r.imported===1?"":"s"} to the library.`:"Library is already synchronized with existing system documents.");await load(false)}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  async function updateSelected(changes:Record<string,unknown>){
    if(!selected)return;setBusy(true);setError("");try{await patch(`/files/items/${selected.id}`,changes);const fresh=await get<FileDetails>(`/files/items/${selected.id}`);setSelected(fresh);setNotice("Document updated.");await load(false)}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  async function trashSelected(){
    if(!selected)return;setBusy(true);setError("");try{await del(`/files/items/${selected.id}`);setSelected(null);setNotice("Document moved to Trash.");closePreview();await load(false)}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  async function restoreSelected(){
    if(!selected)return;setBusy(true);setError("");try{await post(`/files/items/${selected.id}/restore`,{});setNotice("Document restored.");setSelected(await get<FileDetails>(`/files/items/${selected.id}`));await load(false)}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  async function addVersion(file:File){
    if(!selected)return;setBusy(true);setError("");try{await uploadFile(`/files/items/${selected.id}/versions`,file,"version");setSelected(await get<FileDetails>(`/files/items/${selected.id}`));setNotice("New file version saved. Earlier versions are still available.");await load(false)}catch(e){setError(errorText(e))}finally{setBusy(false);if(versionRef.current)versionRef.current.value=""}
  }
  async function showPreview(){
    if(!selected)return;setBusy(true);setError("");try{closePreview();const path=`/files/items/${selected.id}/content${selected.hasPreview?"?preview=1":""}`,blob=await authorizedBlob(path),url=URL.createObjectURL(blob);setPreviewMime(blob.type||selected.previewMimeType||selected.mimeType);setPreviewUrl(url)}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  function closePreview(){if(previewUrl)URL.revokeObjectURL(previewUrl);setPreviewUrl(null);setPreviewMime("")}

  return <div className="fm-shell">
    <header className="fm-header">
      <div><div className="fm-eyebrow">Organization library</div><h1>Documents & Files</h1><p>Uploaded files, scans and Ledgerly-generated documents in one governed library.</p></div>
      <div className="fm-header-actions">
        {write&&<button className="fm-btn fm-btn-secondary" disabled={busy} onClick={()=>void syncSystem()}><RefreshCw size={16}/> Sync system files</button>}
        {write&&<button className="fm-btn fm-btn-primary" disabled={busy} onClick={()=>uploadRef.current?.click()}><Upload size={16}/> Upload files</button>}
        <input ref={uploadRef} hidden type="file" multiple onChange={e=>e.target.files&&void uploadFiles(e.target.files)}/>
      </div>
    </header>

    {(error||notice)&&<div className={classNames("fm-banner",error?"fm-banner-error":"fm-banner-ok")}><span>{error||notice}</span><button onClick={()=>{setError("");setNotice("")}}><X size={16}/></button></div>}

    <section className="fm-stats">
      <div><strong>{summary.totalFiles}</strong><span>Catalogued files</span></div>
      <div><strong>{summary.uploadedFiles}</strong><span>Uploaded</span></div>
      <div><strong>{summary.generatedFiles}</strong><span>System generated</span></div>
      <div><strong>{sizeText(summary.storageBytes)}</strong><span>Current file size</span></div>
    </section>

    <div className="fm-layout">
      <aside className="fm-sidebar">
        <div className="fm-side-heading">Library</div>
        {sourceFilters.map(row=>{const Icon=row.icon;return <button key={row.key} className={classNames("fm-side-link",source===row.key&&status==="active"&&"active")} onClick={()=>{setSource(row.key);setStatus("active");setFolderId(null)}}><Icon size={17}/><span>{row.label}</span></button>})}
        <button className={classNames("fm-side-link",status==="archived"&&"active")} onClick={()=>{setStatus("archived");setSource("all");setFolderId(null)}}><Archive size={17}/><span>Archive</span><em>{summary.archivedFiles||""}</em></button>
        <button className={classNames("fm-side-link",status==="trashed"&&"active")} onClick={()=>{setStatus("trashed");setSource("all");setFolderId(null)}}><Trash2 size={17}/><span>Trash</span><em>{summary.trashedFiles||""}</em></button>
        <div className="fm-side-heading fm-folder-heading"><span>Folders</span>{write&&<button title="New folder" onClick={()=>setNewFolderOpen(v=>!v)}><FolderPlus size={17}/></button>}</div>
        {newFolderOpen&&<div className="fm-new-folder"><input autoFocus value={newFolderName} onChange={e=>setNewFolderName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void createFolder();if(e.key==="Escape")setNewFolderOpen(false)}} placeholder="Folder name"/><button disabled={busy||!newFolderName.trim()} onClick={()=>void createFolder()}>Add</button></div>}
        <button className={classNames("fm-side-link",folderId===null&&source==="all"&&status==="active"&&"active")} onClick={()=>{setFolderId(null);setSource("all");setStatus("active")}}><Folder size={17}/><span>All folders</span></button>
        {folders.filter(f=>!f.parentId).map(f=><FolderTreeButton key={f.id} row={f} folders={folders} selected={folderId} onSelect={id=>{setFolderId(id);setStatus("active")}}/>)}
      </aside>

      <main className="fm-main">
        <div className="fm-toolbar">
          <div className="fm-breadcrumb"><button onClick={()=>setFolderId(null)}>Documents</button>{folderTrail.map(f=><span key={f.id}><b>/</b><button onClick={()=>setFolderId(f.id)}>{f.name}</button></span>)}</div>
          <div className="fm-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search documents, filenames or modules…"/></div>
        </div>

        {write&&status==="active"&&source==="all"&&<div className={classNames("fm-dropzone",dropActive&&"active")} onDragOver={e=>{e.preventDefault();setDropActive(true)}} onDragLeave={()=>setDropActive(false)} onDrop={e=>{e.preventDefault();setDropActive(false);if(e.dataTransfer.files.length)void uploadFiles(e.dataTransfer.files)}} onClick={()=>uploadRef.current?.click()}><UploadCloud size={22}/><span>Drop files here or <strong>browse</strong></span><small>Up to 50 MB per file · multiple files supported</small></div>}

        {childFolders.length>0&&status==="active"&&source==="all"&&<section className="fm-folder-grid">{childFolders.map(f=><button key={f.id} onClick={()=>setFolderId(f.id)}><Folder size={24}/><div><strong>{f.name}</strong><span>{f.fileCount} file{f.fileCount===1?"":"s"}</span></div></button>)}</section>}

        <section className="fm-list-card">
          <div className="fm-list-title"><div><strong>{status==="trashed"?"Trash":status==="archived"?"Archived documents":currentFolder?.name||sourceFilters.find(x=>x.key===source)?.label||"Documents"}</strong><span>{items.length} shown</span></div>{busy&&<LoaderCircle className="fm-spin" size={19}/>}</div>
          {loading?<div className="fm-empty"><LoaderCircle className="fm-spin" size={28}/><span>Loading documents…</span></div>:items.length===0?<div className="fm-empty"><FileText size={36}/><strong>No documents found</strong><span>{query?"Try another search.":status==="trashed"?"Trash is empty.":"Upload a file or synchronize existing Ledgerly documents."}</span></div>:<div className="fm-table-wrap"><table className="fm-table"><thead><tr><th>Name</th><th>Source</th><th>Folder</th><th>Size</th><th>Updated</th><th></th></tr></thead><tbody>{items.map(row=>{const Icon=fileIcon(row);return <tr key={row.id} onDoubleClick={()=>void openDetails(row.id)}><td><button className="fm-file-name" onClick={()=>void openDetails(row.id)}><span className="fm-file-icon"><Icon size={20}/></span><span><strong>{row.title}</strong><small>{row.filename}{row.currentVersion>1?` · v${row.currentVersion}`:""}</small></span></button></td><td><span className={`fm-source fm-source-${row.sourceType}`}>{row.sourceLabel}</span></td><td>{row.folderName||"—"}</td><td>{sizeText(row.sizeBytes)}</td><td>{dateText(row.updatedAt)}</td><td><button className="fm-icon-btn" title="Open details" onClick={()=>void openDetails(row.id)}><MoreHorizontal size={18}/></button></td></tr>})}</tbody></table></div>}
        </section>
      </main>
    </div>

    {selected&&<FileDrawer file={selected} folders={folders} write={write} busy={busy} onClose={()=>{setSelected(null);closePreview()}} onPreview={()=>void showPreview()} onDownload={()=>void downloadFile(`/files/items/${selected.id}/content?download=1`,selected.filename).catch(e=>setError(errorText(e)))} onSave={updateSelected} onTrash={trashSelected} onRestore={restoreSelected} versionRef={versionRef} onVersion={addVersion}/>} 

    {previewUrl&&<div className="fm-preview-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)closePreview()}}><div className="fm-preview"><div className="fm-preview-head"><strong>{selected?.title||"Preview"}</strong><button onClick={closePreview}><X size={20}/></button></div>{previewMime.startsWith("image/")?<img src={previewUrl} alt={selected?.title||"Document preview"}/>:previewMime==="application/pdf"?<iframe src={previewUrl} title={selected?.title||"PDF preview"}/>:<div className="fm-preview-unsupported"><File size={42}/><span>This file type is available for download but has no browser preview.</span></div>}</div></div>}
  </div>
}

function FolderTreeButton({row,folders,selected,onSelect,depth=0}:{row:FolderRow;folders:FolderRow[];selected:string|null;onSelect:(id:string)=>void;depth?:number}){
  const children=folders.filter(f=>f.parentId===row.id);return <><button className={classNames("fm-side-link","fm-folder-link",selected===row.id&&"active")} style={{paddingLeft:`${12+depth*14}px`}} onClick={()=>onSelect(row.id)}><Folder size={16}/><span>{row.name}</span><em>{row.fileCount||""}</em></button>{children.map(c=><FolderTreeButton key={c.id} row={c} folders={folders} selected={selected} onSelect={onSelect} depth={depth+1}/>)}</>
}

function FileDrawer({file,folders,write,busy,onClose,onPreview,onDownload,onSave,onTrash,onRestore,versionRef,onVersion}:{file:FileDetails;folders:FolderRow[];write:boolean;busy:boolean;onClose:()=>void;onPreview:()=>void;onDownload:()=>void;onSave:(changes:Record<string,unknown>)=>Promise<void>;onTrash:()=>Promise<void>;onRestore:()=>Promise<void>;versionRef:React.RefObject<HTMLInputElement|null>;onVersion:(file:File)=>Promise<void>}){
  const [title,setTitle]=useState(file.title),[folderId,setFolderId]=useState(file.folderId||""),[tags,setTags]=useState(file.tags.join(", ")),[tab,setTab]=useState<"details"|"versions"|"links">("details");const Icon=fileIcon(file);
  useEffect(()=>{setTitle(file.title);setFolderId(file.folderId||"");setTags(file.tags.join(", "))},[file.id,file.title,file.folderId,file.tags.join("|")]);
  return <div className="fm-drawer-backdrop" onMouseDown={e=>{if(e.currentTarget===e.target)onClose()}}><aside className="fm-drawer">
    <div className="fm-drawer-head"><div className="fm-drawer-title"><span><Icon size={22}/></span><div><strong>{file.title}</strong><small>{file.filename}</small></div></div><button onClick={onClose}><X size={20}/></button></div>
    <div className="fm-drawer-actions"><button onClick={onPreview}><Image size={16}/> Preview</button><button onClick={onDownload}><Download size={16}/> Download</button>{write&&file.sourceType==="upload"&&file.status!=="trashed"&&<button onClick={()=>versionRef.current?.click()}><Upload size={16}/> New version</button>}<input ref={versionRef} hidden type="file" onChange={e=>e.target.files?.[0]&&void onVersion(e.target.files[0])}/></div>
    <div className="fm-tabs"><button className={tab==="details"?"active":""} onClick={()=>setTab("details")}>Details</button><button className={tab==="versions"?"active":""} onClick={()=>setTab("versions")}><History size={15}/> Versions <em>{file.versions.length}</em></button><button className={tab==="links"?"active":""} onClick={()=>setTab("links")}><Paperclip size={15}/> Links <em>{file.links.length}</em></button></div>
    <div className="fm-drawer-body">
      {tab==="details"&&<>
        <div className="fm-meta-grid"><div><span>Source</span><strong>{file.sourceLabel}</strong></div><div><span>Type</span><strong>{file.mimeType}</strong></div><div><span>Size</span><strong>{sizeText(file.sizeBytes)}</strong></div><div><span>Version</span><strong>v{file.currentVersion}</strong></div><div><span>Created</span><strong>{dateText(file.createdAt)}</strong></div><div><span>Updated</span><strong>{dateText(file.updatedAt)}</strong></div></div>
        {write&&file.status!=="trashed"?<div className="fm-edit-form"><label>Title<input value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Folder<select value={folderId} onChange={e=>setFolderId(e.target.value)}><option value="">No folder</option>{folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label>Tags<input value={tags} onChange={e=>setTags(e.target.value)} placeholder="academic, policy, finance"/></label><button className="fm-btn fm-btn-primary" disabled={busy||!title.trim()} onClick={()=>void onSave({title,folderId:folderId||null,tags:tags.split(",").map(x=>x.trim()).filter(Boolean)})}>Save details</button></div>:<div className="fm-readonly-tags">{file.tags.map(t=><span key={t}><Tags size={13}/>{t}</span>)}</div>}
        <div className="fm-source-detail"><span>Source module</span><strong>{file.sourceModule||"—"}</strong><span>Source record</span><strong>{file.sourceEntityType&&file.sourceEntityId?`${file.sourceEntityType} · ${file.sourceEntityId}`:"—"}</strong>{file.checksumSha256&&<><span>SHA-256</span><code>{file.checksumSha256}</code></>}</div>
        {write&&<div className="fm-danger-row">{file.status==="active"&&<button onClick={()=>void onSave({status:"archived"})}><Archive size={16}/> Archive</button>}{file.status==="archived"&&<button onClick={()=>void onSave({status:"active"})}><ArchiveRestore size={16}/> Unarchive</button>}{file.status!=="trashed"?<button className="danger" onClick={()=>void onTrash()}><Trash2 size={16}/> Move to Trash</button>:<button onClick={()=>void onRestore()}><ArchiveRestore size={16}/> Restore</button>}</div>}
      </>}
      {tab==="versions"&&<div className="fm-version-list">{file.versions.map(v=><div key={v.id}><span className="fm-version-badge">v{v.versionNumber}</span><div><strong>{v.filename}</strong><small>{sizeText(v.sizeBytes)} · {dateText(v.createdAt)}</small></div><button title="Download version" onClick={()=>void downloadFile(`/files/items/${file.id}/versions/${v.versionNumber}/content`,v.filename)}><Download size={17}/></button></div>)}</div>}
      {tab==="links"&&<div className="fm-link-list">{file.links.length?file.links.map(l=><div key={l.id}><Paperclip size={17}/><div><strong>{l.label||l.entityType}</strong><small>{l.moduleKey||"Ledgerly"} · {l.entityType} · {l.entityId}</small></div></div>):<div className="fm-small-empty"><Paperclip size={26}/><span>This file is not explicitly linked to another record yet.</span></div>}</div>}
    </div>
  </aside></div>
}

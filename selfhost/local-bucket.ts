import { createHash } from "node:crypto";
import { mkdir,readFile,writeFile,rm,stat,readdir } from "node:fs/promises";
import path from "node:path";

function safeKey(key:string){const clean=String(key||"").replace(/\\/g,"/").replace(/^\/+/,"");if(!clean||clean.split("/").some(p=>p===".."))throw new Error("Invalid object key");return clean;}
export class LocalR2Bucket{
 constructor(private root:string){}
 private file(key:string){return path.join(this.root,safeKey(key));}
 private meta(key:string){return `${this.file(key)}.ledgerly-meta.json`;}
 async put(key:string,value:ArrayBuffer|ArrayBufferView|string|Blob,options:any={}){const file=this.file(key);await mkdir(path.dirname(file),{recursive:true});let bytes:Buffer;if(typeof value==="string")bytes=Buffer.from(value);else if(value instanceof Blob)bytes=Buffer.from(await value.arrayBuffer());else if(ArrayBuffer.isView(value))bytes=Buffer.from(value.buffer,value.byteOffset,value.byteLength);else bytes=Buffer.from(value);await writeFile(file,bytes);const etag=createHash("sha256").update(bytes).digest("hex");await writeFile(this.meta(key),JSON.stringify({httpMetadata:options.httpMetadata||{},customMetadata:options.customMetadata||{},etag,size:bytes.length}),"utf8");return{key,etag,size:bytes.length};}
 async get(key:string){try{const bytes=await readFile(this.file(key));let meta:any={};try{meta=JSON.parse(await readFile(this.meta(key),"utf8"));}catch{}return{key,size:bytes.length,etag:meta.etag,httpMetadata:meta.httpMetadata||{},customMetadata:meta.customMetadata||{},body:bytes,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),text:async()=>bytes.toString("utf8"),blob:async()=>new Blob([bytes],{type:meta.httpMetadata?.contentType||"application/octet-stream"})};}catch{return null;}}
 async head(key:string){try{const s=await stat(this.file(key));let meta:any={};try{meta=JSON.parse(await readFile(this.meta(key),"utf8"));}catch{}return{key,size:s.size,etag:meta.etag,httpMetadata:meta.httpMetadata||{},customMetadata:meta.customMetadata||{}};}catch{return null;}}
 async delete(key:string){await Promise.all([rm(this.file(key),{force:true}),rm(this.meta(key),{force:true})]);}
 async list(options:any={}){const prefix=safeKey(options.prefix||"objects").replace(/objects$/,"");const objects:any[]=[];const walk=async(dir:string)=>{let entries:any[]=[];try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}for(const e of entries){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else if(!e.name.endsWith(".ledgerly-meta.json")){const key=path.relative(this.root,p).split(path.sep).join("/");if(!options.prefix||key.startsWith(options.prefix)){const h=await this.head(key);if(h)objects.push(h);}}}};await walk(this.root);return{objects,truncated:false,delimitedPrefixes:[]};}
}

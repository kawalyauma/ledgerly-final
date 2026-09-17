import { describe,expect,it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { ObjectStorage } from "../../storage/types.js";
import { createAgentDocumentService,type AgentDocumentFormat } from "./document-service.js";

class MemoryStorage implements ObjectStorage{
 readonly driver="local" as const;
 private files=new Map<string,Uint8Array>();
 async initialize(){}
 async put(key:string,body:Uint8Array){this.files.set(key,new Uint8Array(body));}
 async get(key:string){const value=this.files.get(key);return value?new Uint8Array(value):null;}
 async delete(key:string){this.files.delete(key);}
 async exists(key:string){return this.files.has(key);}
 async healthcheck(){}
 count(){return this.files.size;}
}

const spec={
 subtitle:"Term management review",
 summary:"Verified school performance and operations overview.",
 dataAsOf:"2026-09-17",
 sections:[{heading:"Collections",paragraphs:["Collection performance is shown from verified Ledgerly records."],tables:[{title:"Fee collection",headers:["Class","Billed","Collected","Outstanding"],rows:[["Senior 3",1000000,750000,250000],["Senior 4",1200000,900000,300000]]}],charts:[{title:"Collections by class",labels:["Senior 3","Senior 4"],series:[{name:"Collected",values:[750000,900000]}]}]}],
 sheets:[{name:"Fee Collection",rows:[["Class","Billed","Collected","Outstanding"],["Senior 3",1000000,750000,250000],["Senior 4",1200000,900000,300000]]}],
 slides:[{title:"Fee collection",body:"Verified collection overview",tables:[{headers:["Class","Collected"],rows:[["Senior 3",750000],["Senior 4",900000]]}]}],
 sources:["Ledgerly fee balances","Ledgerly payments"]
};

describe("Node Agent professional document service",()=>{
 for(const format of ["pdf","docx","xlsx","pptx"] as AgentDocumentFormat[]){
  it(`generates ${format.toUpperCase()} with a printable PDF artifact`,async()=>{
   const storage=new MemoryStorage(),service=createAgentDocumentService(storage),artifact=await service.generate({documentId:`doc_${format}`,organizationId:"org_test",agentKey:"headteacher",title:"School Management Review",format,spec});
   expect(artifact.sourceSizeBytes).toBeGreaterThan(100);
   expect(artifact.pdfSizeBytes).toBeGreaterThan(100);
   expect(artifact.pdfPageCount).toBeGreaterThan(0);
   expect(artifact.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
   expect(await storage.exists(artifact.sourceObjectKey)).toBe(true);
   expect(await storage.exists(artifact.pdfObjectKey)).toBe(true);
   expect(storage.count()).toBe(format==="pdf"?1:2);
   const pdfBytes=await storage.get(artifact.pdfObjectKey);
   expect(pdfBytes).not.toBeNull();
   const pdf=await PDFDocument.load(pdfBytes!);
   expect(pdf.getPageCount()).toBe(artifact.pdfPageCount);
   if(format==="pdf")expect(artifact.sourceObjectKey).toBe(artifact.pdfObjectKey);
   else expect(artifact.sourceObjectKey).not.toBe(artifact.pdfObjectKey);
  });
 }
});

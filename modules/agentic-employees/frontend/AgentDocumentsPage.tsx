import { useEffect,useState } from "react";
import { Download,FileSpreadsheet,FileText,MessageSquare,Presentation,RefreshCw,ShieldCheck } from "lucide-react";
import { downloadFile,errorText,get } from "../../../web/api";

type Doc={id:string;agentKey:string;title:string;format:"pdf"|"docx"|"xlsx"|"pptx";sourceSizeBytes:number;pdfSizeBytes:number;pdfPageCount?:number;status:string;createdBy?:string;createdAt:string};
const EMPLOYEE:Record<string,string>={secretary:"Amina · Secretary",dos:"Daniel · DOS",bursar:"Grace · Bursar",headteacher:"Mirembe · Head Teacher",hr:"Sarah · HR",librarian:"Peter · Librarian"};
const icon=(format:string)=>format==="xlsx"?<FileSpreadsheet size={20}/>:format==="pptx"?<Presentation size={20}/>:<FileText size={20}/>;
const bytes=(n:number)=>n>=1024*1024?`${(n/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(n/1024))} KB`;
export function AgentDocumentsPage(){
 const[documents,setDocuments]=useState<Doc[]>([]),[busy,setBusy]=useState(""),[error,setError]=useState("");
 async function load(){setError("");try{setDocuments(await get<Doc[]>("/agentic-employees/documents"));}catch(e){setError(errorText(e));}}
 useEffect(()=>{void load();},[]);
 async function download(doc:Doc,kind:"source"|"pdf"){setBusy(`${doc.id}:${kind}`);setError("");try{await downloadFile(`/agentic-employees/documents/${doc.id}/${kind}`,kind==="source"?`${doc.title}.${doc.format}`:`${doc.title}.pdf`);}catch(e){setError(errorText(e));}finally{setBusy("");}}
 const openChat=()=>{location.hash="agentic-employees";};
 return <div className="ae-page">
  <div className="ae-hero"><div><span className="ae-kicker">SAVED AI OUTPUTS</span><h1>Agent Documents</h1><p>Professional PDF, DOCX, XLSX and PowerPoint files created by your AI employees. Proposals, edits, approvals and governed print requests are handled in AI Chat Studio.</p></div><div className="ae-actions"><button className="secondary" onClick={()=>void load()}><RefreshCw size={16}/>Refresh</button><button onClick={openChat}><MessageSquare size={16}/>AI Chat Studio</button></div></div>
  {error&&<div className="ae-error">{error}</div>}
  <div className="ae-panel"><div className="ae-card-top"><div><h2><ShieldCheck size={18}/>Governed document workflow</h2><p>Ask an AI employee to prepare a report or file in Chat Studio. The proposal appears directly in that conversation, where you can review and edit permitted details before approval. Printing is also requested and approved from chat, then still obeys Printerly rules, quotas, costing and secure-release policy.</p></div></div></div>
  <div className="ae-panel"><h2>Saved documents</h2><div className="ae-list">{documents.map(doc=><div key={doc.id}>{icon(doc.format)}<div><b>{doc.title}</b><small>{EMPLOYEE[doc.agentKey]||doc.agentKey} · {doc.format.toUpperCase()} · {bytes(doc.sourceSizeBytes)} · {doc.pdfPageCount||1} PDF page{doc.pdfPageCount===1?"":"s"} · {new Date(doc.createdAt).toLocaleString()}</small><div className="ae-actions"><button className="secondary" disabled={busy.startsWith(doc.id)} onClick={()=>void download(doc,"source")}><Download size={15}/>Download {doc.format.toUpperCase()}</button>{doc.format!=="pdf"&&<button className="secondary" disabled={busy.startsWith(doc.id)} onClick={()=>void download(doc,"pdf")}><Download size={15}/>PDF preview</button>}<button onClick={openChat}><MessageSquare size={15}/>Continue in chat</button></div></div></div>)}{!documents.length&&<p>No saved AI documents yet. Ask an AI employee in Chat Studio to create a professional PDF, DOCX, XLSX or PowerPoint report.</p>}</div></div>
 </div>;
}
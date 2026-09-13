import { useEffect,useMemo,useState } from "react";
import { Download,FileSpreadsheet,FileText,Presentation,Printer,RefreshCw,ShieldCheck } from "lucide-react";
import { downloadFile,errorText,get,post } from "../../../web/api";

type Doc={id:string;agentKey:string;title:string;format:"docx"|"xlsx"|"pptx";sourceSizeBytes:number;pdfSizeBytes:number;status:string;createdBy?:string;createdAt:string};
type PrinterRow={id:string;name:string;location?:string;status?:string};
const EMPLOYEE:Record<string,string>={secretary:"Amina · Secretary",dos:"Daniel · DOS",bursar:"Grace · Bursar",headteacher:"Mirembe · Head Teacher",hr:"Sarah · HR",librarian:"Peter · Librarian"};
const icon=(format:string)=>format==="xlsx"?<FileSpreadsheet size={20}/>:format==="pptx"?<Presentation size={20}/>:<FileText size={20}/>;
const bytes=(n:number)=>n>=1024*1024?`${(n/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(n/1024))} KB`;
export function AgentDocumentsPage(){
 const[documents,setDocuments]=useState<Doc[]>([]),[printers,setPrinters]=useState<PrinterRow[]>([]),[printerId,setPrinterId]=useState(""),[busy,setBusy]=useState(""),[error,setError]=useState(""),[notice,setNotice]=useState("");
 async function load(){setError("");try{const[d,p]=await Promise.all([get<Doc[]>("/agentic-employees/documents"),get<PrinterRow[]>("/printerly/printers").catch(()=>[])]);setDocuments(d);setPrinters(p);}catch(e){setError(errorText(e));}}
 useEffect(()=>{void load();},[]);
 const readyPrinters=useMemo(()=>printers.filter(p=>!p.status||p.status==="ready"||p.status==="online"),[printers]);
 async function download(doc:Doc,kind:"source"|"pdf"){setBusy(`${doc.id}:${kind}`);setError("");try{await downloadFile(`/agentic-employees/documents/${doc.id}/${kind}`,kind==="source"?`${doc.title}.${doc.format}`:`${doc.title}.pdf`);}catch(e){setError(errorText(e));}finally{setBusy("");}}
 async function preparePrint(doc:Doc){setBusy(`${doc.id}:print`);setError("");setNotice("");try{await post(`/agentic-employees/documents/${doc.id}/prepare-print`,{printerId:printerId||null,copies:1,pageSize:"A4",colorMode:"monochrome",duplex:false,secureRelease:false,priority:"normal"});setNotice(`Print action prepared for “${doc.title}”. Review it in Action Center before anything is sent to Printerly.`);}catch(e){setError(errorText(e));}finally{setBusy("");}}
 return <div className="ae-page">
  <div className="ae-hero"><div><span className="ae-kicker">SAVED AI OUTPUTS</span><h1>Agent Documents</h1><p>DOCX, XLSX and PowerPoint files created by your AI employees are saved with a printable PDF companion. Printing remains human-governed.</p></div><button className="secondary" onClick={()=>void load()}><RefreshCw size={16}/>Refresh</button></div>
  {error&&<div className="ae-error">{error}</div>}{notice&&<div className="ae-panel"><p>{notice}</p></div>}
  <div className="ae-panel"><div className="ae-card-top"><div><h2><ShieldCheck size={18}/>Document safety</h2><p>Ask an employee in its workspace to prepare a document. The file is created only after Action Center approval. Printing creates a second approved action and still obeys Printerly rules, quotas, costing, secure release and any Printerly approval requirement.</p></div></div>
   <label>Preferred printer</label><select value={printerId} onChange={e=>setPrinterId(e.target.value)}><option value="">Automatic / Printerly policy routing</option>{readyPrinters.map(p=><option key={p.id} value={p.id}>{p.name}{p.location?` · ${p.location}`:""}</option>)}</select>
  </div>
  <div className="ae-panel"><h2>Saved documents</h2><div className="ae-list">{documents.map(doc=><div key={doc.id}>{icon(doc.format)}<div><b>{doc.title}</b><small>{EMPLOYEE[doc.agentKey]||doc.agentKey} · {doc.format.toUpperCase()} · source {bytes(doc.sourceSizeBytes)} · PDF {bytes(doc.pdfSizeBytes)} · {new Date(doc.createdAt).toLocaleString()}</small><div className="ae-actions"><button className="secondary" disabled={busy.startsWith(doc.id)} onClick={()=>void download(doc,"source")}><Download size={15}/>Download {doc.format.toUpperCase()}</button><button className="secondary" disabled={busy.startsWith(doc.id)} onClick={()=>void download(doc,"pdf")}><Download size={15}/>Printable PDF</button><button disabled={busy.startsWith(doc.id)} onClick={()=>void preparePrint(doc)}><Printer size={15}/>Prepare Printerly print</button></div></div></div>)}{!documents.length&&<p>No saved AI documents yet. Ask Amina, Daniel, Grace, Mirembe, Sarah or Peter to prepare a DOCX, XLSX or PPTX document.</p>}</div></div>
 </div>;
}

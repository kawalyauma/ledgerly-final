import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleX, ClipboardCheck, Play, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { errorText, get, post } from "../../../web/api";

type ActionRow={
  id:string;eventId?:string|null;reactionId?:string|null;agentKey:string;actionType:string;title:string;summary:string;requiredScope:string;
  payload:Record<string,unknown>;status:string;approvalId?:string|null;resultEntityType?:string|null;resultEntityId?:string|null;failureText?:string|null;
  createdAt:string;updatedAt:string;
};
const EMPLOYEE:Record<string,string>={secretary:"Amina · Secretary",dos:"Daniel · DOS",bursar:"Grace · Bursar",headteacher:"Mirembe · Head Teacher",hr:"Sarah · HR",librarian:"Peter · Librarian"};
const ORDER=["suggested","prepared","awaiting_approval","approved","executing","failed","executed","dismissed"];

export function ActionCenterPage(){
  const [items,setItems]=useState<ActionRow[]>([]),[busy,setBusy]=useState(""),[error,setError]=useState("");
  async function refresh(){setError("");try{setItems(await get<ActionRow[]>("/agentic-employees/actions"));}catch(e){setError(errorText(e));}}
  useEffect(()=>{void refresh();},[]);
  const groups=useMemo(()=>ORDER.map(status=>({status,items:items.filter(x=>x.status===status)})).filter(g=>g.items.length),[items]);
  async function run(id:string,op:string,body:Record<string,unknown>={}){setBusy(`${id}:${op}`);setError("");try{await post(`/agentic-employees/actions/${id}/${op}`,body);await refresh();}catch(e){setError(errorText(e));}finally{setBusy("");}}
  return <div className="ae-page">
    <div className="ae-hero"><div><span className="ae-kicker">HUMAN-GOVERNED AUTONOMY</span><h1>AI Action Center</h1><p>Employees can prepare real work from verified Ledgerly events. Nothing sensitive executes until a human approves it.</p></div><button className="secondary" onClick={()=>void refresh()}><RefreshCw size={16}/>Refresh</button></div>
    {error&&<div className="ae-error">{error}</div>}
    <div className="ae-panel"><div className="ae-card-top"><div><h2><ShieldCheck size={18}/>Action lifecycle</h2><p>Suggested → Prepared → Awaiting approval → Approved → Executing → Executed. Rejected or dismissed actions stop permanently.</p></div></div></div>
    {groups.map(group=><div className="ae-panel" key={group.status}><h2>{group.status.replaceAll("_"," ")}</h2><div className="ae-list">
      {group.items.map(item=><div key={item.id}><ClipboardCheck/><div>
        <b>{item.title}</b><small>{EMPLOYEE[item.agentKey]||item.agentKey} · {item.actionType} · requires {item.requiredScope} · {new Date(item.createdAt).toLocaleString()}</small>
        <p>{item.summary}</p>
        <details><summary>Prepared payload</summary><pre>{JSON.stringify(item.payload,null,2)}</pre></details>
        {item.failureText&&<p className="bad">{item.failureText}</p>}
        {item.resultEntityId&&<small>Result: {item.resultEntityType||"entity"} · {item.resultEntityId}</small>}
        <div className="ae-actions">
          {item.status==="suggested"&&<><button disabled={busy.startsWith(item.id)} onClick={()=>void run(item.id,"prepare")}><ClipboardCheck size={15}/>Prepare</button><button className="secondary" onClick={()=>void run(item.id,"dismiss")}><CircleX size={15}/>Dismiss</button></>}
          {item.status==="prepared"&&<><button disabled={busy.startsWith(item.id)} onClick={()=>void run(item.id,"request-approval")}><Send size={15}/>Request approval</button><button className="secondary" onClick={()=>void run(item.id,"dismiss")}><CircleX size={15}/>Dismiss</button></>}
          {item.status==="awaiting_approval"&&<><button disabled={busy.startsWith(item.id)} onClick={()=>void run(item.id,"review",{decision:"approve"})}><CheckCircle2 size={15}/>Approve</button><button className="secondary" onClick={()=>void run(item.id,"review",{decision:"reject"})}><CircleX size={15}/>Reject</button></>}
          {item.status==="approved"&&<><button disabled={busy.startsWith(item.id)} onClick={()=>void run(item.id,"execute")}><Play size={15}/>Execute</button><button className="secondary" onClick={()=>void run(item.id,"dismiss")}><CircleX size={15}/>Cancel</button></>}
          {item.status==="executing"&&<small>Execution has been claimed and is in progress. Refresh to see the final result.</small>}
        </div>
      </div></div>)}
    </div></div>)}
    {!items.length&&<div className="ae-panel"><p>No AI actions have been suggested yet. Event reactions will create them when a safe operational follow-up is available.</p></div>}
  </div>;
}

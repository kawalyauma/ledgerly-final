import { useEffect, useState } from "react";
import { AlertTriangle, BellRing, Check, RefreshCw, Settings2, Zap } from "lucide-react";
import { errorText, get, patch, post } from "../../../web/api";

type Reaction = {
  id: string;
  eventId: string;
  agentKey: string;
  severity: "info" | "attention" | "urgent";
  title: string;
  summary: string;
  recommendedAction?: string | null;
  eventType: string;
  sourceModule: string;
  occurredAt: string;
  acknowledgedAt?: string | null;
};

type Settings = {
  enabled: boolean;
  attendanceWindowDays: number;
  attendanceAttentionCount: number;
  attendanceUrgentCount: number;
  booksLowStockThreshold: number;
  paymentReactionEnabled: boolean;
  attendanceReactionEnabled: boolean;
  hrReactionEnabled: boolean;
  booksReactionEnabled: boolean;
};

const EMPLOYEE: Record<string,string> = { secretary: "Amina · Secretary", dos: "Daniel · DOS", bursar: "Grace · Bursar", headteacher: "Mirembe · Head Teacher", hr: "Sarah · HR", librarian: "Peter · Librarian" };

export function EventReactionsPage() {
  const [reactions,setReactions]=useState<Reaction[]>([]);
  const [settings,setSettings]=useState<Settings|null>(null);
  const [busy,setBusy]=useState("");
  const [error,setError]=useState("");

  async function refresh(){
    setError("");
    try{
      const [nextReactions,nextSettings]=await Promise.all([
        get<Reaction[]>("/agentic-employees/events/reactions?limit=80"),
        get<Settings>("/agentic-employees/events/settings"),
      ]);
      setReactions(nextReactions);setSettings(nextSettings);
    }catch(err){setError(errorText(err));}
  }

  useEffect(()=>{void refresh();},[]);

  async function acknowledge(id:string){
    setBusy(id);setError("");
    try{await post(`/agentic-employees/events/reactions/${id}/acknowledge`,{});await refresh();}
    catch(err){setError(errorText(err));}finally{setBusy("");}
  }

  async function processNow(){
    setBusy("process");setError("");
    try{await post("/agentic-employees/events/process",{});await refresh();}
    catch(err){setError(errorText(err));}finally{setBusy("");}
  }

  async function save(next:Partial<Settings>){
    if(!settings)return;
    setBusy("settings");setError("");
    try{const updated=await patch<Settings>("/agentic-employees/events/settings",next);setSettings(updated);}
    catch(err){setError(errorText(err));}finally{setBusy("");}
  }

  return <div className="ae-page">
    <div className="ae-hero">
      <div><span className="ae-kicker">EVENT-DRIVEN AI WORKFORCE</span><h1>Employee Reactions</h1><p>Ledgerly events wake the appropriate AI employee for a bounded, read-only reaction. External actions still require human approval.</p></div>
      <button disabled={busy==="process"} onClick={()=>void processNow()}><Zap size={17}/>Process now</button>
    </div>
    {error&&<div className="ae-error">{error}</div>}

    {settings&&<div className="ae-panel">
      <div className="ae-card-top"><div><h2><Settings2 size={18}/> Reaction policy</h2><p>Configure thresholds and individual event streams without giving employees write authority.</p></div><button className="secondary" onClick={()=>void refresh()}><RefreshCw size={16}/>Refresh</button></div>
      <div className="ae-grid">
        <label><span>All event reactions</span><button disabled={busy==="settings"} onClick={()=>void save({enabled:!settings.enabled})}>{settings.enabled?"Enabled":"Disabled"}</button></label>
        <label><span>Finance / posted payments</span><button disabled={busy==="settings"} onClick={()=>void save({paymentReactionEnabled:!settings.paymentReactionEnabled})}>{settings.paymentReactionEnabled?"Enabled":"Disabled"}</button></label>
        <label><span>Attendance / absences</span><button disabled={busy==="settings"} onClick={()=>void save({attendanceReactionEnabled:!settings.attendanceReactionEnabled})}>{settings.attendanceReactionEnabled?"Enabled":"Disabled"}</button></label>
        <label><span>HR / approved leave</span><button disabled={busy==="settings"} onClick={()=>void save({hrReactionEnabled:!settings.hrReactionEnabled})}>{settings.hrReactionEnabled?"Enabled":"Disabled"}</button></label>
        <label><span>Books / stock</span><button disabled={busy==="settings"} onClick={()=>void save({booksReactionEnabled:!settings.booksReactionEnabled})}>{settings.booksReactionEnabled?"Enabled":"Disabled"}</button></label>
        <label><span>Attendance window (days)</span><input type="number" min={1} max={90} value={settings.attendanceWindowDays} onChange={e=>setSettings({...settings,attendanceWindowDays:Number(e.target.value)})}/></label>
        <label><span>Absence attention count</span><input type="number" min={1} value={settings.attendanceAttentionCount} onChange={e=>setSettings({...settings,attendanceAttentionCount:Number(e.target.value)})}/></label>
        <label><span>Absence urgent count</span><input type="number" min={1} value={settings.attendanceUrgentCount} onChange={e=>setSettings({...settings,attendanceUrgentCount:Number(e.target.value)})}/></label>
        <label><span>Books low-stock threshold</span><input type="number" min={0} value={settings.booksLowStockThreshold} onChange={e=>setSettings({...settings,booksLowStockThreshold:Number(e.target.value)})}/></label>
      </div>
      <div className="ae-actions"><button disabled={busy==="settings"} onClick={()=>void save(settings)}>Save policy</button></div>
    </div>}

    <div className="ae-panel">
      <h2><BellRing size={18}/> Recent reactions</h2>
      <div className="ae-list">
        {reactions.map(item=><div key={item.id}>
          {item.severity==="urgent"?<AlertTriangle/>:<BellRing/>}
          <div>
            <b>{item.title}</b>
            <small>{EMPLOYEE[item.agentKey]||item.agentKey} · {item.severity} · {item.eventType} · {new Date(item.occurredAt).toLocaleString()}</small>
            <p>{item.summary}</p>
            {item.recommendedAction&&<p><strong>Recommended:</strong> {item.recommendedAction}</p>}
            {!item.acknowledgedAt?<button disabled={busy===item.id} onClick={()=>void acknowledge(item.id)}><Check size={15}/>Acknowledge</button>:<small>✓ Acknowledged</small>}
          </div>
        </div>)}
        {!reactions.length&&<p>No employee event reactions yet.</p>}
      </div>
    </div>
  </div>;
}

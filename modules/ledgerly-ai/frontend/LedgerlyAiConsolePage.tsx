import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity, AlertTriangle, Archive, BarChart3, Bot, Brain, CheckCircle2, Clock3,
  Database, GitPullRequest, HeartPulse, MessageSquare, PauseCircle,
  Play, RefreshCw, Rocket, Search, Send, ShieldCheck, SlidersHorizontal, Sparkles,
  TerminalSquare, Users, Wrench, XCircle, Zap
} from "lucide-react";
import { authStore, errorText, get, post, put } from "../../../web/api";
import "./ledgerly-ai-console.css";

type Section =
  | "overview"|"chat"|"employees"|"custom"|"incidents"|"jobs"|"activity"
  | "approvals"|"deployments"|"memory"|"tools"|"providers"|"audit"|"usage";

type Employee={
  id:string;key:string;name:string;role:string;description?:string;status:string;
  kind?:string;tools?:string[];permissions?:string[];capabilities?:string[];
};
type Chat={id:string;title:string;agentId?:string|null;status:string;lastMessageAt?:string;createdAt?:string};
type ChatMessage={id:string;role:string;content:string;agentId?:string|null;createdAt?:string};
type Approval={
  id:string;actionType:string;riskLevel:string;status:string;toolName?:string;
  approvalMode?:string;requiredApprovals?:number;approvalCount?:number;createdAt?:string;
};
type Incident={
  id:string;title:string;severity:string;status:string;assignedAgentKey?:string;
  occurrenceCount?:number;changeRisk?:string;detectedAt?:string;lastSeenAt?:string;
  teamChatId?:string|null;
};

const NAV:Array<{key:Section;label:string;icon:typeof Activity}>=[
  {key:"overview",label:"Overview",icon:Sparkles},
  {key:"chat",label:"Admin Chat",icon:MessageSquare},
  {key:"employees",label:"Employees",icon:Users},
  {key:"custom",label:"Custom Agents",icon:Bot},
  {key:"incidents",label:"Incidents",icon:AlertTriangle},
  {key:"jobs",label:"Engineering Queue",icon:TerminalSquare},
  {key:"activity",label:"Activity",icon:Activity},
  {key:"approvals",label:"Approvals",icon:ShieldCheck},
  {key:"deployments",label:"Deployments",icon:Rocket},
  {key:"memory",label:"Memory",icon:Brain},
  {key:"tools",label:"Tools & Permissions",icon:Wrench},
  {key:"providers",label:"Provider Health",icon:HeartPulse},
  {key:"audit",label:"Audit",icon:Archive},
  {key:"usage",label:"Usage & Performance",icon:BarChart3},
];

function fmt(value:unknown){
  if(value===null||value===undefined||value==="")return "—";
  if(typeof value==="number")return Number.isFinite(value)?value.toLocaleString():"—";
  return String(value);
}
function when(value:unknown){
  if(!value)return "—";
  const d=new Date(String(value));
  return Number.isNaN(d.getTime())?String(value):d.toLocaleString();
}
function cls(value:unknown){
  return String(value??"unknown").toLowerCase().replace(/[^a-z0-9]+/g,"-");
}
function Json({value}:{value:unknown}){
  return <pre className="lai-json">{JSON.stringify(value??{},null,2)}</pre>;
}
function Empty({children}:{children:ReactNode}){
  return <div className="lai-empty"><Database size={24}/><p>{children}</p></div>;
}
function Pill({children,tone}:{children:ReactNode;tone?:string}){
  return <span className={"lai-pill "+cls(tone??children)}>{children}</span>;
}
function Card({title,value,sub,icon:Icon,tone}:{title:string;value:unknown;sub?:string;icon:typeof Activity;tone?:string}){
  return <article className={"lai-stat "+(tone?cls(tone):"")}>
    <span className="lai-stat-icon"><Icon size={18}/></span>
    <div><small>{title}</small><strong>{fmt(value)}</strong>{sub&&<p>{sub}</p>}</div>
  </article>;
}

export function LedgerlyAiConsolePage(){
  const principal=authStore.principal();
  const [section,setSection]=useState<Section>("overview");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [data,setData]=useState<Record<string,any>>({});
  const [refreshKey,setRefreshKey]=useState(0);

  const [chats,setChats]=useState<Chat[]>([]);
  const [employees,setEmployees]=useState<Employee[]>([]);
  const [chatId,setChatId]=useState<string|null>(null);
  const [chatMessages,setChatMessages]=useState<ChatMessage[]>([]);
  const [chatAgent,setChatAgent]=useState("");
  const [chatText,setChatText]=useState("");
  const [sending,setSending]=useState(false);
  const [memoryQuery,setMemoryQuery]=useState("");
  const [usageDays,setUsageDays]=useState(7);

  const isOwner=principal?.role==="owner";

  async function loadSection(active:Section=section){
    setLoading(true);setError("");
    try{
      if(active==="overview"){
        const value=await get<any>("/ledgerly-ai/console/overview");
        setData(d=>({...d,overview:value}));
      }else if(active==="chat"){
        const [chatRows,employeeRows]=await Promise.all([
          get<Chat[]>("/ledgerly-ai/chats"),
          get<Employee[]>("/ledgerly-ai/employees"),
        ]);
        setChats(chatRows);setEmployees(employeeRows);
        if(chatId){
          const detail=await get<any>("/ledgerly-ai/chats/"+chatId);
          setChatMessages(detail.messages??[]);
        }
      }else if(active==="employees"){
        const [rows,controls]=await Promise.all([
          get<Employee[]>("/ledgerly-ai/internal/employees"),
          get<any[]>("/ledgerly-ai/policy/controls"),
        ]);
        setData(d=>({...d,employees:rows,controls}));
      }else if(active==="custom"){
        const rows=await get<any[]>("/ledgerly-ai/forge/agents");
        setData(d=>({...d,custom:rows}));
      }else if(active==="incidents"){
        const rows=await get<Incident[]>("/ledgerly-ai/incidents?limit=150");
        setData(d=>({...d,incidents:rows}));
      }else if(active==="jobs"){
        const rows=await get<any[]>("/ledgerly-ai/console/jobs?limit=200");
        setData(d=>({...d,jobs:rows}));
      }else if(active==="activity"){
        const rows=await get<any[]>("/ledgerly-ai/console/activity?limit=250");
        setData(d=>({...d,activity:rows}));
      }else if(active==="approvals"){
        const rows=await get<Approval[]>("/ledgerly-ai/approvals?status=pending");
        setData(d=>({...d,approvals:rows}));
      }else if(active==="deployments"){
        const rows=await get<any[]>("/ledgerly-ai/console/deployments?limit=200");
        setData(d=>({...d,deployments:rows}));
      }else if(active==="memory"){
        const q=memoryQuery.trim()?"&query="+encodeURIComponent(memoryQuery.trim()):"";
        const rows=await get<any[]>("/ledgerly-ai/internal/memories?limit=150"+q);
        setData(d=>({...d,memory:rows}));
      }else if(active==="tools"){
        const rows=await get<any[]>("/ledgerly-ai/tools");
        setData(d=>({...d,tools:rows}));
      }else if(active==="providers"){
        const value=await get<any>("/ledgerly-ai/internal/providers");
        setData(d=>({...d,providers:value}));
      }else if(active==="audit"){
        const rows=await get<any[]>("/ledgerly-ai/console/audit?limit=300");
        setData(d=>({...d,audit:rows}));
      }else if(active==="usage"){
        const value=await get<any>("/ledgerly-ai/console/usage?days="+usageDays);
        setData(d=>({...d,usage:value}));
      }
    }catch(err){setError(errorText(err));}
    finally{setLoading(false);}
  }

  useEffect(()=>{void loadSection(section);},[section,refreshKey]);
  useEffect(()=>{if(section==="usage")void loadSection("usage");},[usageDays]);
  useEffect(()=>{
    if(!["overview","incidents","jobs","activity","approvals","deployments"].includes(section))return;
    const id=window.setInterval(()=>setRefreshKey(x=>x+1),15000);
    return()=>window.clearInterval(id);
  },[section]);

  async function selectChat(id:string){
    setChatId(id);setLoading(true);setError("");
    try{
      const detail=await get<any>("/ledgerly-ai/chats/"+id);
      setChatMessages(detail.messages??[]);
      if(detail.agentId)setChatAgent(detail.agentId);
    }catch(err){setError(errorText(err));}
    finally{setLoading(false);}
  }
  async function sendChat(){
    const message=chatText.trim();if(!message||sending)return;
    setSending(true);setError("");setChatText("");
    try{
      const body={message,agentId:chatAgent||null,taskKind:"chat" as const};
      const response=chatId
        ? await post<any>("/ledgerly-ai/chats/"+chatId+"/messages",body)
        : await post<any>("/ledgerly-ai/chat",{...body,title:"Admin Ledgerly AI"});
      const id=response.chat?.id??chatId;
      if(id){setChatId(id);await selectChat(id);}
      const rows=await get<Chat[]>("/ledgerly-ai/chats");setChats(rows);
    }catch(err){setError(errorText(err));setChatText(message);}
    finally{setSending(false);}
  }
  async function reviewApproval(id:string,decision:"approve"|"reject"){
    try{
      await post("/ledgerly-ai/approvals/"+id+"/"+decision,{note:"Reviewed from Ledgerly AI Admin Console"});
      await loadSection("approvals");
    }catch(err){setError(errorText(err));}
  }
  async function setOrgControl(state:"active"|"paused"|"stopped"){
    try{
      await put("/ledgerly-ai/policy/controls/organization",{state,reason:"Changed from Ledgerly AI Admin Console"});
      await loadSection("overview");
    }catch(err){setError(errorText(err));}
  }
  async function setAgentControl(id:string,state:"active"|"paused"|"stopped"){
    try{
      await put("/ledgerly-ai/policy/controls/agents/"+id,{state,reason:"Changed from Ledgerly AI Admin Console"});
      await loadSection("employees");
    }catch(err){setError(errorText(err));}
  }
  async function customAction(id:string,action:"enable"|"disable"|"run"){
    try{
      if(action==="run")await post("/ledgerly-ai/custom-agents/"+id+"/run",{});
      else await post("/ledgerly-ai/forge/agents/"+id+"/"+action,{});
      await loadSection("custom");
    }catch(err){setError(errorText(err));}
  }
  async function incidentAction(id:string,action:"retry"|"approve"|"reject"|"verify"){
    try{
      const path=action==="retry"?"/retry":
        action==="approve"?"/production/approve":
        action==="reject"?"/production/reject":"/verify";
      await post("/ledgerly-ai/incidents/"+id+path,{note:"Reviewed from Ledgerly AI Admin Console"});
      await loadSection("incidents");
    }catch(err){setError(errorText(err));}
  }
  async function openIncidentChat(incident:Incident){
    setLoading(true);setError("");
    try{
      const detail=incident.teamChatId?null:await get<any>("/ledgerly-ai/incidents/"+incident.id);
      const id=incident.teamChatId??detail?.incident?.teamChatId;
      if(!id)throw new Error("The incident team chat has not been created yet. Retry the incident to start it.");
      const [chatDetail,chatRows,employeeRows]=await Promise.all([
        get<any>("/ledgerly-ai/chats/"+id),get<Chat[]>("/ledgerly-ai/chats"),get<Employee[]>("/ledgerly-ai/employees"),
      ]);
      setChats(chatRows);setEmployees(employeeRows);setChatId(id);
      setChatMessages(chatDetail.messages??[]);setChatAgent(chatDetail.agentId??"");setSection("chat");
    }catch(err){setError(errorText(err));}
    finally{setLoading(false);}
  }

  const title=useMemo(()=>NAV.find(x=>x.key===section)?.label??"Ledgerly AI",[section]);

  return <div className="lai-console">
    <header className="lai-hero">
      <div>
        <span className="lai-kicker"><Zap size={13}/> LEDGERLY AI CONTROL PLANE</span>
        <h1>Ledgerly AI</h1>
        <p>Admin console for conversations, employees, engineering incidents, approvals, memory, tools, deployments, policy and runtime health.</p>
      </div>
      <div className="lai-hero-actions">
        <Pill tone={data.overview?.health?.status}>{data.overview?.health?.status??"managed"}</Pill>
        <button className="secondary" onClick={()=>setRefreshKey(x=>x+1)} disabled={loading}><RefreshCw size={15}/> Refresh</button>
      </div>
    </header>

    {error&&<div className="lai-error"><AlertTriangle size={16}/><span>{error}</span><button onClick={()=>setError("")}>×</button></div>}

    <div className="lai-layout">
      <aside className="lai-nav">
        <div className="lai-nav-head"><Bot size={18}/><span>Admin Console</span></div>
        {NAV.map(item=>{
          const Icon=item.icon;
          return <button key={item.key} className={section===item.key?"active":""} onClick={()=>setSection(item.key)}>
            <Icon size={16}/><span>{item.label}</span>
          </button>;
        })}
        <div className="lai-nav-foot">
          <small>Signed in as</small><b>{principal?.role??"unknown"}</b>
          <span>Provider routing stays hidden from ordinary Ledgerly AI users.</span>
        </div>
      </aside>

      <main className="lai-main">
        <div className="lai-section-head">
          <div><small>LEDGERLY AI</small><h2>{title}</h2></div>
          {loading&&<span className="lai-loading"><RefreshCw size={14}/> Updating…</span>}
        </div>

        {section==="overview"&&<Overview data={data.overview} isOwner={Boolean(isOwner)} onControl={setOrgControl}/>}
        {section==="chat"&&<ChatPanel chats={chats} employees={employees} selected={chatId} messages={chatMessages}
          agent={chatAgent} text={chatText} sending={sending}
          onSelect={selectChat} onNew={()=>{setChatId(null);setChatMessages([]);setChatAgent("");}}
          onAgent={setChatAgent} onText={setChatText} onSend={sendChat}/>}
        {section==="employees"&&<Employees rows={data.employees??[]} controls={data.controls??[]} onControl={setAgentControl}/>}
        {section==="custom"&&<CustomAgents rows={data.custom??[]} onAction={customAction}/>}
        {section==="incidents"&&<Incidents rows={data.incidents??[]} onAction={incidentAction} onChat={openIncidentChat}/>}
        {section==="jobs"&&<Jobs rows={data.jobs??[]}/>}
        {section==="activity"&&<ActivityRows rows={data.activity??[]}/>}
        {section==="approvals"&&<Approvals rows={data.approvals??[]} onReview={reviewApproval}/>}
        {section==="deployments"&&<Deployments rows={data.deployments??[]}/>}
        {section==="memory"&&<MemoryInspector rows={data.memory??[]} query={memoryQuery} onQuery={setMemoryQuery} onSearch={()=>loadSection("memory")}/>}
        {section==="tools"&&<Tools rows={data.tools??[]}/>}
        {section==="providers"&&<ProviderHealth value={data.providers}/>}
        {section==="audit"&&<Audit rows={data.audit??[]}/>}
        {section==="usage"&&<Usage value={data.usage} days={usageDays} onDays={setUsageDays}/>}
      </main>
    </div>
  </div>;
}

function Overview({data,isOwner,onControl}:{data:any;isOwner:boolean;onControl:(state:"active"|"paused"|"stopped")=>void}){
  if(!data)return <Empty>Overview has not loaded yet.</Empty>;
  const control=(data.controls??[]).find((x:any)=>x.scopeType==="organization");
  const state=control?.state??"active";
  return <>
    <section className="lai-stats">
      <Card icon={Users} title="AI employees" value={data.employees?.total} sub={fmt(data.employees?.active)+" active"}/>
      <Card icon={TerminalSquare} title="Running / queued" value={(Number(data.jobs?.running??0)+Number(data.jobs?.queued??0))} sub={fmt(data.jobs?.waitingApproval)+" waiting approval"}/>
      <Card icon={AlertTriangle} title="Open incidents" value={data.incidents?.open} sub={fmt(data.incidents?.critical)+" critical" } tone={data.incidents?.critical?"critical":undefined}/>
      <Card icon={ShieldCheck} title="Pending approvals" value={data.approvals?.pending} sub={fmt(data.approvals?.critical)+" critical"}/>
      <Card icon={MessageSquare} title="Active chats" value={data.chats?.active} sub={fmt(data.chats?.created24h)+" created today"}/>
      <Card icon={Brain} title="Active memories" value={data.memories?.active} sub={fmt(data.memories?.pinned)+" pinned"}/>
      <Card icon={Wrench} title="Tool calls / 24h" value={data.tools?.calls24h} sub={fmt(data.tools?.failed24h)+" failed"}/>
      <Card icon={GitPullRequest} title="Open PRs" value={data.git?.openPrs} sub={fmt(data.git?.conflicts)+" conflicts"}/>
    </section>
    <section className="lai-two">
      <article className="lai-panel">
        <div className="lai-panel-title"><div><small>AUTONOMY CONTROL</small><h3>Organization state</h3></div><Pill tone={state}>{state}</Pill></div>
        <p className="lai-muted">Pause stops new autonomous work while preserving queued work. Emergency stop blocks autonomous activity until an owner releases it.</p>
        <div className="lai-actions">
          <button onClick={()=>onControl("active")}><Play size={14}/> Active</button>
          <button className="warning" onClick={()=>onControl("paused")}><PauseCircle size={14}/> Pause</button>
          <button className="danger" onClick={()=>onControl("stopped")} disabled={!isOwner}><XCircle size={14}/> Emergency stop</button>
        </div>
        {!isOwner&&<small className="lai-muted">Only the organization owner can engage or release the emergency stop.</small>}
      </article>
      <article className="lai-panel">
        <div className="lai-panel-title"><div><small>PLATFORM HEALTH</small><h3>Runtime</h3></div><Pill tone={data.health?.status}>{data.health?.status??"unknown"}</Pill></div>
        <div className="lai-kv"><span>Database</span><b>{data.health?.components?.postgres?.status??"—"}</b></div>
        <div className="lai-kv"><span>Schema</span><b>{data.health?.components?.schema?.status??"—"}</b></div>
        <div className="lai-kv"><span>Provider pool</span><b>{data.health?.components?.providerPool?.available??"—"} available</b></div>
        <div className="lai-kv"><span>Last generated</span><b>{when(data.generatedAt)}</b></div>
      </article>
    </section>
    <section className="lai-panel">
      <div className="lai-panel-title"><div><small>MONITORING</small><h3>Latest engineering health</h3></div></div>
      <div className="lai-monitor-grid">
        {(data.monitoring?.samples??[]).map((x:any)=><div key={x.monitorType+":"+x.sampleKey}>
          <Pill tone={x.status}>{x.status}</Pill><b>{x.monitorType} · {x.sampleKey}</b><span>{x.message||"No message"}</span>
        </div>)}
      </div>
    </section>
  </>;
}

function ChatPanel({chats,employees,selected,messages,agent,text,sending,onSelect,onNew,onAgent,onText,onSend}:{
  chats:Chat[];employees:Employee[];selected:string|null;messages:ChatMessage[];agent:string;text:string;sending:boolean;
  onSelect:(id:string)=>void;onNew:()=>void;onAgent:(id:string)=>void;onText:(text:string)=>void;onSend:()=>void;
}){
  return <div className="lai-chat-shell">
    <aside>
      <button className="lai-new-chat" onClick={onNew}><Sparkles size={14}/> New admin chat</button>
      <div className="lai-chat-list">{chats.map(chat=><button key={chat.id} className={selected===chat.id?"active":""} onClick={()=>onSelect(chat.id)}>
        <MessageSquare size={14}/><span><b>{chat.title}</b><small>{when(chat.lastMessageAt??chat.createdAt)}</small></span>
      </button>)}</div>
    </aside>
    <section>
      <header>
        <div><small>PERSISTENT MEMORY CHAT</small><h3>{selected?"Conversation":"New conversation"}</h3></div>
        <select value={agent} onChange={e=>onAgent(e.target.value)} disabled={Boolean(selected)}>
          <option value="">Ledgerly AI automatic routing</option>
          {employees.map(emp=><option key={emp.id} value={emp.id}>{emp.name} · {emp.role}</option>)}
        </select>
      </header>
      <div className="lai-messages">
        {!messages.length&&<div className="lai-chat-welcome"><Brain size={34}/><h3>Ask Ledgerly AI</h3><p>Conversation memory is captured by the managed Ledgerly AI memory service. Provider identity stays hidden.</p></div>}
        {messages.map(m=><article key={m.id} className={"lai-message "+m.role}>
          <small>{m.role==="assistant"?(employees.find(emp=>emp.id===m.agentId)?.name??"Ledgerly AI"):m.role}</small><p>{m.content}</p><time>{when(m.createdAt)}</time>
        </article>)}
      </div>
      <footer>
        <textarea value={text} onChange={e=>onText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();onSend();}}} placeholder="Ask Ledgerly AI…"/>
        <button onClick={onSend} disabled={sending||!text.trim()}><Send size={15}/>{sending?"Sending…":"Send"}</button>
      </footer>
    </section>
  </div>;
}

function Employees({rows,controls,onControl}:{rows:Employee[];controls:any[];onControl:(id:string,state:"active"|"paused"|"stopped")=>void}){
  if(!rows.length)return <Empty>No Ledgerly AI employees found.</Empty>;
  return <div className="lai-card-grid">{rows.map(emp=>{
    const control=controls.find(x=>x.scopeType==="agent"&&x.scopeId===emp.id);
    const state=control?.state??"active";
    return <article className="lai-employee-card" key={emp.id}>
      <div className="lai-card-top"><span className="lai-avatar"><Bot size={20}/></span><Pill tone={state}>{state}</Pill></div>
      <h3>{emp.name}</h3><b>{emp.role}</b><p>{emp.description||"Ledgerly AI employee"}</p>
      <div className="lai-tags"><span>{emp.kind??"built-in"}</span><span>{emp.status}</span><span>{emp.key}</span></div>
      <div className="lai-actions">
        <button onClick={()=>onControl(emp.id,"active")}><Play size={13}/> Active</button>
        <button className="warning" onClick={()=>onControl(emp.id,"paused")}><PauseCircle size={13}/> Pause</button>
        <button className="danger ghost" onClick={()=>onControl(emp.id,"stopped")}><XCircle size={13}/> Stop</button>
      </div>
    </article>;
  })}</div>;
}

function CustomAgents({rows,onAction}:{rows:any[];onAction:(id:string,action:"enable"|"disable"|"run")=>void}){
  return <><div className="lai-toolbar"><div><b>Custom AI employees</b><small className="lai-muted">Creation and revisions are guided conversationally by Forge.</small></div><button onClick={()=>{location.hash="agentic-employees-forge";}}><Sparkles size={13}/> Create with Forge</button></div>
  {!rows.length?<Empty>No custom AI employees have been created yet. Use Forge to create one.</Empty>:<div className="lai-table-wrap"><table><thead><tr><th>Agent</th><th>Status</th><th>Version</th><th>Memory</th><th>Updated</th><th>Actions</th></tr></thead>
    <tbody>{rows.map(x=><tr key={x.id}><td><b>{x.name??x.displayName??x.agentKey}</b><small>{x.role}</small></td><td><Pill tone={x.status}>{x.status}</Pill></td>
      <td>{fmt(x.version??x.templateVersion)}</td><td>{fmt(x.memoryScope)}</td><td>{when(x.updatedAt)}</td><td><div className="lai-inline-actions">
        <button onClick={()=>onAction(x.id,"run")}><Play size={12}/> Run</button>
        {x.status==="disabled"?<button onClick={()=>onAction(x.id,"enable")}>Enable</button>:<button className="secondary" onClick={()=>onAction(x.id,"disable")}>Disable</button>}
      </div></td></tr>)}</tbody></table></div>}</>;
}

function Incidents({rows,onAction,onChat}:{rows:Incident[];onAction:(id:string,action:"retry"|"approve"|"reject"|"verify")=>void;onChat:(incident:Incident)=>void}){
  if(!rows.length)return <Empty>No engineering incidents for this organization.</Empty>;
  return <div className="lai-table-wrap"><table><thead><tr><th>Incident</th><th>Severity</th><th>Status</th><th>Engineer</th><th>Occurrences</th><th>Last seen</th><th>Actions</th></tr></thead>
    <tbody>{rows.map(x=><tr key={x.id}><td><b>{x.title}</b><small>{x.id}</small></td><td><Pill tone={x.severity}>{x.severity}</Pill></td><td><Pill tone={x.status}>{x.status}</Pill></td>
      <td>{x.assignedAgentKey??"—"}</td><td>{fmt(x.occurrenceCount)}</td><td>{when(x.lastSeenAt??x.detectedAt)}</td>
      <td><div className="lai-inline-actions">
        {x.teamChatId&&<button className="secondary" onClick={()=>onChat(x)}><MessageSquare size={12}/> Team chat</button>}
        {(x.status==="failed"||x.status==="open")&&<button onClick={()=>onAction(x.id,"retry")}><RefreshCw size={12}/> Retry</button>}
        {x.status==="awaiting_approval"&&<><button onClick={()=>onAction(x.id,"approve")}><CheckCircle2 size={12}/> Approve</button><button className="danger ghost" onClick={()=>onAction(x.id,"reject")}>Reject</button></>}
        {x.status==="deployed"&&<button onClick={()=>onAction(x.id,"verify")}><HeartPulse size={12}/> Verify</button>}
      </div></td></tr>)}</tbody></table></div>;
}

function Jobs({rows}:{rows:any[]}){
  if(!rows.length)return <Empty>No Ledgerly AI jobs found.</Empty>;
  return <div className="lai-table-wrap"><table><thead><tr><th>Job</th><th>Employee</th><th>Status</th><th>Risk</th><th>Duration</th><th>Created</th></tr></thead>
    <tbody>{rows.map(x=><tr key={x.id}><td><b>{x.kind}</b><small>{x.id}</small></td><td>{x.agentName??x.agentId??"Unassigned"}</td>
      <td><Pill tone={x.status}>{x.status}</Pill></td><td><Pill tone={x.riskLevel}>{x.riskLevel}</Pill></td>
      <td>{x.durationMs?Math.round(Number(x.durationMs))+" ms":"—"}</td><td>{when(x.createdAt)}</td></tr>)}</tbody></table></div>;
}

function ActivityRows({rows}:{rows:any[]}){
  if(!rows.length)return <Empty>No recent Ledgerly AI activity.</Empty>;
  return <div className="lai-timeline">{rows.map((x,i)=><article key={x.type+":"+x.entityId+":"+i}>
    <span className={"lai-dot "+cls(x.state)}></span><div><div><Pill tone={x.type}>{x.type}</Pill><b>{x.title}</b><small>{when(x.createdAt)}</small></div>
    <p>{String(x.detail??"").slice(0,900)||x.state}</p><span>{x.correlationId}</span></div>
  </article>)}</div>;
}

function Approvals({rows,onReview}:{rows:Approval[];onReview:(id:string,decision:"approve"|"reject")=>void}){
  if(!rows.length)return <Empty>No pending Ledgerly AI approvals.</Empty>;
  return <div className="lai-card-grid">{rows.map(x=><article className="lai-approval-card" key={x.id}>
    <div className="lai-card-top"><Pill tone={x.riskLevel}>{x.riskLevel}</Pill><Pill tone={x.approvalMode}>{x.approvalMode??"single"}</Pill></div>
    <h3>{x.toolName??x.actionType}</h3><p>{x.actionType}</p>
    <div className="lai-progress"><span style={{width:Math.min(100,100*Number(x.approvalCount??0)/Math.max(1,Number(x.requiredApprovals??1)))+"%"}}/></div>
    <small>{fmt(x.approvalCount??0)} / {fmt(x.requiredApprovals??1)} approvals · {when(x.createdAt)}</small>
    <div className="lai-actions"><button onClick={()=>onReview(x.id,"approve")}><CheckCircle2 size={13}/> Approve</button><button className="danger" onClick={()=>onReview(x.id,"reject")}><XCircle size={13}/> Reject</button></div>
  </article>)}</div>;
}

function Deployments({rows}:{rows:any[]}){
  if(!rows.length)return <Empty>No Ledgerly AI deployment records.</Empty>;
  return <div className="lai-table-wrap"><table><thead><tr><th>Incident</th><th>Environment</th><th>Status</th><th>Ref</th><th>Created</th><th>Verified / rollback</th></tr></thead>
    <tbody>{rows.map(x=><tr key={x.id}><td><b>{x.incidentTitle??x.incidentId}</b><small>{x.incidentId}</small></td><td><Pill tone={x.environment}>{x.environment}</Pill></td>
      <td><Pill tone={x.status}>{x.status}</Pill></td><td>{x.deployedRef??x.imageTag??"—"}</td><td>{when(x.createdAt)}</td><td>{when(x.verifiedAt??x.rolledBackAt)}</td></tr>)}</tbody></table></div>;
}

function MemoryInspector({rows,query,onQuery,onSearch}:{rows:any[];query:string;onQuery:(v:string)=>void;onSearch:()=>void}){
  return <>
    <div className="lai-toolbar"><div className="lai-search"><Search size={15}/><input value={query} onChange={e=>onQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&onSearch()} placeholder="Search memory content, title or source…"/></div><button onClick={onSearch}>Search</button></div>
    {!rows.length?<Empty>No memories matched this query.</Empty>:<div className="lai-memory-grid">{rows.map(x=><article key={x.id}>
      <div className="lai-card-top"><Pill tone={x.scopeType}>{x.scopeType}</Pill><Pill tone={x.status}>{x.status}</Pill></div>
      <h3>{x.title??x.kind??"Memory"}</h3><p>{x.content}</p><small>{x.kind} · importance {fmt(x.importance)} · confidence {fmt(x.confidence)} · {when(x.updatedAt)}</small>
    </article>)}</div>}
  </>;
}

function Tools({rows}:{rows:any[]}){
  if(!rows.length)return <Empty>No tools are visible to this admin session.</Empty>;
  return <div className="lai-table-wrap"><table><thead><tr><th>Tool</th><th>Category</th><th>Risk</th><th>Approval</th><th>Mutation</th><th>Required scopes</th></tr></thead>
    <tbody>{rows.map(x=><tr key={x.name}><td><b>{x.name}</b><small>{x.description}</small></td><td>{x.category}</td><td><Pill tone={x.riskLevel}>{x.riskLevel}</Pill></td>
      <td>{x.approvalRequired?"Declared":"Policy evaluated"}</td><td>{x.mutating?"Yes":"No"}</td><td>{(x.requiredScopes??[]).join(", ")||"—"}</td></tr>)}</tbody></table></div>;
}

function ProviderHealth({value}:{value:any}){
  if(!value)return <Empty>Provider diagnostics have not loaded.</Empty>;
  return <>
    <div className="lai-private-banner"><ShieldCheck size={17}/><div><b>Privileged admin view</b><span>Internal provider identities are intentionally shown only here. Ordinary users interact only with Ledgerly AI and employee names.</span></div></div>
    <section className="lai-stats">
      <Card icon={Activity} title="Active executions" value={value.queue?.active}/>
      <Card icon={Clock3} title="Queued executions" value={value.queue?.queued}/>
      <Card icon={SlidersHorizontal} title="Execution mode" value={value.executionMode}/>
    </section>
    <div className="lai-card-grid">{(value.providers??[]).map((x:any)=><article className="lai-provider-card" key={x.provider??x.name}>
      <div className="lai-card-top"><HeartPulse size={20}/><Pill tone={x.available?"ok":"critical"}>{x.available?"available":"unavailable"}</Pill></div>
      <h3>{x.provider??x.name}</h3><Json value={x}/>
    </article>)}</div>
  </>;
}

function Audit({rows}:{rows:any[]}){
  if(!rows.length)return <Empty>No Ledgerly AI audit records.</Empty>;
  return <div className="lai-table-wrap"><table><thead><tr><th>Time</th><th>Source</th><th>Actor</th><th>Action</th><th>Entity</th><th>Risk</th></tr></thead>
    <tbody>{rows.map(x=><tr key={x.source+":"+x.id}><td>{when(x.createdAt)}</td><td><Pill tone={x.source}>{x.source}</Pill></td>
      <td>{x.actorType}:{x.actorId}</td><td><b>{x.action}</b><small>{x.correlationId}</small></td><td>{x.entityType} · {x.entityId??"—"}</td><td>{x.riskLevel?<Pill tone={x.riskLevel}>{x.riskLevel}</Pill>:"—"}</td></tr>)}</tbody></table></div>;
}

function Usage({value,days,onDays}:{value:any;days:number;onDays:(n:number)=>void}){
  if(!value)return <Empty>Usage metrics have not loaded.</Empty>;
  return <>
    <div className="lai-toolbar"><label>Window <select value={days} onChange={e=>onDays(Number(e.target.value))}><option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label><small>Provider breakdown is restricted to this admin console.</small></div>
    <section className="lai-three">
      <MetricList title="By employee" rows={value.agents??[]} main="jobs"/>
      <MetricList title="By tool" rows={value.tools??[]} main="calls"/>
      <MetricList title="Internal provider performance" rows={value.providers??[]} main="executions"/>
    </section>
    <section className="lai-panel"><div className="lai-panel-title"><div><small>TREND</small><h3>Daily jobs</h3></div></div>
      <div className="lai-bars">{(value.daily??[]).map((x:any)=>{
        const max=Math.max(1,...(value.daily??[]).map((r:any)=>Number(r.jobs??0)));
        return <div key={x.day}><span style={{height:Math.max(4,100*Number(x.jobs??0)/max)+"%"}}/><small>{new Date(x.day).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</small><b>{x.jobs}</b></div>;
      })}</div>
    </section>
  </>;
}
function MetricList({title,rows,main}:{title:string;rows:any[];main:string}){
  return <article className="lai-panel"><div className="lai-panel-title"><div><small>PERFORMANCE</small><h3>{title}</h3></div></div>
    {!rows.length?<p className="lai-muted">No data in this window.</p>:<div className="lai-metric-list">{rows.slice(0,12).map((x:any,i:number)=><div key={(x.label??"row")+i}>
      <span><b>{x.label??"Unassigned"}</b><small>{x.failed??0} failed · {x.averageDurationMs?Math.round(Number(x.averageDurationMs))+" ms avg":"no duration"}</small></span><strong>{fmt(x[main])}</strong>
    </div>)}</div>}
  </article>;
}

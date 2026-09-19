import { useEffect, useMemo, useState } from "react";
import {
  Bot, CheckCircle2, ChevronRight, CircleAlert, Copy, Download,
  FlaskConical, History, MessageSquare, PauseCircle, PlayCircle, Plus,
  RefreshCw, Send, ShieldCheck, Sparkles, Trash2, UserRoundPlus, WandSparkles,
} from "lucide-react";
import { del, errorText, get, post } from "../../../web/api";

type ForgeTrigger={type:"manual"|"schedule"|"event";label:string;schedule?:string|null;eventKey?:string|null;enabled:boolean};
type ForgeSpec={
  name:string;role:string;purpose:string;description:string;responsibilities:string[];capabilities:string[];
  tools:string[];permissions:string[];accessMode:"read_only"|"governed_actions"|"allowed_actions";
  memoryScope:"chat"|"user"|"agent"|"organization"|"project";
  triggers:ForgeTrigger[];
  communications:{enabled:boolean;channels:string[];recipientPolicy:string};
  approvalRules:{mode:"always_for_writes"|"risk_based"|"custom";requireApprovalFor:string[];notes:string};
  tone:{style:string;instructions:string};visibility:"all"|"staff"|"admin";icon:string;
};
type ForgeSession={
  id:string;operation:"create"|"clone"|"revise";status:"collecting"|"review"|"testing"|"ready"|"activated"|"closed";
  spec:ForgeSpec;missingFields:string[];readinessScore:number;proposedAgentId?:string|null;
  sourceAgentId?:string|null;updatedAt:string;lastMessageAt?:string|null;
};
type ForgeMessage={id:string;role:"user"|"assistant"|"system";content:string;createdAt?:string};
type ForgePreview={
  ready:boolean;readinessScore:number;missingFields:string[];
  employee:{name:string;role:string;purpose:string;description:string;responsibilities:string[];capabilities:string[]};
  authority:{accessMode:string;permissions:string[];tools:string[];memoryScope:string;approvalMode:string};
  automation:{triggers:ForgeTrigger[];communications:ForgeSpec["communications"]};
  style:ForgeSpec["tone"];warnings:string[];
};
type BuilderContext={session:ForgeSession;preview:ForgePreview;availableScopes:string[];availableTools:Array<{name:string;description:string;category:string;mutating:boolean;approvalRequired:boolean}>};
type CustomAgent={
  id:string;key:string;name:string;role:string;description:string;status:"draft"|"testing"|"active"|"paused"|"disabled";
  permissions:string[];capabilities:string[];tools:string[];memoryScope:string;visibility:string;currentVersion:number;
  spec:ForgeSpec;updatedAt:string;
};
type SandboxResult={id:string;status:string;prompt:string;response:string};
type Version={id:string;version:number;changeNote?:string|null;createdAt:string};

export function ForgeGlobalAction({activePath}:{activePath:string}){
  return <button
    type="button"
    className={"forge-global-action "+(activePath==="agentic-employees-forge"?"active":"")}
    onClick={()=>{location.hash="agentic-employees-forge";}}
    title="Create a new Ledgerly AI employee"
  ><UserRoundPlus size={17}/><span>Create AI Employee</span></button>;
}

export function ForgeBuilderPage(){
  const[sessions,setSessions]=useState<ForgeSession[]>([]);
  const[agents,setAgents]=useState<CustomAgent[]>([]);
  const[context,setContext]=useState<BuilderContext|null>(null);
  const[messages,setMessages]=useState<ForgeMessage[]>([]);
  const[text,setText]=useState("");
  const[sandboxText,setSandboxText]=useState("Introduce yourself and explain what you can help me with.");
  const[sandbox,setSandbox]=useState<SandboxResult|null>(null);
  const[busy,setBusy]=useState("");
  const[error,setError]=useState("");
  const[versions,setVersions]=useState<Record<string,Version[]>>({});

  const session=context?.session||null;
  const preview=context?.preview||null;
  const activeSessions=useMemo(()=>sessions.filter(item=>item.status!=="closed"),[sessions]);

  async function refreshLists(){
    const[nextSessions,nextAgents]=await Promise.all([
      get<ForgeSession[]>("/ledgerly-ai/forge/sessions"),
      get<CustomAgent[]>("/ledgerly-ai/forge/agents"),
    ]);
    setSessions(nextSessions);setAgents(nextAgents);
    return{nextSessions,nextAgents};
  }

  async function openSession(id:string){
    setBusy("open");setError("");setSandbox(null);
    try{
      const[nextContext,nextMessages]=await Promise.all([
        get<BuilderContext>(`/ledgerly-ai/forge/sessions/${id}`),
        get<ForgeMessage[]>(`/ledgerly-ai/forge/sessions/${id}/messages`),
      ]);
      setContext(nextContext);setMessages(nextMessages);
    }catch(err){setError(errorText(err));}
    finally{setBusy("");}
  }

  async function createSession(){
    setBusy("create");setError("");setSandbox(null);
    try{
      const created=await post<ForgeSession>("/ledgerly-ai/forge/sessions",{});
      await refreshLists();
      await openSession(created.id);
    }catch(err){setError(errorText(err));setBusy("");}
  }

  async function send(){
    if(!session||!text.trim()||busy)return;
    const content=text.trim();setText("");
    const optimistic:ForgeMessage={id:"local-"+Date.now(),role:"user",content};
    setMessages(current=>[...current,optimistic]);setBusy("send");setError("");
    try{
      const result=await post<{message:ForgeMessage;session:ForgeSession;preview:ForgePreview}>(
        `/ledgerly-ai/forge/sessions/${session.id}/messages`,{message:content},
      );
      setMessages(current=>[...current.filter(item=>item.id!==optimistic.id),optimistic,result.message]);
      setContext(current=>current?{...current,session:result.session,preview:result.preview}:current);
      await refreshLists();
    }catch(err){
      setMessages(current=>current.filter(item=>item.id!==optimistic.id));
      setText(content);setError(errorText(err));
    }finally{setBusy("");}
  }

  async function runSandbox(){
    if(!session||!sandboxText.trim()||busy)return;
    setBusy("sandbox");setError("");setSandbox(null);
    try{
      const result=await post<SandboxResult>(`/ledgerly-ai/forge/sessions/${session.id}/sandbox`,{prompt:sandboxText.trim()});
      setSandbox(result);
      const next=await get<BuilderContext>(`/ledgerly-ai/forge/sessions/${session.id}`);
      setContext(next);await refreshLists();
    }catch(err){setError(errorText(err));}
    finally{setBusy("");}
  }

  async function activate(){
    if(!session||busy)return;
    setBusy("activate");setError("");
    try{
      const agent=await post<CustomAgent>(`/ledgerly-ai/forge/sessions/${session.id}/activate`,{});
      await refreshLists();
      const next=await get<BuilderContext>(`/ledgerly-ai/forge/sessions/${session.id}`);
      setContext(next);
      setSandbox(current=>current||{id:"activated",status:"completed",prompt:"",response:`${agent.name} is now active.`});
    }catch(err){setError(errorText(err));}
    finally{setBusy("");}
  }

  async function toggleAgent(agent:CustomAgent){
    setBusy(agent.id);setError("");
    try{
      await post(`/ledgerly-ai/forge/agents/${agent.id}/${agent.status==="disabled"?"enable":"disable"}`,{});
      await refreshLists();
    }catch(err){setError(errorText(err));}
    finally{setBusy("");}
  }

  async function cloneAgent(agent:CustomAgent){
    setBusy(agent.id);setError("");
    try{
      const next=await post<ForgeSession>(`/ledgerly-ai/forge/agents/${agent.id}/clone`,{});
      await refreshLists();await openSession(next.id);
    }catch(err){setError(errorText(err));}
    finally{setBusy("");}
  }

  async function exportAgent(agent:CustomAgent){
    setBusy(agent.id);setError("");
    try{
      const data=await get<Record<string,unknown>>(`/ledgerly-ai/forge/agents/${agent.id}/export`);
      const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download=`${agent.key}.ledgerly-ai.json`;a.click();URL.revokeObjectURL(url);
    }catch(err){setError(errorText(err));}
    finally{setBusy("");}
  }

  async function deleteAgent(agent:CustomAgent){
    if(!confirm(`Delete ${agent.name}? This hides and disables the custom employee but preserves audit history.`))return;
    setBusy(agent.id);setError("");
    try{await del(`/ledgerly-ai/forge/agents/${agent.id}`);await refreshLists();}
    catch(err){setError(errorText(err));}
    finally{setBusy("");}
  }

  async function loadVersions(agent:CustomAgent){
    try{
      const rows=await get<Version[]>(`/ledgerly-ai/forge/agents/${agent.id}/versions`);
      setVersions(current=>({...current,[agent.id]:rows}));
    }catch(err){setError(errorText(err));}
  }

  async function reviseAgent(agent:CustomAgent){
    setBusy(agent.id);setError("");
    try{
      const next=await post<ForgeSession>(`/ledgerly-ai/forge/agents/${agent.id}/revise`,{});
      await refreshLists();await openSession(next.id);
    }catch(err){setError(errorText(err));}
    finally{setBusy("");}
  }

  useEffect(()=>{
    void refreshLists().then(({nextSessions})=>{
      const recent=nextSessions.find(item=>!["activated","closed"].includes(item.status));
      if(recent)void openSession(recent.id);
    }).catch(err=>setError(errorText(err)));
  },[]);

  return <div className="ae-page forge-page">
    <section className="forge-hero">
      <div>
        <span className="ae-kicker"><WandSparkles size={14}/> FORGE · AI EMPLOYEE BUILDER</span>
        <h1>Describe the employee. Forge builds the rest.</h1>
        <p>No raw model or provider setup. Tell Forge the job in normal language; it discovers tools, permissions, memory, approvals, triggers and communication needs within your Ledgerly authority.</p>
      </div>
      <button onClick={()=>void createSession()} disabled={Boolean(busy)}><Plus size={17}/> New AI Employee</button>
    </section>

    {error&&<div className="ae-error"><CircleAlert size={17}/>{error}</div>}

    <div className="forge-layout">
      <aside className="forge-sidebar">
        <div className="forge-sidebar-title"><b>Builder sessions</b><small>{activeSessions.length} saved</small></div>
        {activeSessions.map(item=><button key={item.id} className={session?.id===item.id?"active":""} onClick={()=>void openSession(item.id)}>
          <span className="forge-mini-icon"><Sparkles size={15}/></span>
          <span><b>{item.spec.name||"New AI Employee"}</b><small>{item.spec.role||friendlyStatus(item.status)} · {item.readinessScore}%</small></span>
          <ChevronRight size={15}/>
        </button>)}
        {!activeSessions.length&&<div className="forge-sidebar-empty"><Bot size={24}/><p>No builder sessions yet.</p></div>}
      </aside>

      <main className="forge-main">
        {!session?<div className="forge-empty">
          <div><UserRoundPlus size={34}/></div><h2>Create your first AI employee</h2>
          <p>Examples: “I need an employee who checks lesson-plan submission every Friday,” or “Create a fee follow-up assistant that can draft parent reminders but must ask before sending.”</p>
          <button onClick={()=>void createSession()} disabled={Boolean(busy)}><Plus size={17}/> Start with Forge</button>
        </div>:<>
          <header className="forge-chat-head">
            <div><span>BUILDING</span><h2>{session.spec.name||"Unnamed AI Employee"}</h2><p>{session.spec.role||"Forge is discovering the role"}</p></div>
            <div className="forge-progress"><strong>{session.readinessScore}%</strong><span><i style={{width:`${session.readinessScore}%`}}/></span><small>{friendlyStatus(session.status)}</small></div>
          </header>

          <div className="forge-workbench">
            <section className="forge-conversation">
              <div className="forge-chat">
                {!messages.length&&<div className="forge-welcome">
                  <span><Sparkles size={24}/></span>
                  <h3>Tell Forge what kind of employee you need.</h3>
                  <p>You can start roughly. Forge will ask only the missing questions and build the technical specification privately.</p>
                  <div>
                    {[
                      "Create an academic supervisor who checks lesson delivery and reminds me about gaps.",
                      "I need a fees assistant that analyses arrears and prepares follow-up tasks.",
                      "Build an HR assistant that watches leave and staffing issues but cannot change payroll.",
                    ].map(example=><button key={example} onClick={()=>setText(example)}>{example}</button>)}
                  </div>
                </div>}
                {messages.map(message=><article key={message.id} className={"forge-message "+message.role}>
                  <b>{message.role==="assistant"?"Forge":"You"}</b>
                  <p>{message.content}</p>
                </article>)}
                {busy==="send"&&<article className="forge-message assistant working"><b>Forge</b><p><RefreshCw size={14}/> Designing the employee…</p></article>}
              </div>
              <footer className="forge-composer">
                <textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} placeholder="Describe the job, change a capability, or tell Forge what you want revised…"/>
                <button onClick={()=>void send()} disabled={!text.trim()||Boolean(busy)}><Send size={18}/></button>
              </footer>
            </section>

            <aside className="forge-preview">
              <div className="forge-preview-head"><div><ShieldCheck size={18}/><span><b>Employee preview</b><small>Server-validated authority</small></span></div>{preview?.ready?<CheckCircle2 size={19} className="ok"/>:<CircleAlert size={19}/>}</div>
              <PreviewCard preview={preview}/>
              {preview?.warnings?.length?<div className="forge-warnings">{preview.warnings.map(item=><p key={item}><CircleAlert size={13}/>{item}</p>)}</div>:null}
              <button className="secondary forge-revise" onClick={()=>document.querySelector<HTMLTextAreaElement>(".forge-composer textarea")?.focus()}><MessageSquare size={15}/> Revise with Forge</button>
            </aside>
          </div>

          <section className="forge-sandbox">
            <div className="forge-section-title"><div><FlaskConical size={18}/><span><b>Sandbox conversation</b><small>Required before activation · no real tools execute</small></span></div></div>
            <div className="forge-sandbox-row">
              <input value={sandboxText} onChange={e=>setSandboxText(e.target.value)} placeholder="Test the employee with a realistic question…"/>
              <button onClick={()=>void runSandbox()} disabled={Boolean(busy)||!preview||preview.readinessScore<70}><PlayCircle size={16}/>{busy==="sandbox"?"Testing…":"Run test"}</button>
            </div>
            {sandbox&&<div className="forge-sandbox-result"><b>Sandbox reply</b><p>{sandbox.response}</p></div>}
            <div className="forge-activate-row">
              <span>{session.status==="activated"?"This employee is active.":"Activation requires a complete preview and at least one successful sandbox run."}</span>
              <button onClick={()=>void activate()} disabled={Boolean(busy)||session.status==="activated"||!preview?.ready||!["ready","activated"].includes(session.status)}><CheckCircle2 size={16}/>{busy==="activate"?"Applying…":session.operation==="revise"?"Approve & update":"Approve & activate"}</button>
            </div>
          </section>
        </>}
      </main>
    </div>

    <section className="forge-agents">
      <div className="forge-section-title"><div><Bot size={19}/><span><b>My custom AI employees</b><small>Versioned specifications created through Forge</small></span></div></div>
      {!agents.length?<div className="forge-empty-card"><UserRoundPlus size={25}/><p>No custom employees activated yet.</p></div>:
      <div className="forge-agent-grid">{agents.map(agent=><article key={agent.id} className="forge-agent-card">
        <div className="forge-agent-top"><span>{initials(agent.name)}</span><div><b>{agent.name}</b><small>{agent.role}</small></div><em className={agent.status}>{agent.status}</em></div>
        <p>{agent.description}</p>
        <div className="forge-agent-meta"><span>{agent.tools.length} tools</span><span>{agent.permissions.length} permissions</span><span>v{agent.currentVersion}</span><span>{agent.memoryScope} memory</span></div>
        <div className="forge-agent-actions">
          <button className="secondary" onClick={()=>void reviseAgent(agent)} disabled={busy===agent.id}><RefreshCw size={14}/> Revise with Forge</button>
          <button className="secondary" onClick={()=>void cloneAgent(agent)} disabled={busy===agent.id}><Copy size={14}/> Clone</button>
          <button className="secondary" onClick={()=>void exportAgent(agent)} disabled={busy===agent.id}><Download size={14}/> Export</button>
          <button className="secondary" onClick={()=>void loadVersions(agent)}><History size={14}/> Versions</button>
          <button className="secondary" onClick={()=>void toggleAgent(agent)} disabled={busy===agent.id}>{agent.status==="disabled"?<PlayCircle size={14}/>:<PauseCircle size={14}/>} {agent.status==="disabled"?"Enable":"Disable"}</button>
          <button className="danger" onClick={()=>void deleteAgent(agent)} disabled={busy===agent.id}><Trash2 size={14}/></button>
        </div>
        {versions[agent.id]&&<div className="forge-version-list">{versions[agent.id].slice(0,6).map(version=><div key={version.id}><b>v{version.version}</b><span>{version.changeNote||"Configuration update"}</span><small>{formatWhen(version.createdAt)}</small></div>)}</div>}
      </article>)}</div>}
    </section>
  </div>;
}

function PreviewCard({preview}:{preview:ForgePreview|null}){
  if(!preview)return <div className="forge-preview-empty">Forge will build the preview as you talk.</div>;
  const p=preview.employee;
  return <div className="forge-preview-body">
    <div className="forge-preview-identity"><span>{initials(p.name||"AI")}</span><div><h3>{p.name||"Name not set"}</h3><b>{p.role||"Role not set"}</b></div></div>
    <p>{p.purpose||"Purpose will appear here."}</p>
    <PreviewGroup title="Responsibilities" values={p.responsibilities}/>
    <PreviewGroup title="Capabilities" values={p.capabilities}/>
    <div className="forge-authority-grid">
      <div><small>Access</small><b>{friendlyStatus(preview.authority.accessMode)}</b></div>
      <div><small>Memory</small><b>{friendlyStatus(preview.authority.memoryScope)}</b></div>
      <div><small>Tools</small><b>{preview.authority.tools.length}</b></div>
      <div><small>Permissions</small><b>{preview.authority.permissions.length}</b></div>
      <div><small>Approvals</small><b>{friendlyStatus(preview.authority.approvalMode)}</b></div>
      <div><small>Triggers</small><b>{preview.automation.triggers.filter(x=>x.enabled).length}</b></div>
    </div>
    {preview.missingFields.length?<div className="forge-missing"><small>Still needed</small><div>{preview.missingFields.map(item=><span key={item}>{friendlyStatus(item)}</span>)}</div></div>:null}
  </div>;
}
function PreviewGroup({title,values}:{title:string;values:string[]}){
  if(!values.length)return null;
  return <div className="forge-preview-group"><small>{title}</small><div>{values.slice(0,8).map(item=><span key={item}>{item}</span>)}</div></div>;
}
function initials(value:string){return value.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("")||"AI";}
function friendlyStatus(value:string){return String(value||"").replace(/[_-]+/g," ").replace(/\b\w/g,x=>x.toUpperCase());}
function formatWhen(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString();}

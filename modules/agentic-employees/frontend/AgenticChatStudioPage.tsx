import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3, Bot, Brain, CheckCircle2, ChevronRight, Database, Download, FileDown,
  FileSpreadsheet, FileText, LoaderCircle, MessageSquare, Pencil, Plus, Presentation,
  RefreshCcw, Send, ShieldCheck, Sparkles, X,
} from "lucide-react";
import { downloadFile, errorText, get, patch, post } from "../../../web/api";

type Agent={key:string;name:string;title:string;description:string;modelTier:"luna"|"terra"|"sol";enabled:boolean;configuredTools:string[]};
type Conversation={id:string;agentKey:string;title:string;status:string;lastMessageAt?:string;createdAt?:string};
type Message={id:string;role:"user"|"assistant";content:string;model?:string;createdAt?:string};
type Settings={provider:string;configured:boolean;models:Record<string,string>};
type Action={id:string;agentKey:string;actionType:string;title:string;summary:string;requiredScope:string;status:string;approvalId?:string|null;payload:Record<string,unknown>;resultEntityType?:string|null;resultEntityId?:string|null;failureText?:string|null;createdAt?:string;updatedAt?:string};
type Artifact={id:string;title:string;format:"pdf"|"docx"|"xlsx"|"pptx";sourceMimeType:string;sourceSizeBytes:number;pdfSizeBytes:number;pdfPageCount:number;status:string;createdAt?:string};
type LiveStatus={phase:string;activeTool?:string|null;waitingForApproval:boolean;tools:Array<{id:string;toolName:string;status:string;errorText?:string}>};
type Phase="ready"|"thinking"|"querying_ledgerly"|"analyzing_data"|"checking_memory"|"preparing_approval"|"building_document"|"writing"|"waiting_for_approval"|"validating_edits"|"approving"|"executing"|"creating_pdf"|"creating_xlsx"|"creating_pptx"|"creating_docx";

const AGENT_META:Record<string,{label:string;initials:string;prompts:string[]}>= {
  secretary:{label:"Office & communications",initials:"AS",prompts:["Prepare a professional parent communication", "Create an admissions summary PDF", "What front-office work needs attention?"]},
  dos:{label:"Academics & supervision",initials:"DS",prompts:["Create a professional academic report with tables and charts", "Review lesson-plan compliance", "Compare class attendance and academic performance"]},
  bursar:{label:"Fees & finance",initials:"BF",prompts:["Create a fee collection PDF with tables and charts", "Prepare an XLSX arrears workbook", "Analyze collections and outstanding balances"]},
  headteacher:{label:"Executive management",initials:"HT",prompts:["Create an executive school management PDF", "Prepare a management presentation", "Give me a school-wide evidence-based brief"]},
  hr:{label:"Staff & HR",initials:"HR",prompts:["Create a professional staff report", "Prepare an XLSX workforce summary", "Show staff matters needing follow-up"]},
  librarian:{label:"Books & inventory",initials:"LB",prompts:["Create a professional stock report", "Prepare an XLSX inventory workbook", "Show books that need attention"]},
};

const PHASES:Record<Phase,{label:string;detail:string;icon:ReactNode}>={
  ready:{label:"Ready",detail:"Ask naturally — Ledgerly data and governed actions are available.",icon:<CheckCircle2 size={15}/>},
  thinking:{label:"Thinking",detail:"Understanding your request and deciding what evidence is needed…",icon:<LoaderCircle className="spin" size={15}/>},
  querying_ledgerly:{label:"Querying Ledgerly",detail:"Reading permitted school records and verified metrics…",icon:<Database size={15}/>},
  analyzing_data:{label:"Analyzing",detail:"Comparing verified records and calculating the response structure…",icon:<BarChart3 size={15}/>},
  checking_memory:{label:"Checking memory",detail:"Reviewing relevant working and institutional context…",icon:<Brain size={15}/>},
  preparing_approval:{label:"Preparing approval",detail:"Building a governed action for your review in this chat…",icon:<ShieldCheck size={15}/>},
  building_document:{label:"Building document",detail:"Structuring tables, charts and professional report content…",icon:<FileText size={15}/>},
  writing:{label:"Writing",detail:"Composing the final response from verified evidence…",icon:<Sparkles size={15}/>},
  waiting_for_approval:{label:"Waiting for approval",detail:"Review or edit the proposed action below before it runs.",icon:<ShieldCheck size={15}/>},
  validating_edits:{label:"Validating edits",detail:"Checking your edited proposal before approval…",icon:<Pencil size={15}/>},
  approving:{label:"Approving",detail:"Recording your approval with the existing Ledgerly controls…",icon:<ShieldCheck size={15}/>},
  executing:{label:"Executing",detail:"Ledgerly is rechecking permission and applying the approved action…",icon:<LoaderCircle className="spin" size={15}/>},
  creating_pdf:{label:"Creating PDF",detail:"Rendering the approved report with professional pagination, tables and charts…",icon:<FileText size={15}/>},
  creating_xlsx:{label:"Creating Excel workbook",detail:"Building structured sheets, filters, widths and chart data…",icon:<FileSpreadsheet size={15}/>},
  creating_pptx:{label:"Creating presentation",detail:"Building a professional black-font presentation with tables and charts…",icon:<Presentation size={15}/>},
  creating_docx:{label:"Creating document",detail:"Rendering the approved professional document…",icon:<FileText size={15}/>},
};

export function AgenticChatStudioPage(){
  const[agents,setAgents]=useState<Agent[]>([]),[conversations,setConversations]=useState<Conversation[]>([]),[conversation,setConversation]=useState<Conversation|null>(null);
  const[selected,setSelected]=useState("headteacher"),[messages,setMessages]=useState<Message[]>([]),[actions,setActions]=useState<Action[]>([]),[artifacts,setArtifacts]=useState<Artifact[]>([]);
  const[settings,setSettings]=useState<Settings|null>(null),[text,setText]=useState(""),[busy,setBusy]=useState(false),[phase,setPhase]=useState<Phase>("ready"),[error,setError]=useState("");
  const[actionBusy,setActionBusy]=useState(""),[editing,setEditing]=useState(""),[drafts,setDrafts]=useState<Record<string,string>>({});
  const agent=useMemo(()=>agents.find(item=>item.key===selected)||agents[0],[agents,selected]);
  const meta=agent?(AGENT_META[agent.key]||{label:"Ledgerly AI employee",initials:"AI",prompts:["What needs attention today?"]}):AGENT_META.headteacher;
  const pending=useMemo(()=>actions.filter(item=>["suggested","prepared","awaiting_approval","approved"].includes(item.status)),[actions]);

  useEffect(()=>{void bootstrap();},[]);

  async function bootstrap(){
    setError("");
    try{
      const[nextAgents,nextConversations,nextSettings]=await Promise.all([get<Agent[]>("/agentic-employees/agents"),get<Conversation[]>("/agentic-employees/conversations"),get<Settings>("/agentic-employees/settings")]);
      setAgents(nextAgents);setConversations(nextConversations);setSettings(nextSettings);
      const first=nextConversations[0];
      if(first){setSelected(first.agentKey);await loadConversation(first);}else if(nextAgents.length)setSelected(nextAgents.find(a=>a.key==="headteacher")?.key||nextAgents[0].key);
    }catch(err){setError(errorText(err));}
  }

  async function loadSidecars(id:string){
    const[nextActions,nextArtifacts]=await Promise.all([get<Action[]>(`/agentic-employees/chat-studio/conversations/${id}/actions`),get<Artifact[]>(`/agentic-employees/chat-studio/conversations/${id}/artifacts`)]);
    setActions(nextActions);setArtifacts(nextArtifacts);
    setDrafts(current=>{const next={...current};for(const action of nextActions)if(next[action.id]===undefined)next[action.id]=JSON.stringify(action.payload,null,2);return next;});
    return nextActions;
  }

  async function loadConversation(next:Conversation){
    setBusy(true);setError("");setSelected(next.agentKey);setConversation(next);setPhase("thinking");
    try{const history=await get<Message[]>(`/agentic-employees/conversations/${next.id}/messages`);setMessages(history);const nextActions=await loadSidecars(next.id);setPhase(nextActions.some(a=>["suggested","prepared","awaiting_approval","approved"].includes(a.status))?"waiting_for_approval":"ready");}
    catch(err){setError(errorText(err));setPhase("ready");}finally{setBusy(false);}
  }

  function latestFor(agentKey:string){return conversations.filter(c=>c.agentKey===agentKey).sort((a,b)=>String(b.lastMessageAt||b.createdAt||"").localeCompare(String(a.lastMessageAt||a.createdAt||"")))[0];}
  async function openAgent(next:Agent,forceNew=false){
    setSelected(next.key);setError("");
    const existing=!forceNew?latestFor(next.key):undefined;if(existing){await loadConversation(existing);return;}
    setBusy(true);setPhase("thinking");
    try{const created=await post<Conversation>("/agentic-employees/conversations",{agentKey:next.key,title:next.title});setConversations(current=>[created,...current]);setConversation(created);setMessages([]);setActions([]);setArtifacts([]);setPhase("ready");}
    catch(err){setError(errorText(err));setPhase("ready");}finally{setBusy(false);}
  }

  async function pollStatus(id:string){
    try{const status=await get<LiveStatus>(`/agentic-employees/chat-studio/conversations/${id}/status`);if(status.activeTool||status.waitingForApproval)setPhase((status.phase in PHASES?status.phase:"analyzing_data") as Phase);}catch{/* The message request remains authoritative. */}
  }

  async function send(){
    if(!conversation||!text.trim()||busy)return;const content=text.trim();setText("");setError("");setBusy(true);setPhase("thinking");
    const optimistic:Message={id:`local-${Date.now()}`,role:"user",content,createdAt:new Date().toISOString()};setMessages(current=>[...current,optimistic]);
    const timer=window.setInterval(()=>void pollStatus(conversation.id),700);
    try{
      const message=await post<Message>(`/agentic-employees/conversations/${conversation.id}/messages`,{content});setPhase("writing");setMessages(current=>[...current,message]);
      const nextActions=await loadSidecars(conversation.id);const nextConversations=await get<Conversation[]>("/agentic-employees/conversations");setConversations(nextConversations);
      setPhase(nextActions.some(a=>["suggested","prepared","awaiting_approval","approved"].includes(a.status))?"waiting_for_approval":"ready");
    }catch(err){setMessages(current=>current.filter(item=>item.id!==optimistic.id));setError(errorText(err));setPhase("ready");}finally{window.clearInterval(timer);setBusy(false);}
  }

  function parseDraft(action:Action){try{const value=JSON.parse(drafts[action.id]||"{}");if(!value||typeof value!=="object"||Array.isArray(value))throw new Error();return value as Record<string,unknown>;}catch{throw new Error("The edited approval details must be valid JSON.");}}
  async function saveEdits(action:Action){
    setActionBusy(action.id);setError("");setPhase("validating_edits");
    try{const payload=parseDraft(action);const updated=await patch<Action>(`/agentic-employees/chat-studio/actions/${action.id}/payload`,{payload});setActions(current=>current.map(item=>item.id===updated.id?updated:item));setDrafts(current=>({...current,[updated.id]:JSON.stringify(updated.payload,null,2)}));setEditing("");setPhase("waiting_for_approval");return updated;}
    catch(err){setError(errorText(err));setPhase("waiting_for_approval");throw err;}finally{setActionBusy("");}
  }

  function creationPhase(action:Action):Phase{if(action.actionType!=="document.generate")return"executing";const format=String(action.payload.format||"").toLowerCase();return format==="pdf"?"creating_pdf":format==="xlsx"?"creating_xlsx":format==="pptx"?"creating_pptx":"creating_docx";}
  async function approveAndRun(original:Action){
    if(actionBusy)return;setActionBusy(original.id);setError("");
    try{
      let action=original;
      if(action.status==="suggested"&&drafts[action.id]!==JSON.stringify(action.payload,null,2)){setPhase("validating_edits");const payload=parseDraft(action);action=await patch<Action>(`/agentic-employees/chat-studio/actions/${action.id}/payload`,{payload});}
      if(action.status==="suggested"){setPhase("approving");action=await post<Action>(`/agentic-employees/actions/${action.id}/prepare`,{});}
      if(action.status==="prepared"){setPhase("approving");action=await post<Action>(`/agentic-employees/actions/${action.id}/request-approval`,{});}
      if(action.status==="awaiting_approval"){setPhase("approving");action=await post<Action>(`/agentic-employees/actions/${action.id}/review`,{decision:"approve",note:"Approved in AI Chat Studio"});}
      if(action.status==="approved"){setPhase(creationPhase(action));await post(`/agentic-employees/actions/${action.id}/execute`,{});}
      if(conversation){const next=await loadSidecars(conversation.id);setPhase(next.some(a=>["suggested","prepared","awaiting_approval","approved"].includes(a.status))?"waiting_for_approval":"ready");}
    }catch(err){setError(errorText(err));setPhase("waiting_for_approval");}finally{setActionBusy("");}
  }

  async function rejectAction(action:Action){
    if(actionBusy)return;setActionBusy(action.id);setError("");setPhase("executing");
    try{if(action.status==="awaiting_approval")await post(`/agentic-employees/actions/${action.id}/review`,{decision:"reject",note:"Rejected in AI Chat Studio"});else await post(`/agentic-employees/actions/${action.id}/dismiss`,{});if(conversation){const next=await loadSidecars(conversation.id);setPhase(next.some(a=>["suggested","prepared","awaiting_approval","approved"].includes(a.status))?"waiting_for_approval":"ready");}}
    catch(err){setError(errorText(err));setPhase("waiting_for_approval");}finally{setActionBusy("");}
  }

  async function downloadArtifact(item:Artifact,pdf=false){
    try{const ext=pdf?"pdf":item.format;await downloadFile(`/agentic-employees/documents/${item.id}/${pdf?"pdf":"source"}`,`${safeFileName(item.title)}.${ext}`);}catch(err){setError(errorText(err));}
  }

  function quickArtifact(format:"pdf"|"xlsx"|"pptx"){const label=format==="pdf"?"PDF report":format==="xlsx"?"Excel workbook":"PowerPoint presentation";setText(`Create a professional ${label} for me. Use a clean white background and professional black/dark text unless I specify otherwise. Include useful tables and charts where the verified Ledgerly data supports them. `);}

  return <div className="acs-page">
    <aside className="acs-sidebar">
      <div className="acs-brand"><span className="acs-logo"><Sparkles size={18}/></span><div><b>Ledgerly AI</b><small>Chat Studio</small></div><button title="New conversation" disabled={!agent} onClick={()=>agent&&void openAgent(agent,true)}><Plus size={17}/></button></div>
      <div className="acs-provider"><span className={settings?.configured?"online":"offline"}/><div><b>{settings?.configured?"AI online":"Provider setup needed"}</b><small>{settings?.provider||"AI provider"}</small></div></div>
      <div className="acs-side-label">AI EMPLOYEES</div>
      <div className="acs-agent-list">{agents.map(item=>{const m=AGENT_META[item.key]||{label:item.title,initials:"AI",prompts:[]};return <button key={item.key} className={item.key===selected?"active":""} disabled={!item.enabled} onClick={()=>void openAgent(item)}><span className="acs-avatar">{m.initials}</span><span><b>{item.name}</b><small>{m.label}</small></span><em>{item.modelTier.toUpperCase()}</em></button>;})}</div>
      <div className="acs-side-label acs-thread-heading"><span>RECENT CHATS</span><button onClick={()=>void bootstrap()} title="Refresh"><RefreshCcw size={13}/></button></div>
      <div className="acs-thread-list">{conversations.slice(0,12).map(item=><button key={item.id} className={conversation?.id===item.id?"active":""} onClick={()=>void loadConversation(item)}><MessageSquare size={14}/><span><b>{item.title}</b><small>{formatWhen(item.lastMessageAt||item.createdAt)}</small></span></button>)}</div>
    </aside>

    <main className="acs-main">
      <header className="acs-header">
        <div className="acs-agent-title"><span className="acs-avatar large">{meta.initials}</span><div><span>{meta.label.toUpperCase()}</span><h1>{agent?.name||"Ledgerly AI"}</h1><p>{agent?.title||"AI employee"} · {agent?.configuredTools.length||0} permitted tools</p></div></div>
        <div className={`acs-live ${phase!=="ready"?"working":""}`}>{PHASES[phase].icon}<div><b>{PHASES[phase].label}</b><span>{PHASES[phase].detail}</span></div></div>
      </header>
      {error&&<div className="acs-error"><span>{error}</span><button onClick={()=>setError("")}><X size={15}/></button></div>}

      <section className="acs-chat">
        {!conversation&&<div className="acs-empty"><Bot size={34}/><h2>Choose an AI employee</h2><p>Start a conversation and work naturally with permitted Ledgerly data, professional files and inline approvals.</p></div>}
        {conversation&&messages.length===0&&<div className="acs-welcome"><span className="acs-avatar hero">{meta.initials}</span><h2>What should {agent?.name} work on?</h2><p>Ask naturally. Reports can include professional tables, charts, PDF, Excel and presentations.</p><div className="acs-starters">{meta.prompts.map(prompt=><button key={prompt} onClick={()=>setText(prompt)}>{prompt}<ChevronRight size={14}/></button>)}</div></div>}
        {messages.map(message=><article key={message.id} className={`acs-message ${message.role}`}><div className="acs-message-meta"><b>{message.role==="user"?"You":agent?.name||"Ledgerly AI"}</b><span>{formatWhen(message.createdAt)}</span></div><div className="acs-message-body"><RichContent content={message.content}/></div>{message.model&&<small className="acs-model">{message.model}</small>}</article>)}
        {busy&&<article className="acs-message assistant acs-thinking"><div className="acs-message-meta"><b>{agent?.name||"Ledgerly AI"}</b></div><div className="acs-thinking-line">{PHASES[phase].icon}<span>{PHASES[phase].label}…</span></div><small>{PHASES[phase].detail}</small></article>}

        {pending.map(action=><ApprovalCard key={action.id} action={action} draft={drafts[action.id]||JSON.stringify(action.payload,null,2)} editing={editing===action.id} busy={actionBusy===action.id} onEdit={()=>setEditing(current=>current===action.id?"":action.id)} onDraft={value=>setDrafts(current=>({...current,[action.id]:value}))} onSave={()=>void saveEdits(action).catch(()=>{})} onApprove={()=>void approveAndRun(action)} onReject={()=>void rejectAction(action)}/>)}

        {artifacts.length>0&&<div className="acs-artifact-zone"><div className="acs-zone-title"><FileDown size={16}/><span>FILES CREATED IN THIS CHAT</span></div>{artifacts.map(item=><ArtifactCard key={item.id} item={item} onDownload={()=>void downloadArtifact(item,false)} onPdf={()=>void downloadArtifact(item,true)}/>)}</div>}
      </section>

      {conversation&&<footer className="acs-composer-wrap">
        <div className="acs-quick"><button onClick={()=>quickArtifact("pdf")}><FileText size={14}/> PDF report</button><button onClick={()=>quickArtifact("xlsx")}><FileSpreadsheet size={14}/> Excel</button><button onClick={()=>quickArtifact("pptx")}><Presentation size={14}/> Presentation</button><button onClick={()=>setText("Analyze this using verified Ledgerly data and show the comparison in a clear table: ")}><BarChart3 size={14}/> Analyze</button></div>
        <div className="acs-composer"><textarea value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}} placeholder={`Message ${agent?.name||"Ledgerly AI"}…`} rows={2}/><button disabled={busy||!text.trim()} onClick={()=>void send()}><Send size={18}/><span>Send</span></button></div>
        <div className="acs-composer-note"><ShieldCheck size={12}/> AI writes remain governed: proposed changes appear here for review, editing and approval before execution.</div>
      </footer>}
    </main>
  </div>;
}

function ApprovalCard({action,draft,editing,busy,onEdit,onDraft,onSave,onApprove,onReject}:{action:Action;draft:string;editing:boolean;busy:boolean;onEdit:()=>void;onDraft:(value:string)=>void;onSave:()=>void;onApprove:()=>void;onReject:()=>void}){
  const isDocument=action.actionType==="document.generate",format=isDocument?String(action.payload.format||"").toUpperCase():"";
  return <div className="acs-approval"><div className="acs-approval-head"><span className="acs-approval-icon"><ShieldCheck size={18}/></span><div><span>REVIEW BEFORE LEDGERLY ACTS</span><h3>{action.title}</h3><p>{action.summary}</p></div><em>{friendly(action.status)}</em></div>
    <div className="acs-approval-facts"><span><b>Action</b>{friendly(action.actionType)}</span><span><b>Permission</b>{action.requiredScope}</span>{isDocument&&<span><b>Output</b>{format}</span>}</div>
    {isDocument&&<DocumentPreview payload={action.payload}/>} 
    {editing&&<div className="acs-editor"><div><b>Edit proposed details</b><span>Changes are validated again before approval. Protected route/method boundaries cannot be changed.</span></div><textarea value={draft} onChange={e=>onDraft(e.target.value)} rows={Math.min(18,Math.max(8,draft.split("\n").length))}/><button disabled={busy} onClick={onSave}><CheckCircle2 size={15}/> Save edits</button></div>}
    {action.failureText&&<div className="acs-action-error">{action.failureText}</div>}
    <div className="acs-approval-actions"><button className="secondary" disabled={busy} onClick={onEdit}><Pencil size={15}/>{editing?"Close editor":"Edit before approval"}</button><div><button className="danger-quiet" disabled={busy} onClick={onReject}>Reject</button><button className="approve" disabled={busy} onClick={onApprove}>{busy?<LoaderCircle className="spin" size={15}/>:<ShieldCheck size={15}/>}Approve & run</button></div></div>
  </div>;
}

function DocumentPreview({payload}:{payload:Record<string,unknown>}){const spec=(payload.spec&&typeof payload.spec==="object"&&!Array.isArray(payload.spec)?payload.spec:{}) as Record<string,unknown>;const summary=String(spec.summary||"");const sections=Array.isArray(spec.sections)?spec.sections.length:0,tables=Array.isArray(spec.tables)?spec.tables.length:0,charts=Array.isArray(spec.charts)?spec.charts.length:0;return <div className="acs-document-preview"><div><FileText size={16}/><span><b>{String(payload.title||"Professional report")}</b><small>{String(payload.format||"").toUpperCase()} · professional black/dark text default</small></span></div>{summary&&<p>{summary.slice(0,260)}{summary.length>260?"…":""}</p>}<div className="acs-doc-metrics"><span>{sections} sections</span><span>{tables} tables</span><span>{charts} charts</span></div></div>}

function ArtifactCard({item,onDownload,onPdf}:{item:Artifact;onDownload:()=>void;onPdf:()=>void}){const icon=item.format==="xlsx"?<FileSpreadsheet/>:item.format==="pptx"?<Presentation/>:<FileText/>;return <div className="acs-artifact"><span className="acs-file-icon">{icon}</span><div><b>{item.title}</b><small>{item.format.toUpperCase()} · {item.pdfPageCount||1} PDF page{item.pdfPageCount===1?"":"s"} · {formatBytes(item.sourceSizeBytes)}</small></div><div className="acs-file-actions"><button onClick={onDownload}><Download size={14}/>Download {item.format.toUpperCase()}</button>{item.format!=="pdf"&&<button className="secondary" onClick={onPdf}><FileText size={14}/>PDF preview</button>}</div></div>}

function RichContent({content}:{content:string}){
  const lines=content.replace(/\r/g,"").split("\n"),nodes:ReactNode[]=[];let i=0;
  while(i<lines.length){const line=lines[i];if(!line.trim()){i++;continue;}
    if(line.includes("|")&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])){const headers=splitTable(line);i+=2;const rows:string[][]=[];while(i<lines.length&&lines[i].includes("|")&&lines[i].trim()){rows.push(splitTable(lines[i]));i++;}nodes.push(<div className="acs-table-wrap" key={`t-${i}`}><table><thead><tr>{headers.map((h,j)=><th key={j}>{h}</th>)}</tr></thead><tbody>{rows.map((row,r)=><tr key={r}>{row.map((cell,c)=><td key={c}>{cell}</td>)}</tr>)}</tbody></table></div>);continue;}
    if(/^#{1,3}\s/.test(line)){const level=(line.match(/^#+/)?.[0].length||1),value=line.replace(/^#{1,3}\s*/,"");nodes.push(level===1?<h2 key={i}>{value}</h2>:<h3 key={i}>{value}</h3>);i++;continue;}
    if(/^[-*•]\s+/.test(line)){const items:string[]=[];while(i<lines.length&&/^[-*•]\s+/.test(lines[i])){items.push(lines[i].replace(/^[-*•]\s+/,""));i++;}nodes.push(<ul key={`u-${i}`}>{items.map((item,j)=><li key={j}>{inline(item)}</li>)}</ul>);continue;}
    if(/^\d+[.)]\s+/.test(line)){const items:string[]=[];while(i<lines.length&&/^\d+[.)]\s+/.test(lines[i])){items.push(lines[i].replace(/^\d+[.)]\s+/,""));i++;}nodes.push(<ol key={`o-${i}`}>{items.map((item,j)=><li key={j}>{inline(item)}</li>)}</ol>);continue;}
    const paragraph:string[]=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^#{1,3}\s/.test(lines[i])&&!/^[-*•]\s+/.test(lines[i])&&!/^\d+[.)]\s+/.test(lines[i])&&!(lines[i].includes("|")&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1]))){paragraph.push(lines[i]);i++;}nodes.push(<p key={`p-${i}`}>{inline(paragraph.join(" "))}</p>);
  }
  return <>{nodes}</>;
}
function splitTable(line:string){return line.trim().replace(/^\||\|$/g,"").split("|").map(value=>value.trim());}
function inline(value:string){const parts=value.split(/(\*\*[^*]+\*\*)/g);return <>{parts.map((part,i)=>part.startsWith("**")&&part.endsWith("**")?<strong key={i}>{part.slice(2,-2)}</strong>:part)}</>;}
function friendly(value:string){return value.replace(/[._-]+/g," ").replace(/\b\w/g,x=>x.toUpperCase());}
function safeFileName(value:string){return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,120)||"ledgerly-report";}
function formatBytes(value:number){if(!Number.isFinite(value)||value<=0)return"file";if(value<1024)return`${value} B`;if(value<1024*1024)return`${(value/1024).toFixed(1)} KB`;return`${(value/1024/1024).toFixed(1)} MB`;}
function formatWhen(value?:string){if(!value)return"now";const date=new Date(value);if(Number.isNaN(date.getTime()))return value;const diff=Date.now()-date.getTime();if(diff<60_000)return"now";if(diff<3_600_000)return`${Math.max(1,Math.floor(diff/60_000))}m`;if(diff<86_400_000)return`${Math.floor(diff/3_600_000)}h`;return date.toLocaleDateString();}

import {
  useEffect,useMemo,useRef,useState,type ChangeEvent,type ReactNode
} from "react";
import {
  Archive,AtSign,Bell,BellRing,Bot,Brain,CheckCircle2,ChevronRight,
  CircleAlert,FileText,History,MessageSquare,Paperclip,Plus,RefreshCw,
  Search,Send,ShieldCheck,Sparkles,UserRound,Users,Wrench,X,XCircle
} from "lucide-react";
import { errorText,get,post } from "../../../web/api";
import "./ledgerly-ai-workspace.css";

type Employee={
  id:string;key:string;name:string;role:string;description:string;icon?:string|null;
  capabilities?:string[];memoryScope?:string;status:string;
};
type Chat={
  id:string;title:string;agentId?:string|null;status:"active"|"archived";
  lastMessageAt?:string|null;createdAt?:string;metadata?:Record<string,unknown>;
};
type Approval={
  id:string;toolCallId:string;toolName:string;riskLevel:string;status:"pending";
  approvalMode?:string;requiredApprovals?:number;
};
type Message={
  id:string;role:"system"|"user"|"assistant"|"tool";content:string;createdAt?:string;
  metadata?:Record<string,any>;
};
type Job={
  id:string;kind:string;status:string;riskLevel?:string;agentId?:string|null;agentName?:string|null;
  chatId?:string|null;error?:string|null;result?:Record<string,unknown>|null;
  startedAt?:string|null;completedAt?:string|null;createdAt?:string;updatedAt?:string;
};
type Attachment={
  id:string;name:string;mimeType:string;content:string;kind:"file"|"context";
};
type Toast={id:string;tone:"ok"|"bad"|"info";title:string;detail:string};

const ACCEPTED:Record<string,string>={
  "text/plain":"Text","text/markdown":"Markdown","text/csv":"CSV",
  "application/json":"JSON","application/xml":"XML","text/xml":"XML",
};

function when(value:unknown){
  if(!value)return "";
  const date=new Date(String(value));
  return Number.isNaN(date.getTime())?"":date.toLocaleString();
}
function initials(name:string){
  return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("")||"AI";
}
function short(value:string,max=100){
  const x=value.replace(/\s+/g," ").trim();
  return x.length>max?x.slice(0,max-1)+"…":x;
}
function tone(status:unknown){
  const s=String(status??"").toLowerCase();
  if(["completed","succeeded","active","ok","verified","approved"].includes(s))return"ok";
  if(["failed","rejected","cancelled","critical","error"].includes(s))return"bad";
  if(["running","queued","waiting_approval","pending"].includes(s))return"working";
  return"neutral";
}
function Badge({children,value}:{children:ReactNode;value?:unknown}){
  return <span className={"laiu-badge "+tone(value??children)}>{children}</span>;
}

export function AskLedgerlyAiAction({activePath}:{activePath:string}){
  return <button
    type="button"
    className={"laiu-global-ask "+(activePath==="ledgerly-ai-ask"?"active":"")}
    onClick={()=>{location.hash="ledgerly-ai-ask";}}
    title="Ask Ledgerly AI"
  ><Sparkles size={17}/><span>Ask Ledgerly AI</span></button>;
}

export function LedgerlyAiWorkspacePage(){
  const[employees,setEmployees]=useState<Employee[]>([]);
  const[chats,setChats]=useState<Chat[]>([]);
  const[chatId,setChatId]=useState<string|null>(null);
  const[messages,setMessages]=useState<Message[]>([]);
  const[employeeId,setEmployeeId]=useState("");
  const[text,setText]=useState("");
  const[search,setSearch]=useState("");
  const[view,setView]=useState<"chat"|"employees"|"history">("chat");
  const[attachments,setAttachments]=useState<Attachment[]>([]);
  const[contextText,setContextText]=useState("");
  const[showContext,setShowContext]=useState(false);
  const[busy,setBusy]=useState(false);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState("");
  const[lastFailed,setLastFailed]=useState<null|{
    message:string;chatId:string|null;employeeId:string;attachments:Attachment[];requestKey:string;
  }>(null);
  const[pendingApproval,setPendingApproval]=useState<Approval|null>(null);
  const[jobs,setJobs]=useState<Job[]>([]);
  const[toasts,setToasts]=useState<Toast[]>([]);
  const[jobStates]=useRef<Map<string,string>>(new Map());
  const[jobsReady]=useRef(false);
  const[fileRef]=useRef<HTMLInputElement|null>(null);

  const currentEmployee=useMemo(()=>employees.find(x=>x.id===employeeId)??null,[employees,employeeId]);
  const currentChat=useMemo(()=>chats.find(x=>x.id===chatId)??null,[chats,chatId]);
  const filteredChats=useMemo(()=>{
    const q=search.trim().toLowerCase();
    if(!q)return chats;
    return chats.filter(chat=>{
      const emp=employees.find(e=>e.id===chat.agentId);
      return [chat.title,emp?.name,emp?.role].some(v=>String(v??"").toLowerCase().includes(q));
    });
  },[chats,employees,search]);
  const myEmployees=useMemo(()=>employees.filter(x=>x.status==="active"),[employees]);
  const workingJobs=jobs.filter(x=>["queued","running","waiting_approval"].includes(x.status));

  function toast(next:Omit<Toast,"id">){
    const item={...next,id:String(Date.now())+Math.random().toString(36).slice(2)};
    setToasts(current=>[item,...current].slice(0,4));
    window.setTimeout(()=>setToasts(current=>current.filter(x=>x.id!==item.id)),6000);
  }

  async function loadBase(){
    setLoading(true);setError("");
    try{
      const[employeeRows,chatRows]=await Promise.all([
        get<Employee[]>("/ledgerly-ai/employees"),
        get<Chat[]>("/ledgerly-ai/my/chats"),
      ]);
      setEmployees(employeeRows);setChats(chatRows);
      if(employeeId&&!employeeRows.some(x=>x.id===employeeId))setEmployeeId("");
    }catch(err){setError(errorText(err));}
    finally{setLoading(false);}
  }

  async function loadChat(id:string){
    setLoading(true);setError("");setPendingApproval(null);
    try{
      const[detail,userJobs]=await Promise.all([
        get<any>("/ledgerly-ai/my/chats/"+id),
        get<Job[]>("/ledgerly-ai/my/jobs?limit=100"),
      ]);
      setChatId(id);setMessages(detail.messages??[]);
      setEmployeeId(detail.agentId??"");
      setJobs(userJobs);
      const waiting=userJobs.find(job=>job.chatId===id&&job.status==="waiting_approval"&&job.result);
      const result=waiting?.result as Record<string,any>|null|undefined;
      if(waiting&&result?.approvalId){
        setPendingApproval({
          id:String(result.approvalId),toolCallId:String(result.toolCallId??""),
          toolName:String(result.toolName??"Ledgerly action"),riskLevel:String(result.riskLevel??waiting.riskLevel??"medium"),
          status:"pending",approvalMode:result.approvalMode?String(result.approvalMode):undefined,
          requiredApprovals:result.requiredApprovals?Number(result.requiredApprovals):undefined,
        });
      }
      setView("chat");
    }catch(err){setError(errorText(err));}
    finally{setLoading(false);}
  }

  async function refreshChats(){
    const rows=await get<Chat[]>("/ledgerly-ai/my/chats");
    setChats(rows);
  }

  async function refreshOpenChat(id:string){
    try{
      const detail=await get<any>("/ledgerly-ai/my/chats/"+id);
      setMessages(detail.messages??[]);
      setEmployeeId(detail.agentId??"");
    }catch{/* live chat refresh should not interrupt typing */}
  }

  async function pollJobs(){
    try{
      const rows=await get<Job[]>("/ledgerly-ai/my/jobs?limit=60");
      if(jobsReady.current){
        for(const job of rows){
          const before=jobStates.current.get(job.id);
          if(before&&["queued","running","waiting_approval"].includes(before)&&["completed","failed","cancelled"].includes(job.status)){
            const success=job.status==="completed";
            const title=success
              ? (job.agentName?job.agentName+" finished":"Ledgerly AI task finished")
              : (job.agentName?job.agentName+" needs attention":"Ledgerly AI task needs attention");
            const detail=success?"Your Ledgerly AI task has completed.":job.error||"The task did not complete.";
            toast({tone:success?"ok":"bad",title,detail});
            if("Notification"in window&&Notification.permission==="granted"){
              new Notification(title,{body:detail});
            }
          }
        }
      }
      jobStates.current=new Map(rows.map(x=>[x.id,x.status]));
      jobsReady.current=true;setJobs(rows);
    }catch{/* task polling should never interrupt chat */}
  }

  useEffect(()=>{void loadBase();void pollJobs();},[]);
  useEffect(()=>{
    const timer=window.setInterval(()=>void pollJobs(),12000);
    return()=>window.clearInterval(timer);
  },[]);
  useEffect(()=>{
    if(!chatId)return;
    const timer=window.setInterval(()=>void refreshOpenChat(chatId),1200);
    return()=>window.clearInterval(timer);
  },[chatId]);

  async function enableNotifications(){
    if(!("Notification"in window)){toast({tone:"info",title:"Browser notifications unavailable",detail:"This browser does not support desktop notifications."});return;}
    const result=await Notification.requestPermission();
    toast({
      tone:result==="granted"?"ok":"info",
      title:result==="granted"?"Notifications enabled":"Notifications not enabled",
      detail:result==="granted"?"Ledgerly AI can tell you when longer tasks finish.":"You can still see task updates inside Ledgerly.",
    });
  }

  function newChat(id?:string){
    setChatId(null);setMessages([]);setEmployeeId(id??"");setText("");setPendingApproval(null);
    setAttachments([]);setContextText("");setShowContext(false);setError("");setLastFailed(null);setView("chat");
  }

  async function archiveCurrent(){
    if(!chatId)return;
    try{
      await post("/ledgerly-ai/my/chats/"+chatId+"/archive",{});
      await refreshChats();newChat();
      toast({tone:"ok",title:"Chat archived",detail:"The conversation remains saved in your chat history."});
    }catch(err){setError(errorText(err));}
  }

  async function fileChanged(event:ChangeEvent<HTMLInputElement>){
    const selected=Array.from(event.target.files??[]);
    event.target.value="";
    if(!selected.length)return;
    if(attachments.length+selected.length>5){
      setError("You can attach up to 5 items to one Ledgerly AI message.");return;
    }
    const next:Attachment[]=[];
    for(const file of selected){
      const mime=file.type||guessMime(file.name);
      if(!ACCEPTED[mime]){
        setError(file.name+" is not a supported text attachment. Use TXT, Markdown, CSV, JSON or XML.");return;
      }
      if(file.size>60000){
        setError(file.name+" is too large. Each text attachment must be about 60 KB or less.");return;
      }
      const content=(await file.text()).slice(0,40000);
      next.push({id:"file-"+Date.now()+"-"+next.length,name:file.name,mimeType:mime,content,kind:"file"});
    }
    const total=[...attachments,...next].reduce((sum,x)=>sum+new Blob([x.content]).size,0);
    if(total>120000){setError("Attached context is limited to 120 KB per message.");return;}
    setAttachments(current=>[...current,...next]);setError("");
  }

  function addTypedContext(){
    const content=contextText.trim();
    if(!content)return;
    if(attachments.length>=5){setError("You can attach up to 5 items to one Ledgerly AI message.");return;}
    const item:Attachment={
      id:"context-"+Date.now(),name:"Additional context",mimeType:"text/plain",
      content:content.slice(0,40000),kind:"context",
    };
    const total=[...attachments,item].reduce((sum,x)=>sum+new Blob([x.content]).size,0);
    if(total>120000){setError("Attached context is limited to 120 KB per message.");return;}
    setAttachments(current=>[...current,item]);setContextText("");setShowContext(false);setError("");
  }

  async function send(override?:typeof lastFailed){
    const message=(override?.message??text).trim();
    let sendChatId=override?.chatId??chatId;
    const sendEmployee=override?.employeeId??employeeId;
    const sendAttachments=override?.attachments??attachments;
    const requestKey=override?.requestKey??("lai-ui-"+Date.now()+"-"+Math.random().toString(36).slice(2));
    if(!message||busy)return;
    setBusy(true);setError("");setPendingApproval(null);
    if(!override)setText("");
    let failed={message,chatId:sendChatId,employeeId:sendEmployee,attachments:sendAttachments,requestKey};
    try{
      if(!sendChatId){
        const created=await post<Chat>("/ledgerly-ai/chats",{
          title:short(message,70),agentId:sendEmployee||null,
        });
        sendChatId=created.id;failed={...failed,chatId:created.id};
        setChatId(created.id);setEmployeeId(created.agentId??sendEmployee);
        await refreshChats();
      }
      const body={
        message,agentId:sendEmployee||null,taskKind:"chat",
        attachments:sendAttachments.map(({name,mimeType,content,kind})=>({name,mimeType,content,kind})),
      };
      const headers={"Idempotency-Key":requestKey};
      const response=await post<any>("/ledgerly-ai/my/chats/"+sendChatId+"/messages",body,headers);
      if(response.approval)setPendingApproval(response.approval);
      setLastFailed(null);setAttachments([]);setContextText("");setShowContext(false);
      await refreshChats();
      await loadChat(sendChatId);
      void pollJobs();
    }catch(err){
      const msg=errorText(err);setError(msg);setLastFailed(failed);
      if(!override)setText(message);
    }finally{setBusy(false);}
  }

  async function reviewApproval(decision:"approve"|"reject"){
    if(!pendingApproval)return;
    try{
      const result=await post<any>("/ledgerly-ai/approvals/"+pendingApproval.id+"/"+decision,{
        note:"Reviewed from my Ledgerly AI conversation",
      });
      if(result.status==="pending"){
        setPendingApproval(current=>current?{...current,status:"pending"}:current);
        toast({tone:"info",title:"Approval recorded",detail:`This action needs ${result.requiredApprovals??pendingApproval.requiredApprovals??2} approvals. ${result.approvalCount??1} recorded.`});
      }else{
        setPendingApproval(null);
        toast({tone:decision==="approve"?"ok":"info",title:decision==="approve"?"Action approved":"Action rejected",detail:decision==="approve"?"Ledgerly completed the governed action.":"Ledgerly will not execute this action."});
        if(chatId)await loadChat(chatId);
      }
      void pollJobs();
    }catch(err){setError(errorText(err));}
  }

  return <div className="laiu-page">
    <div className="laiu-toasts">{toasts.map(item=><div key={item.id} className={"laiu-toast "+item.tone}>
      {item.tone==="ok"?<CheckCircle2 size={17}/>:item.tone==="bad"?<CircleAlert size={17}/>:<Bell size={17}/>}
      <span><b>{item.title}</b><small>{item.detail}</small></span>
      <button onClick={()=>setToasts(x=>x.filter(t=>t.id!==item.id))}><X size={13}/></button>
    </div>)}</div>

    <header className="laiu-hero">
      <div>
        <span className="laiu-kicker"><Sparkles size={13}/> LEDGERLY AI</span>
        <h1>Ask. Analyse. Get work done.</h1>
        <p>Work with Ledgerly AI or choose an AI employee by name. Your permissions, conversation memory and approval rules stay in control.</p>
      </div>
      <div className="laiu-hero-actions">
        {workingJobs.length>0&&<span className="laiu-task-chip"><RefreshCw size={13}/>{workingJobs.length} task{workingJobs.length===1?"":"s"} active</span>}
        <button className="secondary" onClick={()=>void enableNotifications()}><BellRing size={15}/> Task alerts</button>
        <button onClick={()=>newChat()}><Plus size={15}/> New chat</button>
      </div>
    </header>

    {error&&<div className="laiu-error"><CircleAlert size={16}/><span>{error}</span>
      {lastFailed&&<button onClick={()=>void send(lastFailed)} disabled={busy}><RefreshCw size={13}/> Retry</button>}
      <button className="icon" onClick={()=>setError("")}><X size={14}/></button>
    </div>}

    <div className="laiu-tabs">
      <button className={view==="chat"?"active":""} onClick={()=>setView("chat")}><MessageSquare size={15}/> Chat</button>
      <button className={view==="employees"?"active":""} onClick={()=>setView("employees")}><Users size={15}/> My AI Employees <em>{myEmployees.length}</em></button>
      <button className={view==="history"?"active":""} onClick={()=>setView("history")}><History size={15}/> Recent & saved chats <em>{chats.length}</em></button>
    </div>

    {view==="employees"&&<EmployeeArea employees={myEmployees} onChat={id=>newChat(id)}/>}
    {view==="history"&&<HistoryArea chats={filteredChats} employees={employees} search={search} onSearch={setSearch} onOpen={loadChat}/>}
    {view==="chat"&&<div className="laiu-chat-layout">
      <aside className="laiu-chat-side">
        <div className="laiu-side-title"><span>AI employee</span><button onClick={()=>setView("employees")}><Users size={14}/></button></div>
        <button className={"laiu-employee-mini "+(!employeeId?"active":"")} disabled={Boolean(chatId)} onClick={()=>setEmployeeId("")}>
          <span className="laiu-mini-avatar"><Sparkles size={16}/></span><span><b>Ledgerly AI</b><small>Automatic employee routing</small></span>
        </button>
        {myEmployees.slice(0,9).map(emp=><button key={emp.id} disabled={Boolean(chatId)}
          className={"laiu-employee-mini "+(employeeId===emp.id?"active":"")} onClick={()=>setEmployeeId(emp.id)}>
          <span className="laiu-mini-avatar">{initials(emp.name)}</span><span><b>{emp.name}</b><small>{emp.role}</small></span>
        </button>)}
        <div className="laiu-side-history">
          <span>Recent chats</span>
          {chats.slice(0,6).map(chat=><button key={chat.id} className={chat.id===chatId?"active":""} onClick={()=>void loadChat(chat.id)}>
            <MessageSquare size={12}/><span>{chat.title}</span>
          </button>)}
        </div>
      </aside>

      <section className="laiu-conversation">
        <header>
          <div className="laiu-chat-persona">
            <span>{currentEmployee?initials(currentEmployee.name):<Sparkles size={19}/>}</span>
            <div><small>YOU ARE TALKING WITH</small><h2>{currentEmployee?.name??"Ledgerly AI"}</h2><p>{currentEmployee?.role??"Managed AI workspace"}</p></div>
          </div>
          <div className="laiu-chat-head-actions">
            {currentChat&&<Badge value={currentChat.status}>{currentChat.status}</Badge>}
            {chatId&&<button className="secondary" onClick={()=>void archiveCurrent()}><Archive size={14}/> Archive</button>}
            <button className="secondary" onClick={()=>newChat(employeeId)}><Plus size={14}/> New</button>
          </div>
        </header>

        <div className="laiu-messages">
          {loading&&messages.length===0?<div className="laiu-working"><RefreshCw size={18}/> Loading Ledgerly AI…</div>:
          messages.length===0?<Welcome employee={currentEmployee} onStarter={setText}/>:
          messages.map(message=><MessageView key={message.id} message={message}/>)}
        </div>

        {pendingApproval&&<ApprovalCard approval={pendingApproval} onDecision={reviewApproval}/>}
        {!!attachments.length&&<div className="laiu-attachments">{attachments.map(item=><span key={item.id}>
          {item.kind==="file"?<FileText size={13}/>:<AtSign size={13}/>}<b>{item.name}</b><small>{ACCEPTED[item.mimeType]??"Context"} · {item.content.length.toLocaleString()} chars</small>
          <button onClick={()=>setAttachments(x=>x.filter(a=>a.id!==item.id))}><X size={12}/></button>
        </span>)}</div>}
        {showContext&&<div className="laiu-context-box">
          <textarea value={contextText} onChange={e=>setContextText(e.target.value)} maxLength={40000} placeholder="Paste context Ledgerly AI should consider for this message. This is treated as untrusted reference data, not as system instructions."/>
          <div><small>{contextText.length.toLocaleString()} / 40,000</small><button className="secondary" onClick={()=>setShowContext(false)}>Cancel</button><button onClick={addTypedContext}>Attach context</button></div>
        </div>}
        <footer className="laiu-composer">
          <div className="laiu-composer-tools">
            <input ref={fileRef} type="file" multiple accept=".txt,.md,.markdown,.csv,.json,.xml,text/plain,text/markdown,text/csv,application/json,application/xml,text/xml" hidden onChange={e=>void fileChanged(e)}/>
            <button title="Attach text file" onClick={()=>fileRef.current?.click()} disabled={attachments.length>=5}><Paperclip size={16}/></button>
            <button title="Add typed context" onClick={()=>setShowContext(x=>!x)} disabled={attachments.length>=5}><AtSign size={16}/></button>
          </div>
          <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Ask Ledgerly AI anything you are allowed to work with…"
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}}/>
          <button className="laiu-send" onClick={()=>void send()} disabled={busy||!text.trim()}><Send size={17}/></button>
        </footer>
        <div className="laiu-composer-note"><ShieldCheck size={12}/> Ledgerly AI uses your current permissions. Actions that need approval will stop and ask first.</div>
      </section>
    </div>}
  </div>;
}

function guessMime(name:string){
  const ext=name.toLowerCase().split(".").pop();
  if(ext==="md"||ext==="markdown")return"text/markdown";
  if(ext==="csv")return"text/csv";
  if(ext==="json")return"application/json";
  if(ext==="xml")return"application/xml";
  return"text/plain";
}

function Welcome({employee,onStarter}:{employee:Employee|null;onStarter:(value:string)=>void}){
  const starters=employee?[
    `What can you help me with as ${employee.name}?`,
    "Show me what needs my attention today.",
    "Analyse the most important issues I can access.",
  ]:[
    "What needs my attention today?",
    "Help me analyse school performance.",
    "Find work or records I should follow up.",
  ];
  return <div className="laiu-welcome">
    <span>{employee?<Bot size={28}/>:<Sparkles size={28}/>}</span>
    <h3>{employee?"Work with "+employee.name:"How can Ledgerly AI help?"}</h3>
    <p>{employee?.description??"Ask naturally. Ledgerly AI can use permitted school data, memory and governed tools without exposing its underlying AI provider."}</p>
    <div>{starters.map(item=><button key={item} onClick={()=>onStarter(item)}>{item}<ChevronRight size={13}/></button>)}</div>
  </div>;
}

function MessageView({message}:{message:Message}){
  const toolTrace=Array.isArray(message.metadata?.toolTrace)?message.metadata.toolTrace:[];
  const attached=Array.isArray(message.metadata?.attachments)?message.metadata.attachments:[];
  if(message.role==="tool"){
    return <div className="laiu-tool-card"><CheckCircle2 size={16}/><div><small>VERIFIED LEDGERLY DATA</small><b>{message.metadata?.toolName??"Ledgerly tool result"}</b><p>{short(message.content,240)}</p></div></div>;
  }
  const employeeName=String(message.metadata?.employeeName??"Ledgerly AI");
  const progress=message.metadata?.kind==="progress";
  return <article className={"laiu-message "+message.role+(progress?" progress":"")}>
    <span className="laiu-message-avatar">{message.role==="user"?<UserRound size={15}/>:<Sparkles size={15}/>}</span>
    <div>
      <small>{message.role==="user"?"You":employeeName} <time>{when(message.createdAt)}</time></small>
      <p>{message.content}</p>
      {!!attached.length&&<div className="laiu-message-meta">{attached.map((x:any,i:number)=><span key={i}><Paperclip size={11}/>{x.name}</span>)}</div>}
      {!!toolTrace.length&&<div className="laiu-tool-trace">{toolTrace.map((x:any,i:number)=><span key={i}>
        <Wrench size={11}/><b>{x.toolName}</b><Badge value={x.status}>{x.status}</Badge>
      </span>)}</div>}
    </div>
  </article>;
}

function ApprovalCard({approval,onDecision}:{approval:Approval;onDecision:(d:"approve"|"reject")=>void}){
  const reviews=approval.requiredApprovals??(approval.approvalMode==="two_step"?2:1);
  return <div className="laiu-approval">
    <span><ShieldCheck size={20}/></span>
    <div><small>CONFIRMATION REQUIRED</small><h3>Ledgerly AI wants to perform an action</h3>
      <p><b>{approval.toolName}</b> is a {approval.riskLevel}-risk governed action. {reviews>1?`It requires ${reviews} separate authorized approvals.`:"Your confirmation is required before Ledgerly can execute it."}</p>
      <div><Badge value={approval.riskLevel}>{approval.riskLevel} risk</Badge>{approval.approvalMode&&<Badge>{approval.approvalMode.replace("_"," ")}</Badge>}</div>
    </div>
    <div className="laiu-approval-actions"><button className="danger ghost" onClick={()=>onDecision("reject")}><XCircle size={14}/> Reject</button><button onClick={()=>onDecision("approve")}><CheckCircle2 size={14}/> Approve</button></div>
  </div>;
}

function EmployeeArea({employees,onChat}:{employees:Employee[];onChat:(id:string)=>void}){
  if(!employees.length)return <div className="laiu-empty"><Bot size={28}/><h3>No AI employees available</h3><p>Your administrator can make named Ledgerly AI employees available to your role.</p></div>;
  return <div className="laiu-employee-grid">{employees.map(emp=><article key={emp.id}>
    <div className="laiu-employee-top"><span>{initials(emp.name)}</span><Badge value={emp.status}>{emp.status}</Badge></div>
    <small>LEDGERLY AI EMPLOYEE</small><h3>{emp.name}</h3><b>{emp.role}</b><p>{emp.description}</p>
    <div className="laiu-capabilities">{(emp.capabilities??[]).slice(0,4).map(x=><span key={x}>{x}</span>)}</div>
    <footer><span><Brain size={13}/>{emp.memoryScope??"managed"} memory</span><button onClick={()=>onChat(emp.id)}><MessageSquare size={14}/> Chat with {emp.name}</button></footer>
  </article>)}</div>;
}

function HistoryArea({chats,employees,search,onSearch,onOpen}:{chats:Chat[];employees:Employee[];search:string;onSearch:(x:string)=>void;onOpen:(id:string)=>void}){
  return <section className="laiu-history">
    <header><div><small>YOUR CONVERSATIONS</small><h2>Recent & saved chats</h2><p>Chats stay connected to the employee they started with, preserving conversation memory and context.</p></div>
      <label><Search size={15}/><input value={search} onChange={e=>onSearch(e.target.value)} placeholder="Search chats or employee name…"/></label>
    </header>
    {!chats.length?<div className="laiu-empty"><History size={28}/><h3>No matching chats</h3><p>Start a conversation or change your search.</p></div>:
    <div className="laiu-history-list">{chats.map(chat=>{
      const emp=employees.find(x=>x.id===chat.agentId);
      return <button key={chat.id} onClick={()=>void onOpen(chat.id)}>
        <span className="laiu-history-icon">{emp?initials(emp.name):<Sparkles size={17}/>}</span>
        <span><b>{chat.title}</b><small>{emp?emp.name+" · "+emp.role:"Ledgerly AI"} · {when(chat.lastMessageAt??chat.createdAt)}</small></span>
        <Badge value={chat.status}>{chat.status}</Badge><ChevronRight size={15}/>
      </button>;
    })}</div>}
  </section>;
}

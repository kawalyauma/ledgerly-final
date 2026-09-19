import { useEffect,useMemo,useRef,useState } from "react";
import {
  CircleAlert,Hammer,RefreshCw,Send,ShieldCheck,Sparkles,Users,UserRound,X
} from "lucide-react";
import { errorText,get,post } from "../../../web/api";
import "./ledgerly-ai-team-chat.css";

type Employee={
  id:string;key:string;name:string;role:string;description:string;icon?:string|null;status:string;
};
type TurnMessage={
  id:string;employeeId:string|null;employeeKey:string|null;employeeName:string;
  role:"user"|"assistant"|"error";content:string;createdAt:string;
  requestText?:string;chatId?:string|null;
};
const ENGINEERING_KEYS=new Set(["kato","maya","tendo","nia","jabali","safi"]);
type TaskStatus="idle"|"sending"|"queued"|"error";

function initials(name:string){
  return name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("")||"AI";
}
function when(value:string){
  const date=new Date(value);
  return Number.isNaN(date.getTime())?"":date.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
}

// A "team room": one composer, several AI employees selected at once.
// Each selected employee independently receives the same message in its own
// conversation (so permissions/memory/approvals stay exactly as they are for
// 1:1 chat) and the replies are shown together in one merged timeline — a
// group-conversation feel without inventing employee-to-employee messaging.
export function LedgerlyAiTeamChatPage(){
  const[employees,setEmployees]=useState<Employee[]>([]);
  const[loading,setLoading]=useState(true);
  const[error,setError]=useState("");
  const[selected,setSelected]=useState<Set<string>>(new Set());
  const[roomChats,setRoomChats]=useState<Record<string,string>>({});
  const[turns,setTurns]=useState<TurnMessage[]>([]);
  const[text,setText]=useState("");
  const[pending,setPending]=useState<Set<string>>(new Set());
  const[taskStatus,setTaskStatus]=useState<Record<string,TaskStatus>>({});
  const scrollRef=useRef<HTMLDivElement|null>(null);

  const myEmployees=useMemo(()=>employees.filter(x=>x.status==="active"),[employees]);
  const busy=pending.size>0;

  useEffect(()=>{
    (async()=>{
      setLoading(true);setError("");
      try{
        const rows=await get<Employee[]>("/ledgerly-ai/employees");
        setEmployees(rows);
      }catch(err){setError(errorText(err));}
      finally{setLoading(false);}
    })();
  },[]);

  useEffect(()=>{
    scrollRef.current?.scrollTo({top:scrollRef.current.scrollHeight,behavior:"smooth"});
  },[turns,pending]);

  function toggle(id:string){
    setSelected(current=>{
      const next=new Set(current);
      if(next.has(id))next.delete(id);else next.add(id);
      return next;
    });
  }

  function resetRoom(){
    setSelected(new Set());setRoomChats({});setTurns([]);setText("");setError("");
  }

  async function sendToEmployee(employee:Employee,message:string,requestKey:string){
    const existingChatId=roomChats[employee.id];
    const body={
      message,agentId:employee.id,taskKind:"chat",
      ...(existingChatId?{}:{title:"Team room: "+message.slice(0,60)}),
    };
    const headers={"Idempotency-Key":requestKey+"-"+employee.id};
    try{
      const response=existingChatId
        ? await post<any>("/ledgerly-ai/my/chats/"+existingChatId+"/messages",body,headers)
        : await post<any>("/ledgerly-ai/chat",body,headers);
      const chatId=response.chat?.id;
      if(chatId&&chatId!==existingChatId)setRoomChats(current=>({...current,[employee.id]:chatId}));
      setTurns(current=>[...current,{
        id:requestKey+"-"+employee.id,employeeId:employee.id,employeeKey:employee.key,employeeName:employee.name,
        role:"assistant",content:response.message?.content??"(No reply.)",
        createdAt:response.message?.createdAt??new Date().toISOString(),
        requestText:message,chatId:chatId??existingChatId??null,
      }]);
    }catch(err){
      setTurns(current=>[...current,{
        id:requestKey+"-"+employee.id,employeeId:employee.id,employeeKey:employee.key,employeeName:employee.name,
        role:"error",content:errorText(err),createdAt:new Date().toISOString(),
      }]);
    }finally{
      setPending(current=>{const next=new Set(current);next.delete(employee.id);return next;});
    }
  }

  async function send(){
    const message=text.trim();
    const targets=myEmployees.filter(x=>selected.has(x.id));
    if(!message||!targets.length||busy)return;
    setText("");setError("");
    const requestKey="lai-team-"+Date.now()+"-"+Math.random().toString(36).slice(2);
    setTurns(current=>[...current,{id:requestKey,employeeId:null,employeeKey:null,employeeName:"You",role:"user",content:message,createdAt:new Date().toISOString()}]);
    setPending(new Set(targets.map(x=>x.id)));
    await Promise.all(targets.map(employee=>sendToEmployee(employee,message,requestKey)));
  }

  async function requestBuild(turn:TurnMessage){
    if(!turn.employeeKey||!turn.requestText)return;
    setTaskStatus(current=>({...current,[turn.id]:"sending"}));
    try{
      await post("/ledgerly-ai/incidents/feature-requests",{
        title:turn.requestText.slice(0,120),
        description:turn.requestText,
        employeeKey:turn.employeeKey,
        chatId:turn.chatId??null,
      });
      setTaskStatus(current=>({...current,[turn.id]:"queued"}));
    }catch(err){
      setError(errorText(err));
      setTaskStatus(current=>({...current,[turn.id]:"error"}));
    }
  }

  if(loading)return <div className="laitc-loading"><RefreshCw size={18}/> Loading your AI employees…</div>;

  return <div className="laitc-page">
    <header className="laitc-hero">
      <div>
        <span className="laitc-kicker"><Users size={13}/> TEAM ROOM</span>
        <h1>Bring several AI employees into one conversation</h1>
        <p>Pick who you want in the room, send one message, and see every selected employee answer in the same thread — each still working strictly within their own permissions and tools.</p>
      </div>
      {turns.length>0&&<button className="secondary" onClick={resetRoom}><X size={14}/> New room</button>}
    </header>

    {error&&<div className="laitc-error"><CircleAlert size={16}/><span>{error}</span><button className="icon" onClick={()=>setError("")}><X size={14}/></button></div>}

    <div className="laitc-layout">
      <aside className="laitc-roster">
        <span className="laitc-roster-title">Who's in the room</span>
        {!myEmployees.length&&<p className="laitc-empty-note">No AI employees are available to you yet.</p>}
        {myEmployees.map(emp=><label key={emp.id} className={"laitc-roster-item "+(selected.has(emp.id)?"active":"")}>
          <input type="checkbox" checked={selected.has(emp.id)} onChange={()=>toggle(emp.id)} disabled={busy}/>
          <span className="laitc-mini-avatar">{initials(emp.name)}</span>
          <span><b>{emp.name}</b><small>{emp.role}</small></span>
        </label>)}
        <div className="laitc-roster-note"><ShieldCheck size={12}/> Each employee only sees this message — not each other's replies — and keeps its own permissions and approval rules.</div>
      </aside>

      <section className="laitc-conversation">
        <div className="laitc-messages" ref={scrollRef}>
          {!turns.length&&<div className="laitc-welcome">
            <Sparkles size={26}/>
            <h3>Select one or more employees, then send a message</h3>
            <p>Good for getting a quick second (or third) opinion — e.g. ask Hesabu and Elimu the same question and compare answers side by side.</p>
          </div>}
          {turns.map(turn=><TurnView key={turn.id} turn={turn} taskStatus={taskStatus[turn.id]??"idle"} onRequestBuild={requestBuild}/>)}
          {[...pending].map(id=>{
            const emp=myEmployees.find(x=>x.id===id);
            return <div key={id} className="laitc-message assistant working">
              <span className="laitc-message-avatar">{emp?initials(emp.name):<Sparkles size={14}/>}</span>
              <div><small>{emp?.name??"AI employee"}</small><p><RefreshCw size={13}/> Thinking…</p></div>
            </div>;
          })}
        </div>
        <footer className="laitc-composer">
          <textarea value={text} onChange={e=>setText(e.target.value)}
            placeholder={selected.size?"Message the "+selected.size+" selected employee"+(selected.size===1?"":"s")+"…":"Select at least one employee above first…"}
            disabled={!selected.size}
            onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void send();}}}/>
          <button className="laitc-send" onClick={()=>void send()} disabled={busy||!text.trim()||!selected.size}><Send size={17}/></button>
        </footer>
      </section>
    </div>
  </div>;
}

function TurnView({turn,taskStatus,onRequestBuild}:{
  turn:TurnMessage;taskStatus:TaskStatus;onRequestBuild:(turn:TurnMessage)=>void;
}){
  if(turn.role==="user"){
    return <article className="laitc-message user">
      <span className="laitc-message-avatar"><UserRound size={14}/></span>
      <div><small>You <time>{when(turn.createdAt)}</time></small><p>{turn.content}</p></div>
    </article>;
  }
  if(turn.role==="error"){
    return <article className="laitc-message error">
      <span className="laitc-message-avatar"><CircleAlert size={14}/></span>
      <div><small>{turn.employeeName} <time>{when(turn.createdAt)}</time></small><p>{turn.content}</p></div>
    </article>;
  }
  const canBuild=turn.employeeKey&&ENGINEERING_KEYS.has(turn.employeeKey);
  return <article className="laitc-message assistant">
    <span className="laitc-message-avatar">{initials(turn.employeeName)}</span>
    <div>
      <small>{turn.employeeName} <time>{when(turn.createdAt)}</time></small>
      <p>{turn.content}</p>
      {canBuild&&<div className="laitc-build-row">
        {taskStatus==="queued"
          ? <span className="laitc-build-queued"><ShieldCheck size={12}/> Sent to {turn.employeeName} as a real engineering task — check the Admin Console incident queue for progress.</span>
          : <button className="secondary laitc-build-btn" disabled={taskStatus==="sending"} onClick={()=>onRequestBuild(turn)}>
              <Hammer size={12}/> {taskStatus==="sending"?"Queuing…":taskStatus==="error"?"Try again":"Build this for real"}
            </button>}
      </div>}
    </div>
  </article>;
}

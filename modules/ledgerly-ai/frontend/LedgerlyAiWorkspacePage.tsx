import {useEffect,useMemo,useRef,useState,type ChangeEvent} from "react";
import {Archive,AtSign,ChevronRight,CircleAlert,Download,FileText,History,MessageSquare,Paperclip,Plus,RefreshCw,Search,Send,ShieldCheck,Sparkles,UserRound,X} from "lucide-react";
import {ApiError,downloadFile,errorText,get,post,postStream,uploadFile} from "../../../web/api";
import "./ledgerly-ai-workspace.css";

type Chat={id:string;title:string;status:"active"|"archived";lastMessageAt?:string|null;createdAt?:string};
type Provider="claude-code"|"codex";
type Message={id:string;role:"system"|"user"|"assistant"|"tool";content:string;createdAt?:string;metadata?:Record<string,any>};
type Attachment={id:string;fileId?:string;name:string;mimeType:string;content?:string;sizeBytes?:number;kind:"file"|"context"};
type Failed={message:string;chatId:string|null;attachments:Attachment[];requestKey:string};
type LoadingStage="thinking"|"working"|"finalising";
type StreamResponse={chat:{id:string;title:string};message:Message;jobId:string;correlationId:string;durationMs:number};

const PROVIDER_STORAGE_KEY="ledgerly-ai.provider";
const PROVIDERS:Array<{id:Provider;label:string}>=[{id:"claude-code",label:"Claude"},{id:"codex",label:"Codex"}];
function loadStoredProvider():Provider{try{const value=localStorage.getItem(PROVIDER_STORAGE_KEY);return value==="codex"?"codex":"claude-code";}catch{return "claude-code";}}
const ACCEPTED:Record<string,string>={"text/plain":"Text","text/markdown":"Markdown","text/csv":"CSV","application/json":"JSON","application/xml":"XML","text/xml":"XML","application/pdf":"PDF","application/vnd.openxmlformats-officedocument.wordprocessingml.document":"Word","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"Excel","application/vnd.openxmlformats-officedocument.presentationml.presentation":"PowerPoint","image/png":"PNG","image/jpeg":"JPEG","image/webp":"WebP","image/gif":"GIF"};
function when(value:unknown){if(!value)return "";const date=new Date(String(value));return Number.isNaN(date.getTime())?"":date.toLocaleString();}
function short(value:string,max=100){const compact=value.replace(/\s+/g," ").trim();return compact.length>max?compact.slice(0,max-1)+"…":compact;}
function guessMime(name:string){const ext=name.toLowerCase().split(".").pop();if(ext==="md"||ext==="markdown")return "text/markdown";if(ext==="csv")return "text/csv";if(ext==="json")return "application/json";if(ext==="xml")return "application/xml";if(ext==="pdf")return "application/pdf";if(ext==="docx")return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";if(ext==="xlsx")return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";if(ext==="pptx")return "application/vnd.openxmlformats-officedocument.presentationml.presentation";if(ext==="png")return "image/png";if(ext==="jpg"||ext==="jpeg")return "image/jpeg";if(ext==="webp")return "image/webp";if(ext==="gif")return "image/gif";return "text/plain";}

async function streamChat(body:Record<string,unknown>,requestKey:string,onEvent:(event:string,data:any)=>void){
  const response=await postStream("/ledgerly-ai/chat/stream",body,{"Idempotency-Key":requestKey});
  if(!response.body)throw new ApiError(0,"STREAM_UNAVAILABLE","Ledgerly AI did not provide a response stream.");
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="",result:StreamResponse|null=null;
  const consume=(frame:string)=>{let event="message";const dataLines:string[]=[];for(const line of frame.split(/\r?\n/)){if(line.startsWith("event:"))event=line.slice(6).trim();else if(line.startsWith("data:"))dataLines.push(line.slice(5).trimStart());}if(!dataLines.length)return;let data:any;try{data=JSON.parse(dataLines.join("\n"));}catch{return;}onEvent(event,data);if(event==="error")throw new ApiError(200,data?.code||"LEDGERLY_AI_REQUEST_FAILED",data?.message||"Ledgerly AI could not complete the request.");if(event==="response")result=data as StreamResponse;};
  while(true){const{done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});const frames=buffer.split(/\r?\n\r?\n/);buffer=frames.pop()??"";for(const frame of frames)consume(frame);if(done)break;}
  if(buffer.trim())consume(buffer);if(!result)throw new ApiError(0,"STREAM_INCOMPLETE","Ledgerly AI closed the stream before returning its answer.");return result;
}

export function AskLedgerlyAiAction({activePath}:{activePath:string}){
  return <button type="button" className={"laiu-global-ask "+(activePath==="ledgerly-ai-ask"?"active":"")} onClick={()=>{location.hash="ledgerly-ai-ask";}} title="Ask Ledgerly AI"><Sparkles size={17}/><span>Ask Ledgerly AI</span></button>;
}

export function LedgerlyAiWorkspacePage(){
  const[chats,setChats]=useState<Chat[]>([]),[chatId,setChatId]=useState<string|null>(null),[messages,setMessages]=useState<Message[]>([]);
  const[text,setText]=useState(""),[search,setSearch]=useState(""),[attachments,setAttachments]=useState<Attachment[]>([]);
  const[contextText,setContextText]=useState(""),[showContext,setShowContext]=useState(false),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const[loadingStage,setLoadingStage]=useState<LoadingStage>("thinking");
  const[liveProgress,setLiveProgress]=useState<Message[]>([]);
  const[lastFailed,setLastFailed]=useState<Failed|null>(null),fileRef=useRef<HTMLInputElement|null>(null),messagesEndRef=useRef<HTMLDivElement|null>(null);
  const[provider,setProvider]=useState<Provider>(loadStoredProvider);
  useEffect(()=>{try{const pending=sessionStorage.getItem("ledgerly-ai.prefill");if(pending){setText(pending);sessionStorage.removeItem("ledgerly-ai.prefill");}}catch{}},[]);
  useEffect(()=>{try{localStorage.setItem(PROVIDER_STORAGE_KEY,provider);}catch{}},[provider]);
  const currentChat=useMemo(()=>chats.find(chat=>chat.id===chatId)??null,[chats,chatId]);
  const filteredChats=useMemo(()=>{const query=search.trim().toLowerCase();return query?chats.filter(chat=>chat.title.toLowerCase().includes(query)):chats;},[chats,search]);
  const visibleMessages=useMemo(()=>messages.filter(message=>message.role!=="tool"&&message.metadata?.kind!=="progress"),[messages]);
  const persistedProgress=useMemo(()=>{
    let lastUser=-1,lastFinalAssistant=-1;
    messages.forEach((message,index)=>{if(message.role==="user")lastUser=index;if(message.role==="assistant"&&message.metadata?.kind!=="progress")lastFinalAssistant=index;});
    if(lastUser<0||lastFinalAssistant>lastUser)return[];
    return messages.slice(lastUser+1).filter(message=>message.role==="assistant"&&message.metadata?.kind==="progress");
  },[messages]);
  const shownProgress=busy?liveProgress:persistedProgress;
  const visiblyWorking=busy||persistedProgress.length>0;

  async function refreshChats(){setChats(await get<Chat[]>("/ledgerly-ai/my/chats"));}
  async function loadChat(id:string){setLoading(true);setError("");try{const detail=await get<Chat&{messages:Message[]}>("/ledgerly-ai/my/chats/"+id);setChatId(id);setMessages(detail.messages??[]);}catch(err){setError(errorText(err));}finally{setLoading(false);}}
  useEffect(()=>{void(async()=>{try{await refreshChats();}catch(err){setError(errorText(err));}finally{setLoading(false);}})();},[]);
  useEffect(()=>{if(!chatId||busy)return;const timer=window.setInterval(()=>void loadChat(chatId),2500);return()=>window.clearInterval(timer);},[chatId,busy]);
  useEffect(()=>{messagesEndRef.current?.scrollIntoView({behavior:"smooth",block:"end"});},[messages.length,liveProgress.length,loadingStage]);
  useEffect(()=>{
    if(!busy){setLoadingStage("thinking");return;}
    setLoadingStage("thinking");
    const working=window.setTimeout(()=>setLoadingStage("working"),2800);
    const finalising=window.setTimeout(()=>setLoadingStage("finalising"),14000);
    return()=>{window.clearTimeout(working);window.clearTimeout(finalising);};
  },[busy]);
  function newChat(){setChatId(null);setMessages([]);setLiveProgress([]);setText("");setAttachments([]);setContextText("");setShowContext(false);setError("");setLastFailed(null);}
  async function archiveCurrent(){if(!chatId)return;try{await post("/ledgerly-ai/my/chats/"+chatId+"/archive",{});await refreshChats();newChat();}catch(err){setError(errorText(err));}}
  async function fileChanged(event:ChangeEvent<HTMLInputElement>){
    const selected=Array.from(event.target.files??[]);event.target.value="";
    if(attachments.length+selected.length>5){setError("You can attach up to 5 items.");return;}
    const next:Attachment[]=[];
    for(const file of selected){const mime=file.type||guessMime(file.name);if(!ACCEPTED[mime]){setError(file.name+" is not a supported chat file.");return;}if(file.size>25*1024*1024){setError(file.name+" is too large. Keep each file below 25 MB.");return;}try{const uploaded=await uploadFile<{id:string;name:string;mimeType:string;sizeBytes:number}>("/ledgerly-ai/my/files",file,"ledgerly-ai");next.push({id:uploaded.id,fileId:uploaded.id,name:uploaded.name,mimeType:uploaded.mimeType,sizeBytes:uploaded.sizeBytes,kind:"file"});}catch(err){setError(errorText(err));return;}}
    setAttachments(current=>[...current,...next]);setError("");
  }
  function addTypedContext(){const content=contextText.trim();if(!content)return;setAttachments(current=>[...current,{id:"context-"+Date.now(),name:"Additional context",mimeType:"text/plain",content:content.slice(0,40000),kind:"context"}]);setContextText("");setShowContext(false);}
  async function send(retry?:Failed){
    const message=(retry?.message??text).trim();let targetChatId=retry?.chatId??chatId;const sentAttachments=retry?.attachments??attachments;const requestKey=retry?.requestKey??("lai-controller-"+Date.now()+"-"+Math.random().toString(36).slice(2));if(!message||busy)return;
    setBusy(true);setLiveProgress([]);setError("");if(!retry)setText("");let failed:Failed={message,chatId:targetChatId,attachments:sentAttachments,requestKey};
    setMessages(current=>[...current,{id:"pending-user-"+requestKey,role:"user",content:message,createdAt:new Date().toISOString(),metadata:{pending:true}}]);
    try{if(!targetChatId){const created=await post<Chat>("/ledgerly-ai/chats",{title:short(message,70)});targetChatId=created.id;failed={...failed,chatId:created.id};setChatId(created.id);await refreshChats();}
      await streamChat({chatId:targetChatId,message,taskKind:"chat",provider,attachments:sentAttachments.map(({fileId,name,mimeType,content,kind})=>({fileId,name,mimeType,content:content??"",kind}))},requestKey,(event,data)=>{
        if(event==="progress"){
          if(data?.type==="running")setLoadingStage("working");
          const streamed=data?.data?.message as Message|undefined;
          if(data?.type==="message"&&streamed?.id)setLiveProgress(current=>current.some(item=>item.id===streamed.id)?current:[...current,streamed]);
          if(data?.type==="failed"&&streamed?.id)setMessages(current=>current.some(item=>item.id===streamed.id)?current:[...current,streamed]);
        }
        if(event==="response")setLoadingStage("finalising");
      });
      setLoadingStage("finalising");await new Promise(resolve=>window.setTimeout(resolve,550));
      setLastFailed(null);setAttachments([]);setContextText("");setShowContext(false);await refreshChats();await loadChat(targetChatId);setLiveProgress([]);
    }catch(err){const failure=errorText(err);setLiveProgress([]);setLastFailed(failed);if(!retry)setText(message);if(targetChatId)await loadChat(targetChatId);setError(failure);}finally{setBusy(false);}
  }

  async function resume(jobId:string){
    if(!chatId||busy)return;
    const targetChatId=chatId,requestKey="lai-resume-"+jobId+"-"+Date.now()+"-"+Math.random().toString(36).slice(2);
    setBusy(true);setLiveProgress([]);setError("");setLastFailed(null);
    try{
      await streamChat({chatId:targetChatId,message:"Resume the interrupted request from its last saved checkpoint.",taskKind:"chat",resumeJobId:jobId},requestKey,(event,data)=>{
        if(event==="progress"){
          if(data?.type==="running")setLoadingStage("working");
          const streamed=data?.data?.message as Message|undefined;
          if(data?.type==="message"&&streamed?.id)setLiveProgress(current=>current.some(item=>item.id===streamed.id)?current:[...current,streamed]);
          if(data?.type==="failed"&&streamed?.id)setMessages(current=>current.some(item=>item.id===streamed.id)?current:[...current,streamed]);
        }
        if(event==="response")setLoadingStage("finalising");
      });
      setLoadingStage("finalising");await new Promise(resolve=>window.setTimeout(resolve,350));await refreshChats();await loadChat(targetChatId);setLiveProgress([]);
    }catch(err){const failure=errorText(err);setLiveProgress([]);await loadChat(targetChatId);setError(failure);}finally{setBusy(false);}
  }

  return <div className="laiu-page">
    <header className="laiu-hero"><div><span className="laiu-kicker"><Sparkles size={13}/> LEDGERLY AI</span><h1>One AI. Every conversation. Full context.</h1><p>Ledgerly AI is the single controller for your work and server. Conversations are saved, and you can reopen any chat to continue where you stopped.</p></div><div className="laiu-hero-actions"><ProviderSwitch value={provider} onChange={setProvider}/><button onClick={newChat}><Plus size={15}/> New chat</button></div></header>
    {error&&<div className="laiu-error" role="alert"><CircleAlert size={16}/><span>{error}</span>{lastFailed&&<button onClick={()=>void send(lastFailed)} disabled={busy}><RefreshCw size={13}/> Retry</button>}<button className="icon" aria-label="Dismiss error" onClick={()=>setError("")}><X size={14}/></button></div>}
    <div className="laiu-chat-layout">
      <aside className="laiu-chat-side"><div className="laiu-side-title"><span>Saved conversations</span><History size={14}/></div><label className="laiu-history-search"><Search size={14}/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search chats…"/></label><button className={"laiu-employee-mini "+(!chatId?"active":"")} onClick={newChat}><span className="laiu-mini-avatar"><Plus size={16}/></span><span><b>New conversation</b><small>Start with Ledgerly AI</small></span></button><div className="laiu-side-history">{filteredChats.map(chat=><button key={chat.id} className={chat.id===chatId?"active":""} onClick={()=>void loadChat(chat.id)}><MessageSquare size={12}/><span>{chat.title}</span></button>)}{!filteredChats.length&&<small>No saved conversations yet.</small>}</div></aside>
      <section className="laiu-conversation">
        <header><div className="laiu-chat-persona"><span><Sparkles size={19}/></span><div><small>YOU ARE TALKING WITH</small><h2>Ledgerly AI</h2><p>Overall Ledgerly controller</p></div></div><div className="laiu-chat-head-actions">{currentChat&&<span className="laiu-badge ok">{currentChat.status}</span>}{chatId&&<button className="secondary" onClick={()=>void archiveCurrent()}><Archive size={14}/> Archive</button>}<button className="secondary" onClick={newChat}><Plus size={14}/> New</button></div></header>
        <div className="laiu-messages">{loading&&visibleMessages.length===0?<div className="laiu-working"><RefreshCw size={18}/> Loading Ledgerly AI…</div>:visibleMessages.length===0&&!visiblyWorking?<Welcome onStarter={setText}/>:visibleMessages.map(message=><MessageView key={message.id} message={message} onResume={resume} busy={busy}/>)}{shownProgress.map(message=><MessageView key={message.id} message={message}/>)}{visiblyWorking&&<Thinking stage={busy?loadingStage:"working"}/>}<div ref={messagesEndRef}/></div>
        {!!attachments.length&&<div className="laiu-attachments">{attachments.map(item=><span key={item.id}>{item.kind==="file"?<FileText size={13}/>:<AtSign size={13}/>}<b>{item.name}</b><small>{ACCEPTED[item.mimeType]??"Context"}{item.sizeBytes?` · ${Math.ceil(item.sizeBytes/1024).toLocaleString()} KB`:""}</small><button aria-label={`Remove ${item.name}`} onClick={()=>setAttachments(current=>current.filter(value=>value.id!==item.id))}><X size={12}/></button></span>)}</div>}
        {showContext&&<div className="laiu-context-box"><textarea value={contextText} onChange={event=>setContextText(event.target.value)} maxLength={40000} placeholder="Add context for this message…"/><div><small>{contextText.length.toLocaleString()} / 40,000</small><button className="secondary" onClick={()=>setShowContext(false)}>Cancel</button><button onClick={addTypedContext}>Attach context</button></div></div>}
        <footer className="laiu-composer"><div className="laiu-composer-tools"><input ref={fileRef} type="file" multiple accept=".txt,.md,.markdown,.csv,.json,.xml,.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.webp,.gif" hidden onChange={event=>void fileChanged(event)}/><button aria-label="Attach file" title="Attach file" onClick={()=>fileRef.current?.click()}><Paperclip size={16}/></button><button aria-label="Add context" title="Add context" onClick={()=>setShowContext(value=>!value)}><AtSign size={16}/></button></div><textarea aria-label="Message Ledgerly AI" value={text} onChange={event=>setText(event.target.value)} placeholder="Tell Ledgerly AI what to do…" onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();void send();}}}/><button className="laiu-send" aria-label="Send message" onClick={()=>void send()} disabled={busy||!text.trim()}>{busy?<RefreshCw size={17}/>:<Send size={17}/>}</button></footer>
        <div className="laiu-composer-note"><ShieldCheck size={12}/> Ledgerly AI keeps the same identity across every saved conversation. Project edits are rebuilt before completion.</div>
      </section>
    </div>
  </div>;
}

function ProviderSwitch({value,onChange}:{value:Provider;onChange:(value:Provider)=>void}){
  return <div className="laiu-provider-switch" role="radiogroup" aria-label="AI provider">{PROVIDERS.map(item=><button key={item.id} type="button" role="radio" aria-checked={value===item.id} className={value===item.id?"active":""} onClick={()=>onChange(item.id)}>{item.label}</button>)}</div>;
}
function Welcome({onStarter}:{onStarter:(value:string)=>void}){const starters=["What needs my attention today?","Check the server and report any problems.","Review this project and suggest the next improvement."];return <div className="laiu-welcome"><span><Sparkles size={28}/></span><h3>How can Ledgerly AI help?</h3><p>There is one Ledgerly AI. It remembers this conversation, works through the configured providers, and controls permitted Ledgerly operations from one place.</p><div>{starters.map(item=><button key={item} onClick={()=>onStarter(item)}>{item}<ChevronRight size={13}/></button>)}</div></div>;}
function MessageView({message,onResume,busy=false}:{message:Message;onResume?:(jobId:string)=>void;busy?:boolean}){const progress=message.metadata?.kind==="progress",failure=message.metadata?.kind==="failure",jobId=typeof message.metadata?.jobId==="string"?message.metadata.jobId:"",files=Array.isArray(message.metadata?.files)?message.metadata.files as Array<{id:string;name:string;mimeType:string;sizeBytes:number}>:[];return <article className={"laiu-message "+message.role+(progress?" progress":"")+(failure?" failure":"")}><span className="laiu-message-avatar">{failure?<CircleAlert size={15}/>:message.role==="user"?<UserRound size={15}/>:<Sparkles size={15}/>}</span><div><small>{message.role==="user"?"You":"Ledgerly AI"} <time>{when(message.createdAt)}</time></small><p>{message.content}</p>{failure&&jobId&&message.metadata?.resumable!==false&&onResume&&<button className="laiu-resume" onClick={()=>onResume(jobId)} disabled={busy}><RefreshCw size={14}/>{busy?"Resuming…":"Resume from checkpoint"}</button>}{!!files.length&&<div className="laiu-generated-files">{files.map(file=><button key={file.id} onClick={()=>void downloadFile(`/ledgerly-ai/my/files/${file.id}`,file.name)}><FileText size={15}/><span><b>{file.name}</b><small>{ACCEPTED[file.mimeType]??"File"} · {Math.ceil(file.sizeBytes/1024).toLocaleString()} KB</small></span><Download size={14}/></button>)}</div>}</div></article>;}
function Thinking({stage}:{stage:LoadingStage}){const copy={thinking:["Thinking","Understanding your request and conversation"],working:["Working","Using the project and server directly"],finalising:["Finalising","Checking the result before replying"]} as const;const[label,detail]=copy[stage];return <article className="laiu-thinking" aria-live="polite"><span className="laiu-thinking-mark"><i/><i/><i/></span><div><b>{label}…</b><small>{detail}</small></div></article>;}

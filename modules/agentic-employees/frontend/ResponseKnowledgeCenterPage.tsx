import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, BookOpen, Check, CheckCircle2, Database, FilePlus2, Globe2,
  RefreshCcw, Search, ShieldCheck, Sparkles, Trash2, XCircle,
} from "lucide-react";
import { del, errorText, get, post } from "../../../web/api";

type KnowledgeStats={
  organization_id?:string;
  sources:number;
  approved_sources:number;
  chunks:number;
  approved_chunks:number;
  global_sources_available:number;
};
type KnowledgeSource={
  source_id:string;
  organization_id:string;
  title:string;
  source_type:string;
  url?:string;
  author?:string;
  published_at?:string;
  approved:boolean;
  tags:string[];
  metadata:Record<string,unknown>;
  chunk_count:number;
  content_sha256:string;
  created_at:string;
  updated_at:string;
};
type KnowledgeHit={
  chunk_id:string;
  source_id:string;
  title:string;
  content:string;
  source_type:string;
  url?:string;
  published_at?:string;
  score:number;
  organization_scope:"organization"|"global";
  tags:string[];
};
type KnowledgeCenterData={
  service?:{reachable?:boolean;knowledgeEnabled?:boolean;knowledgeRetrievalEnabled?:boolean;knowledgeIncludeGlobal?:boolean};
  stats:KnowledgeStats;
  sources:KnowledgeSource[];
};

const EMPTY:KnowledgeCenterData={
  service:{},
  stats:{sources:0,approved_sources:0,chunks:0,approved_chunks:0,global_sources_available:0},
  sources:[],
};

const TYPES=["manual","policy","circular","document","web","research","other"] as const;

function when(value?:string){if(!value)return "—";const date=new Date(value);return Number.isNaN(date.valueOf())?value:date.toLocaleString();}

export function ResponseKnowledgeCenterPage(){
  const[data,setData]=useState<KnowledgeCenterData>(EMPTY),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState("");
  const[form,setForm]=useState({title:"",sourceType:"policy",url:"",author:"",publishedAt:"",tags:"",content:"",approved:true});
  const[query,setQuery]=useState(""),[searching,setSearching]=useState(false),[hits,setHits]=useState<KnowledgeHit[]>([]);

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{setData(await get<KnowledgeCenterData>("/agentic-employees/chat-studio/knowledge-center"));}
    catch(err){setError(errorText(err));}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);

  const approvedRate=useMemo(()=>data.stats.sources?Math.round(data.stats.approved_sources/data.stats.sources*100):0,[data.stats]);
  const starterCount=data.sources.filter(item=>item.tags?.includes("ledgerly-starter-pack")).length;

  async function seed(){
    setBusy("seed");setError("");setNotice("");
    try{
      const result=await post<{sources:KnowledgeSource[];count:number}>("/agentic-employees/chat-studio/knowledge-seed",{});
      setNotice(`Professional school-analysis starter pack ready: ${result.count} sources available.`);
      await load();
    }catch(err){setError(errorText(err));}finally{setBusy("");}
  }

  async function addSource(){
    if(!form.title.trim()||form.content.trim().length<10)return;
    setBusy("add");setError("");setNotice("");
    try{
      await post<KnowledgeSource>("/agentic-employees/chat-studio/knowledge-sources",{
        title:form.title.trim(),sourceType:form.sourceType,content:form.content.trim(),
        url:form.url.trim(),author:form.author.trim(),publishedAt:form.publishedAt.trim(),
        approved:form.approved,tags:form.tags.split(",").map(item=>item.trim()).filter(Boolean),
      });
      setForm({title:"",sourceType:"policy",url:"",author:"",publishedAt:"",tags:"",content:"",approved:true});
      setNotice("Knowledge source saved. Approved material is immediately available to Response Intelligence retrieval.");
      await load();
    }catch(err){setError(errorText(err));}finally{setBusy("");}
  }

  async function setApproval(source:KnowledgeSource,approved:boolean){
    setBusy(source.source_id);setError("");setNotice("");
    try{
      await post<KnowledgeSource>(`/agentic-employees/chat-studio/knowledge-sources/${encodeURIComponent(source.source_id)}/${approved?"approve":"reject"}`,{});
      setNotice(approved?`Approved “${source.title}” for AI reference.`:`Withdrew “${source.title}” from AI retrieval.`);
      await load();
    }catch(err){setError(errorText(err));}finally{setBusy("");}
  }

  async function remove(source:KnowledgeSource){
    if(!window.confirm(`Delete knowledge source “${source.title}”? This removes its searchable chunks.`))return;
    setBusy(source.source_id);setError("");setNotice("");
    try{
      await del(`/agentic-employees/chat-studio/knowledge-sources/${encodeURIComponent(source.source_id)}`);
      setNotice(`Deleted “${source.title}”.`);await load();
    }catch(err){setError(errorText(err));}finally{setBusy("");}
  }

  async function search(){
    if(query.trim().length<2)return;
    setSearching(true);setError("");
    try{setHits(await post<KnowledgeHit[]>("/agentic-employees/chat-studio/knowledge-search",{query:query.trim(),limit:10}));}
    catch(err){setError(errorText(err));}finally{setSearching(false);}
  }

  return <main className="rkc-page">
    <header className="rkc-hero"><div><span><BookOpen size={14}/> INSTITUTIONAL KNOWLEDGE + RAG</span><h1>Knowledge Center</h1><p>Give Ledgerly approved reference material for richer analysis: school policies, manuals, circulars, procedures, research guidance and general analysis methodology. This knowledge remains separate from live Ledgerly records.</p></div><button onClick={()=>void load()} disabled={loading}><RefreshCcw className={loading?"spin":""} size={14}/>Refresh</button></header>
    {error&&<div className="rkc-error"><XCircle size={14}/>{error}</div>}
    {notice&&<div className="rkc-notice"><CheckCircle2 size={14}/>{notice}</div>}

    <section className="rkc-scores">
      <Metric icon={<Database size={15}/>} label="Sources" value={data.stats.sources} detail={`${data.stats.approved_sources} approved`}/>
      <Metric icon={<BookOpen size={15}/>} label="Search chunks" value={data.stats.chunks} detail={`${data.stats.approved_chunks} retrievable`}/>
      <Metric icon={<ShieldCheck size={15}/>} label="Approval rate" value={`${approvedRate}%`} detail="Only approved material is retrieved"/>
      <Metric icon={<Globe2 size={15}/>} label="Global sources" value={data.stats.global_sources_available} detail={data.service?.knowledgeIncludeGlobal?"Included in retrieval":"Global retrieval disabled"}/>
    </section>

    <section className="rkc-layout">
      <div className="rkc-main">
        <section className="rkc-card rkc-seed">
          <div><Sparkles size={18}/><div><small>BUILT-IN ANALYSIS KNOWLEDGE</small><h2>Professional school-analysis starter pack</h2><p>Seed methodology for absenteeism, fees, lesson delivery, academic trends, teacher workload, timetable exposure, materials, data quality, causal caution and more.</p></div></div>
          <button disabled={busy==="seed"} onClick={()=>void seed()}>{busy==="seed"?<Activity className="spin" size={13}/>:<Sparkles size={13}/>} {starterCount?"Refresh starter pack":"Seed starter pack"}</button>
        </section>

        <section className="rkc-card">
          <div className="rkc-head"><div><small>ORGANIZATION KNOWLEDGE</small><h2>Sources</h2><p>Withdrawing approval keeps the source stored but immediately removes it from AI retrieval.</p></div><span>{data.sources.length} sources</span></div>
          {loading?<div className="rkc-empty"><Activity className="spin" size={18}/>Loading knowledge…</div>:!data.sources.length?<div className="rkc-empty"><BookOpen size={22}/><b>No sources yet</b><span>Seed the starter pack or add your school's own material.</span></div>:
          <div className="rkc-source-list">{data.sources.map(source=><article key={source.source_id} className={source.approved?"approved":""}>
            <div className="rkc-source-top"><div><span className="rkc-type">{source.source_type}</span>{source.approved?<span className="rkc-approved"><Check size={10}/>Approved</span>:<span className="rkc-pending">Not retrievable</span>}</div><strong>{source.chunk_count} chunks</strong></div>
            <h3>{source.title}</h3><p>{source.author&&<>{source.author} · </>}{source.published_at||when(source.updated_at)}</p>
            {!!source.tags?.length&&<div className="rkc-tags">{source.tags.slice(0,7).map(tag=><span key={tag}>{tag}</span>)}</div>}
            {source.url&&<a href={source.url} target="_blank" rel="noreferrer">{source.url}</a>}
            <div className="rkc-source-actions">
              <button disabled={busy===source.source_id} onClick={()=>void setApproval(source,!source.approved)}>{source.approved?<><XCircle size={12}/>Withdraw</>:<><CheckCircle2 size={12}/>Approve</>}</button>
              <button className="danger" disabled={busy===source.source_id} onClick={()=>void remove(source)}><Trash2 size={12}/>Delete</button>
            </div>
          </article>)}</div>}
        </section>
      </div>

      <aside className="rkc-side">
        <section className="rkc-card">
          <div className="rkc-head compact"><div><small>ADD KNOWLEDGE</small><h2>New source</h2></div></div>
          <label>Title<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="e.g. School Attendance Policy 2026"/></label>
          <div className="rkc-two"><label>Type<select value={form.sourceType} onChange={e=>setForm({...form,sourceType:e.target.value})}>{TYPES.map(type=><option key={type}>{type}</option>)}</select></label><label>Published / date<input value={form.publishedAt} onChange={e=>setForm({...form,publishedAt:e.target.value})} placeholder="2026-09-01"/></label></div>
          <label>Author / issuer<input value={form.author} onChange={e=>setForm({...form,author:e.target.value})} placeholder="Ministry, school, author…"/></label>
          <label>Source URL<input value={form.url} onChange={e=>setForm({...form,url:e.target.value})} placeholder="Optional reference URL"/></label>
          <label>Tags<input value={form.tags} onChange={e=>setForm({...form,tags:e.target.value})} placeholder="attendance, policy, p6"/></label>
          <label>Knowledge text<textarea rows={10} value={form.content} onChange={e=>setForm({...form,content:e.target.value})} placeholder="Paste the policy, procedure, guidance, research notes or manual text here…"/></label>
          <label className="rkc-check"><input type="checkbox" checked={form.approved} onChange={e=>setForm({...form,approved:e.target.checked})}/><span>Approve immediately for retrieval</span></label>
          <button className="rkc-primary" disabled={busy==="add"||!form.title.trim()||form.content.trim().length<10} onClick={()=>void addSource()}>{busy==="add"?<Activity className="spin" size={13}/>:<FilePlus2 size={13}/>}Save knowledge source</button>
        </section>

        <section className="rkc-card">
          <div className="rkc-head compact"><div><small>RETRIEVAL PREVIEW</small><h2>What would Ledgerly find?</h2><p>Searches approved organization knowledge plus approved global knowledge.</p></div></div>
          <div className="rkc-search"><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")void search();}} placeholder="e.g. chronic absenteeism and academic decline"/><button onClick={()=>void search()} disabled={searching||query.trim().length<2}>{searching?<Activity className="spin" size={13}/>:<Search size={13}/>}</button></div>
          <div className="rkc-hits">{hits.map(hit=><article key={hit.chunk_id}><div><b>{hit.title}</b><span>{hit.organization_scope} · {Math.round(hit.score*100)}%</span></div><p>{hit.content}</p>{hit.url&&<a href={hit.url} target="_blank" rel="noreferrer">Open source</a>}</article>)}{query&& !searching&&!hits.length&&<small>No approved matching reference passages.</small>}</div>
        </section>

        <section className="rkc-card rkc-rule"><ShieldCheck size={18}/><div><h3>Evidence hierarchy</h3><p><b>1.</b> Ledgerly live records determine what happened. <b>2.</b> Approved institutional knowledge explains policy/procedure/context. <b>3.</b> Future web evidence will be supplemental and source-attributed.</p></div></section>
      </aside>
    </section>
  </main>;
}

function Metric({icon,label,value,detail}:{icon:React.ReactNode;label:string;value:string|number;detail:string}){return <div className="rkc-metric"><span>{icon}</span><div><small>{label}</small><b>{value}</b><p>{detail}</p></div></div>;}

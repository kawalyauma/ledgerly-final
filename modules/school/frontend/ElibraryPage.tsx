import { useEffect,useState } from "react";
import { BookMarked,BookOpen,Bot,Download,ExternalLink,Library,RefreshCw,Search,Trash2 } from "lucide-react";
import { can,del,errorText,get,post } from "../../../web/api";
import { useAuth } from "../../../web/auth";
import { Badge,Button,Card,EmptyState,Notice,Spinner } from "../../../web/components/ui";
import "./elibrary.css";

type Row=Record<string,any>;
type Taxonomy={levels:{slug:string;name:string;classes:{slug:string;name:string}[]}[];subjects:{slug:string;name:string}[];types:{slug:string;name:string;count:number|null}[];terms:{slug:string;name:string}[]};
const base="/school/elibrary";
const blank={q:"",class:"",subject:"",type:"",term:""};

function size(bytes:unknown){const n=Number(bytes||0);return n>1_048_576?`${(n/1_048_576).toFixed(1)} MB`:n?`${Math.max(1,Math.round(n/1024))} KB`:""}

function ResourceCard({item,write,onSave,onRemove}:{item:Row;write:boolean;onSave?:()=>void;onRemove?:()=>void}){
  return <article className="elib-card">
    <a className="elib-thumb" href={item.pageUrl} target="_blank" rel="noreferrer">{item.thumbnailUrl?<img src={item.thumbnailUrl} alt="" loading="lazy"/>:<BookOpen/>}</a>
    <div className="elib-body">
      <div className="elib-tags">{item.type&&<Badge tone="neutral">{item.type}</Badge>}{item.className&&<span>{item.className}</span>}{item.subject&&<span>{item.subject}</span>}{item.term&&<span>{item.term}</span>}</div>
      <h3 title={item.title}>{item.title}</h3>
      {item.description&&<p>{item.description}</p>}
      {item.note&&<p className="elib-note">{item.note}</p>}
      <small>{[item.fileType,item.pageCount&&`${item.pageCount} pages`,size(item.sizeBytes)].filter(Boolean).join(" · ")}</small>
      <div className="elib-actions">
        <a className="button button--secondary" href={item.pageUrl} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Preview</a>
        <a className="button button--ghost" href={item.downloadUrl} target="_blank" rel="noreferrer"><Download size={14}/> Download</a>
        {write&&onSave&&(item.saved?<Badge tone="success">On shelf</Badge>:<Button variant="ghost" onClick={onSave}><BookMarked size={14}/> Save</Button>)}
        {write&&onRemove&&<Button variant="ghost" title="Remove from shelf" onClick={onRemove}><Trash2 size={14}/></Button>}
      </div>
    </div>
  </article>
}

export function ElibraryPage(){
  const{principal}=useAuth(),write=can(principal,"school:write");
  const[tab,setTab]=useState<"browse"|"shelf">("browse");
  const[taxonomy,setTaxonomy]=useState<Taxonomy|null>(null),[status,setStatus]=useState<Row|null>(null);
  const[filters,setFilters]=useState(blank),[query,setQuery]=useState(blank),[page,setPage]=useState(1);
  const[result,setResult]=useState<Row|null>(null),[shelf,setShelf]=useState<Row[]>([]);
  const[loading,setLoading]=useState(true),[message,setMessage]=useState("");

  useEffect(()=>{
    Promise.all([get<Taxonomy>(`${base}/taxonomy`),get<Row>(`${base}/status`)]).then(([t,s])=>{setTaxonomy(t);setStatus(s)}).catch(e=>setMessage(errorText(e)));
  },[principal?.organizationId]);

  async function search(){
    setLoading(true);setMessage("");
    try{
      const params=new URLSearchParams({page:String(page),pageSize:"24"});
      for(const[key,value]of Object.entries(query))if(value)params.set(key,value);
      setResult(await get<Row>(`${base}/resources?${params}`));
    }catch(e){setMessage(errorText(e))}finally{setLoading(false)}
  }
  async function loadShelf(){
    setLoading(true);setMessage("");
    try{setShelf(await get<Row[]>(`${base}/shelf`))}catch(e){setMessage(errorText(e))}finally{setLoading(false)}
  }
  useEffect(()=>{if(tab==="browse")void search();else void loadShelf()},[tab,query,page,principal?.organizationId]);

  const set=(key:keyof typeof blank,value:string)=>setFilters(f=>({...f,[key]:value}));
  function apply(next=filters){setPage(1);setQuery(next)}
  async function save(item:Row){
    try{await post(`${base}/shelf`,{slug:item.slug});setMessage(`“${item.title}” saved to the school shelf.`);setResult(r=>r&&{...r,items:r.items.map((x:Row)=>x.slug===item.slug?{...x,saved:true}:x)})}catch(e){setMessage(errorText(e))}
  }
  async function remove(item:Row){
    if(!confirm(`Remove “${item.title}” from the school shelf?`))return;
    try{await del(`${base}/shelf/${item.id}`);setMessage("Removed from the shelf.");await loadShelf()}catch(e){setMessage(errorText(e))}
  }

  return <div className="page school-shell">
    <div className="school-page-head"><div><span className="eyebrow">School management · Academics</span><h1>E-library</h1><p>Past papers, notes, schemes of work, lesson plans and curricula from the ULibTech library at notesug.com. Save what your teachers use to the school shelf.</p></div><div className="heading-actions"><Button variant="secondary" onClick={()=>void(tab==="browse"?search():loadShelf())}><RefreshCw size={15}/> Refresh</Button></div></div>

    <div className="elib-ai"><Bot/><div><b>Use it with Ledgerly AI</b><span>Ask Elimu or the Director of Studies, for example: “Using the e-library, draft a P5 Science scheme of work for Term 3” or “Prepare Monday's P7 SST lesson plan on economic developments in Africa”. Drafts wait for your approval before they are saved.{status&&!status.fullTextForAi&&" (Full-text access for AI is not configured on this server yet.)"}</span></div></div>

    <div className="elib-tabs"><button className={tab==="browse"?"is-on":""} onClick={()=>setTab("browse")}><Library size={15}/> Browse library</button><button className={tab==="shelf"?"is-on":""} onClick={()=>setTab("shelf")}><BookMarked size={15}/> School shelf{shelf.length?` (${shelf.length})`:""}</button></div>

    {tab==="browse"&&<Card className="school-panel">
      <form className="elib-filters" onSubmit={e=>{e.preventDefault();apply()}}>
        <label className="elib-search"><Search size={16}/><input value={filters.q} onChange={e=>set("q",e.target.value)} placeholder="Search e.g. “P6 SST term 2 past paper” or “photosynthesis notes”"/></label>
        <select value={filters.class} onChange={e=>set("class",e.target.value)}><option value="">All classes</option>{taxonomy?.levels.map(level=><optgroup key={level.slug} label={level.name}>{level.classes.map(c=><option key={c.slug} value={c.slug}>{c.name}</option>)}</optgroup>)}</select>
        <select value={filters.subject} onChange={e=>set("subject",e.target.value)}><option value="">All subjects</option>{taxonomy?.subjects.map(s=><option key={s.slug} value={s.slug}>{s.name}</option>)}</select>
        <select value={filters.type} onChange={e=>set("type",e.target.value)}><option value="">All types</option>{taxonomy?.types.map(t=><option key={t.slug} value={t.slug}>{t.name}{t.count?` (${t.count})`:""}</option>)}</select>
        <select value={filters.term} onChange={e=>set("term",e.target.value)}><option value="">Any term</option>{taxonomy?.terms.map(t=><option key={t.slug} value={t.slug}>{t.name}</option>)}</select>
        <Button type="submit">Search</Button>
        {Object.values(query).some(Boolean)&&<Button type="button" variant="ghost" onClick={()=>{setFilters(blank);apply(blank)}}>Clear</Button>}
      </form>
      {message&&<div className="ops-pad"><Notice tone={/saved|removed/i.test(message)?"success":"danger"}>{message}</Notice></div>}
      {result?.didYouMean&&<div className="ops-pad"><Notice tone="info">Did you mean <button className="link-button" onClick={()=>{const next={...filters,q:result.didYouMean};setFilters(next);apply(next)}}>{result.didYouMean}</button>?</Notice></div>}
      {loading?<Spinner label="Searching the e-library"/>:result?.items?.length?<>
        <div className="elib-meta">{Number(result.total).toLocaleString()} resource{result.total===1?"":"s"}</div>
        <div className="elib-grid">{result.items.map((item:Row)=><ResourceCard key={item.slug} item={item} write={write} onSave={()=>void save(item)}/>)}</div>
        {result.totalPages>1&&<div className="elib-pager"><Button variant="secondary" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</Button><span>Page {result.page} of {result.totalPages}</span><Button variant="secondary" disabled={page>=result.totalPages} onClick={()=>setPage(p=>p+1)}>Next</Button></div>}
      </>:<EmptyState title="No resources found" description="Try fewer filters or different words."/>}
    </Card>}

    {tab==="shelf"&&<Card className="school-panel">
      <div className="school-panel-head"><div><h2>School shelf</h2><p>Resources your school has chosen. Ledgerly AI prefers these when drafting schemes and lesson plans.</p></div></div>
      {message&&<div className="ops-pad"><Notice tone={/saved|removed/i.test(message)?"success":"danger"}>{message}</Notice></div>}
      {loading?<Spinner/>:shelf.length?<div className="elib-grid">{shelf.map(item=><ResourceCard key={item.id} item={item} write={write} onRemove={()=>void remove(item)}/>)}</div>
      :<EmptyState title="The shelf is empty" description="Browse the library and press Save on resources your teachers use." action={<Button onClick={()=>setTab("browse")}><Library size={15}/> Browse library</Button>}/>}
    </Card>}
  </div>
}

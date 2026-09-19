import { useCallback, useEffect, useState } from "react";
import {
  Activity, Brain, Check, CheckCircle2, Database, RefreshCcw, ShieldCheck,
  Sparkles, ThumbsDown, TrendingUp, X, XCircle,
} from "lucide-react";
import { errorText, get, post } from "../../../web/api";

type LearningStatus={
  organization_id?:string;
  candidates:number;
  approved:number;
  rejected:number;
  feedback_positive:number;
  feedback_negative:number;
  corrections:number;
  training_runs:number;
  adapters:number;
  readiness:"empty"|"collecting"|"sft-ready"|"preference-ready"|"unavailable";
};
type StyleProfile={
  organization_id?:string;
  approved_examples?:number;
  preferred_register?:string;
  preferred_strategy?:string;
  average_words?:number;
  average_sentence_words?:number;
  heading_rate?:number;
  bullet_rate?:number;
  concise_rate?:number;
  rules?:string[];
};
type TrainingExample={
  example_id:string;
  purpose:string;
  request:string;
  response_text:string;
  register?:string|null;
  strategy_id?:string;
  quality_overall:number;
  source:string;
  status:string;
  tags:string[];
  created_at?:string;
  updated_at?:string;
};
type TrainingRun={
  run_id:string;
  objective:string;
  mode:string;
  base_model:string;
  dataset_path:string;
  output_dir:string;
  status:string;
  metrics:Record<string,unknown>;
  created_at:string;
  completed_at?:string;
};
type Adapter={
  adapter_id:string;
  name:string;
  base_model:string;
  path:string;
  active:boolean;
  metrics:Record<string,unknown>;
  created_at:string;
};
type LearningCenterData={
  status:LearningStatus;
  style:StyleProfile;
  candidates:TrainingExample[];
  runs:TrainingRun[];
  adapters:Adapter[];
};

const EMPTY:LearningCenterData={
  status:{candidates:0,approved:0,rejected:0,feedback_positive:0,feedback_negative:0,corrections:0,training_runs:0,adapters:0,readiness:"empty"},
  style:{},candidates:[],runs:[],adapters:[],
};

function pct(value?:number){return `${Math.round(Number(value||0)*100)}%`;}
function when(value?:string){if(!value)return "—";const date=new Date(value);return Number.isNaN(date.valueOf())?value:date.toLocaleString();}
function readinessLabel(value:string){return value.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());}

export function ResponseLearningCenterPage(){
  const[data,setData]=useState<LearningCenterData>(EMPTY),[loading,setLoading]=useState(true),[error,setError]=useState(""),[busyId,setBusyId]=useState("");

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{setData(await get<LearningCenterData>("/agentic-employees/chat-studio/learning-center"));}
    catch(err){setError(errorText(err));}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{void load();},[load]);

  async function review(example:TrainingExample,status:"approve"|"reject"){
    setBusyId(example.example_id);setError("");
    try{
      await post<TrainingExample>(`/agentic-employees/chat-studio/training-examples/${encodeURIComponent(example.example_id)}/${status}`,{});
      await load();
    }catch(err){setError(errorText(err));}
    finally{setBusyId("");}
  }

  const activeAdapter=data.adapters.find(item=>item.active);

  return <main className="rlc-page">
    <header className="rlc-hero">
      <div><span className="rlc-kicker"><Brain size={14}/> TRAINABLE RESPONSE INTELLIGENCE</span><h1>Learning Center</h1><p>Review what Ledgerly is allowed to learn, track training readiness, and inspect trained response adapters. Candidate responses never become learned examples until a trusted reviewer approves them.</p></div>
      <button type="button" onClick={()=>void load()} disabled={loading}><RefreshCcw className={loading?"spin":""} size={15}/>Refresh</button>
    </header>

    {error&&<div className="rlc-error"><XCircle size={15}/><span>{error}</span></div>}

    <section className="rlc-score-grid">
      <Score title="Candidates" value={data.status.candidates} detail="Waiting for trusted review" icon={<Activity size={16}/>}/>
      <Score title="Approved" value={data.status.approved} detail="Available for retrieval learning" icon={<CheckCircle2 size={16}/>}/>
      <Score title="Corrections" value={data.status.corrections} detail="Trusted corrected responses" icon={<Sparkles size={16}/>}/>
      <Score title="Readiness" value={readinessLabel(data.status.readiness)} detail="Dataset training stage" icon={<TrendingUp size={16}/>}/>
    </section>

    <section className="rlc-layout">
      <div className="rlc-main">
        <section className="rlc-card">
          <div className="rlc-section-head"><div><small>HUMAN SUPERVISION</small><h2>Training review queue</h2><p>Only approved examples influence future response retrieval and supervised fine-tuning.</p></div><span>{data.candidates.length} pending</span></div>
          {loading?<Loading/>:data.candidates.length===0?<Empty title="No candidates waiting" text="High-quality responses and user corrections will appear here when they need review."/>:
          <div className="rlc-candidates">{data.candidates.map(item=><article className="rlc-example" key={item.example_id}>
            <div className="rlc-example-head"><div><span>{item.purpose}</span><b>{item.strategy_id||"adaptive strategy"}</b></div><strong>{Math.round(item.quality_overall*100)}%</strong></div>
            <div className="rlc-example-copy"><small>REQUEST</small><p>{item.request}</p></div>
            <div className="rlc-example-copy response"><small>LEARNABLE RESPONSE</small><p>{item.response_text}</p></div>
            <div className="rlc-example-meta"><span>{item.source}</span>{item.register&&<span>{item.register}</span>}{item.tags?.slice(0,5).map(tag=><span key={tag}>{tag}</span>)}<time>{when(item.updated_at||item.created_at)}</time></div>
            <div className="rlc-review-actions"><button className="reject" disabled={busyId===item.example_id} onClick={()=>void review(item,"reject")}><X size={13}/>Reject</button><button className="approve" disabled={busyId===item.example_id} onClick={()=>void review(item,"approve")}>{busyId===item.example_id?<Activity className="spin" size={13}/>:<Check size={13}/>}Approve for learning</button></div>
          </article>)}</div>}
        </section>

        <section className="rlc-card">
          <div className="rlc-section-head"><div><small>MODEL EVOLUTION</small><h2>Training runs</h2><p>Offline SFT/DPO and LoRA/QLoRA runs registered by the Python training service.</p></div><span>{data.runs.length} shown</span></div>
          {!data.runs.length?<Empty title="No model training runs yet" text="Approved examples still improve retrieval learning immediately; model fine-tuning is optional."/>:
          <div className="rlc-table-wrap"><table><thead><tr><th>Objective</th><th>Mode</th><th>Base model</th><th>Status</th><th>Started</th></tr></thead><tbody>{data.runs.map(run=><tr key={run.run_id}><td>{run.objective.toUpperCase()}</td><td>{run.mode.toUpperCase()}</td><td>{run.base_model}</td><td><span className={`rlc-status ${run.status}`}>{run.status}</span></td><td>{when(run.created_at)}</td></tr>)}</tbody></table></div>}
        </section>
      </div>

      <aside className="rlc-side">
        <section className="rlc-card">
          <div className="rlc-section-head compact"><div><small>LEARNED ORGANIZATION STYLE</small><h2>Style profile</h2></div></div>
          <div className="rlc-style-grid"><Mini label="Examples" value={String(data.style.approved_examples||0)}/><Mini label="Typical length" value={`${Math.round(data.style.average_words||0)} words`}/><Mini label="Sentence size" value={`${Math.round(data.style.average_sentence_words||0)} words`}/><Mini label="Concise rate" value={pct(data.style.concise_rate)}/></div>
          <div className="rlc-profile-row"><span>Preferred register</span><b>{data.style.preferred_register||"Adaptive"}</b></div>
          <div className="rlc-profile-row"><span>Preferred strategy</span><b>{data.style.preferred_strategy||"Adaptive"}</b></div>
          {!!data.style.rules?.length&&<div className="rlc-rules">{data.style.rules.map((rule,i)=><p key={i}>{rule}</p>)}</div>}
        </section>

        <section className="rlc-card">
          <div className="rlc-section-head compact"><div><small>TRAINED MODELS</small><h2>Adapters</h2></div></div>
          {activeAdapter&&<div className="rlc-active-adapter"><ShieldCheck size={17}/><div><small>ACTIVE ADAPTER</small><b>{activeAdapter.name}</b><span>{activeAdapter.base_model}</span></div></div>}
          {!data.adapters.length?<Empty title="No adapters registered" text="The response engine will continue using retrieval learning and the school's configured AI provider."/>:<div className="rlc-adapters">{data.adapters.map(adapter=><div key={adapter.adapter_id} className={adapter.active?"active":""}><Database size={14}/><div><b>{adapter.name}</b><span>{adapter.base_model}</span><small>{adapter.active?"Active":"Available"} · {when(adapter.created_at)}</small></div></div>)}</div>}
        </section>

        <section className="rlc-card rlc-governance">
          <ShieldCheck size={19}/><div><h3>Governed learning</h3><p>Normal user feedback is collected for review. Owner/admin approval is required before it becomes trusted learning material. Training data is privacy-redacted by default.</p></div>
        </section>
      </aside>
    </section>
  </main>;
}

function Score({title,value,detail,icon}:{title:string;value:string|number;detail:string;icon:React.ReactNode}){return <div className="rlc-score"><span>{icon}</span><div><small>{title}</small><b>{value}</b><p>{detail}</p></div></div>;}
function Mini({label,value}:{label:string;value:string}){return <div className="rlc-mini"><small>{label}</small><b>{value}</b></div>;}
function Loading(){return <div className="rlc-loading"><Activity className="spin" size={18}/><span>Loading learning state…</span></div>;}
function Empty({title,text}:{title:string;text:string}){return <div className="rlc-empty"><Brain size={21}/><b>{title}</b><span>{text}</span></div>;}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowRight, Bot, Check, ChevronDown, CircleDot, Clock3, Command,
  Database, Download, FileJson, FileSpreadsheet, FileText, Filter, Gauge,
  Layers3, Play, Search, ShieldCheck, Sparkles, Table2, TerminalSquare, ThumbsDown, ThumbsUp, X
} from "lucide-react";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { errorText, get, post } from "../../../web/api";

type Agent={key:string;name:string;title:string;enabled:boolean;modelTier:string};
type Conversation={id:string;agentKey:string;status:string;title:string};
type FieldControl="text"|"textarea"|"date"|"number"|"boolean"|"enum"|"reference"|"json"|"array";
type CommandField={name:string;requestKey:string;label:string;control:FieldControl;required:boolean;location:"path"|"body"|"query"|"native"|"meta";enum?:string[];notes?:string;referenceKey?:string;min?:number;max?:number;integer?:boolean;defaultValue?:unknown};
type CommandDescriptor={toolName:string;command:string;aliases:string[];description:string;module:string;group:string;kind:string;source:"route"|"native";readOnly:boolean;method?:string;pathTemplate?:string;schemaCoverage:string;fields:CommandField[];outputFormats:string[]};
type CommandCatalog={commands:CommandDescriptor[];stats:{toolCount:number;commandCount:number;routeTools:number;nativeTools:number;writes:number;reads:number}};
type RunResponse={prepared:boolean;result:unknown;assistantMessage?:{content:string};command:CommandDescriptor};
type OutputFormat="table"|"json"|"csv"|"xlsx"|"pdf"|"approval";
type HistoryItem={id:string;command:string;agent:string;format:string;when:string;prepared:boolean;result:unknown};
type AnalysisMode="analyse"|"account-for";
type AnalysisTopic={id:string;label:string;category:string;description:string;entityTypes:string[];evidence:string[];questions:string[];examples:string[];supported?:boolean;supportHits?:number};
type AnalysisEntity={id:string;type:string;label:string;subtitle:string;referenceKey:string;score:number;metadata?:Record<string,unknown>};
type AnalysisGuidance={mode:AnalysisMode;topics:AnalysisTopic[];categories:string[];entityTypes:string[];stats:{knowledgeTopics:number;readCapabilities:number}};

const FORMAT_META:Record<string,{label:string;icon:typeof Table2;hint:string}>={
  table:{label:"Interactive table",icon:Table2,hint:"Best for browsing records on screen"},
  json:{label:"JSON",icon:FileJson,hint:"Structured developer/raw output"},
  csv:{label:"CSV",icon:Download,hint:"Simple spreadsheet-compatible export"},
  xlsx:{label:"Excel",icon:FileSpreadsheet,hint:"Formatted workbook download"},
  pdf:{label:"PDF",icon:FileText,hint:"Printable report snapshot"},
  approval:{label:"Approval workflow",icon:ShieldCheck,hint:"Write commands are reviewed before execution"},
};

const ANALYSE_COMMAND:CommandDescriptor={
  toolName:"__guided_analyse__",
  command:"analyse",
  aliases:["analyze","analysis","investigate","study pattern","compare evidence","find causes","diagnose trend"],
  description:"Guided evidence analysis across Ledgerly. The system suggests supported investigation areas, resolves entities and builds a fresh evidence plan.",
  module:"agentic",group:"guided analysis",kind:"analysis",source:"native",readOnly:true,schemaCoverage:"dynamic-evidence-planner",
  fields:[{name:"prompt",requestKey:"prompt",label:"What should Ledgerly analyse?",control:"textarea",required:true,location:"meta",notes:"Choose a suggested area or describe your own question. The investigation plan is built from live evidence."}],
  outputFormats:["table","json","csv","xlsx","pdf"],
};
const ACCOUNT_FOR_COMMAND:CommandDescriptor={
  toolName:"__guided_account_for__",
  command:"account for",
  aliases:["explain","explain why","account for","investigate why","why did","reason for","explain outcome"],
  description:"Evidence-based explanation of an outcome. Ledgerly tests competing explanations, counter-evidence and missing evidence instead of inventing causes.",
  module:"agentic",group:"guided explanation",kind:"analysis",source:"native",readOnly:true,schemaCoverage:"dynamic-evidence-explanation",
  fields:[{name:"prompt",requestKey:"prompt",label:"What outcome should Ledgerly account for?",control:"textarea",required:true,location:"meta",notes:"Name the outcome or problem. Add a person, class, account or other entity when relevant."}],
  outputFormats:["table","json","csv","xlsx","pdf"],
};

const RESEARCH_COMMAND:CommandDescriptor={
  toolName:"__web_research__",
  command:"research",
  aliases:["web research","search web","search the web","online research","external research","public sources","latest public information"],
  description:"Research current or external public information using the configured web-search provider, with source attribution and Ledgerly evidence kept separate.",
  module:"agentic",group:"external research",kind:"analysis",source:"native",readOnly:true,schemaCoverage:"live-web-reference-research",
  fields:[{name:"prompt",requestKey:"prompt",label:"What should Ledgerly research?",control:"textarea",required:true,location:"meta",notes:"Ask for external or current public information. Web research is used only when the server has an enabled search provider."}],
  outputFormats:["table","json","pdf"],
};

const COMPOSITE_COMMAND:CommandDescriptor={
  toolName:"__composite_report__",
  command:"composite report",
  aliases:["custom report","cross module report","combined report","compare data","analyze across modules","advanced report","report builder"],
  description:"Build a read-only report by planning and combining multiple permitted Ledgerly data capabilities.",
  module:"agentic",
  group:"composite reporting",
  kind:"analysis",
  source:"native",
  readOnly:true,
  schemaCoverage:"dynamic-multi-tool",
  fields:[{name:"prompt",requestKey:"prompt",label:"Report request",control:"textarea",required:true,location:"meta",notes:"Describe the records, comparisons, thresholds and periods. Ledgerly will plan the required read-only data steps."}],
  outputFormats:["table","json","csv","xlsx","pdf"],
};


export function AgenticCommandCenterPage(){
  const[agents,setAgents]=useState<Agent[]>([]);
  const[agentKey,setAgentKey]=useState("headteacher");
  const[catalog,setCatalog]=useState<CommandCatalog|null>(null);
  const[search,setSearch]=useState("");
  const[moduleFilter,setModuleFilter]=useState("all");
  const[kindFilter,setKindFilter]=useState("all");
  const[selected,setSelected]=useState<CommandDescriptor|null>(null);
  const[values,setValues]=useState<Record<string,unknown>>({});
  const[format,setFormat]=useState<OutputFormat>("table");
  const[step,setStep]=useState<1|2|3>(1);
  const[running,setRunning]=useState(false);
  const[result,setResult]=useState<unknown>(null);
  const[prepared,setPrepared]=useState(false);
  const[error,setError]=useState("");
  const[history,setHistory]=useState<HistoryItem[]>([]);
  const promptRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{void loadAgents();},[]);
  useEffect(()=>{if(agentKey)void loadCatalog(agentKey);},[agentKey]);
  useEffect(()=>{promptRef.current?.focus();},[]);

  async function loadAgents(){
    try{
      const list=await get<Agent[]>("/agentic-employees/agents");
      setAgents(list.filter(a=>a.enabled));
      if(!list.some(a=>a.key===agentKey&&a.enabled)){
        const next=list.find(a=>a.enabled)?.key;if(next)setAgentKey(next);
      }
    }catch(err){setError(errorText(err));}
  }
  async function loadCatalog(key:string){
    setError("");setCatalog(null);setSelected(null);setResult(null);
    try{setCatalog(await get<CommandCatalog>("/agentic-employees/chat-studio/commands?agentKey="+encodeURIComponent(key)));}
    catch(err){setError(errorText(err));}
  }

  const modules=useMemo(()=>[...new Set((catalog?.commands||[]).map(c=>c.module))].sort(),[catalog]);
  const kinds=useMemo(()=>[...new Set((catalog?.commands||[]).map(c=>c.kind))].sort(),[catalog]);
  const matches=useMemo(()=>{
    const needle=search.trim().replace(/^\//,"").toLowerCase();
    return [ANALYSE_COMMAND,ACCOUNT_FOR_COMMAND,RESEARCH_COMMAND,COMPOSITE_COMMAND,...(catalog?.commands||[])]
      .filter(c=>moduleFilter==="all"||c.module===moduleFilter)
      .filter(c=>kindFilter==="all"||c.kind===kindFilter)
      .map(c=>({c,score:scoreCommand(c,needle)}))
      .filter(x=>!needle||x.score>0)
      .sort((a,b)=>b.score-a.score||a.c.command.localeCompare(b.c.command))
      .slice(0,80).map(x=>x.c);
  },[catalog,search,moduleFilter,kindFilter]);

  function choose(command:CommandDescriptor){
    setSelected(command);setResult(null);setPrepared(false);setError("");setStep(1);
    const defaults:Record<string,unknown>={};
    for(const field of command.fields)if(field.defaultValue!==undefined)defaults[field.name]=field.defaultValue==="$today"?new Date().toISOString().slice(0,10):field.defaultValue;
    if(command.toolName==="__composite_report__")defaults.prompt=search.trim().replace(/^\//,"");
    if(command.toolName==="__web_research__"){
      const raw=search.trim().replace(/^\//,"");
      defaults.prompt=raw.replace(/^research\s*/i,"");
    }
    if(command.toolName==="__guided_analyse__"||command.toolName==="__guided_account_for__"){
      const raw=search.trim().replace(/^\//,"");
      defaults.prompt=raw.replace(command.toolName==="__guided_analyse__"?/^analy[sz]e\s*/i:/^account\s+for\s*/i,"");
    }
    setValues(defaults);
    setFormat((command.outputFormats?.[0]||(command.readOnly?"table":"approval")) as OutputFormat);
  }

  const criteria=selected?.fields.filter(f=>f.location==="query")||[];
  const inputs=selected?.fields.filter(f=>f.location!=="query")||[];
  const outputFormats=(selected?.outputFormats?.length?selected.outputFormats:(selected?.readOnly?["table","json","csv","xlsx"]:["approval"])) as OutputFormat[];

  async function ensureConversation(){
    const conversations=await get<Conversation[]>("/agentic-employees/conversations");
    const existing=conversations.find(c=>c.agentKey===agentKey&&c.status!=="closed");
    if(existing)return existing;
    const agent=agents.find(a=>a.key===agentKey);
    return post<Conversation>("/agentic-employees/conversations",{agentKey,title:(agent?.title||agent?.name||"Command Center")+" commands"});
  }

  async function run(){
    if(!selected||running)return;
    const missing=selected.fields.filter(f=>f.required&&(values[f.name]===undefined||values[f.name]===null||String(values[f.name]).trim()===""));
    if(missing.length){setError("Complete required fields: "+missing.map(f=>f.label).join(", "));setStep(1);return;}
    setRunning(true);setError("");setResult(null);setPrepared(false);
    try{
      const conversation=await ensureConversation();
      if(selected.toolName==="__guided_analyse__"||selected.toolName==="__guided_account_for__"){
        const mode:AnalysisMode=selected.toolName==="__guided_account_for__"?"account-for":"analyse";
        const guided=await post<any>("/agentic-employees/chat-studio/conversations/"+conversation.id+"/guided-analysis",{
          mode,prompt:String(values.prompt||""),topicId:values.topicId||null,entity:values.entity||null,outputFormat:format
        });
        setResult(guided);setPrepared(false);
        if(guided?.needsEntity){
          setValues(v=>({...v,entityQuery:guided.entityQuery||v.entityQuery,serverEntityOptions:guided.entityOptions||[]}));
          setStep(1);
        }else setStep(3);
        setHistory(h=>[{id:String(Date.now()),command:selected.command,agent:agentKey,format,when:new Date().toISOString(),prepared:false,result:guided},...h].slice(0,20));
        if(!guided?.needsEntity&&!guided?.needsCriteria&&["csv","xlsx","pdf"].includes(format))exportResult(guided,format,selected.command);
      }else if(selected.toolName==="__composite_report__"){
        const composite=await post<any>("/agentic-employees/chat-studio/conversations/"+conversation.id+"/composite-report",{prompt:String(values.prompt||""),outputFormat:format});
        setResult(composite);setPrepared(false);setStep(3);
        setHistory(h=>[{id:String(Date.now()),command:selected.command,agent:agentKey,format,when:new Date().toISOString(),prepared:false,result:composite},...h].slice(0,20));
        if(["csv","xlsx","pdf"].includes(format)&&!composite?.needsCriteria)exportResult(composite,format,selected.command);
      }else if(selected.toolName==="__web_research__"){
        const prompt=String(values.prompt||"").trim();
        const response=await post<any>("/agentic-employees/conversations/"+conversation.id+"/light-messages",{content:"/research "+prompt});
        const research={
          humanResponse:response.content,
          model:response.model,
          toolEvents:response.toolEvents||[],
          routing:response.routing||{},
          responseMeta:{
            fingerprint:response.routing?.responseFingerprint,
            trainingExampleId:response.routing?.trainingExampleId,
            responseEngine:response.routing?.responseEngine,
            responseQuality:response.routing?.responseQuality,
          },
        };
        setResult(research);setPrepared(false);setStep(3);
        setHistory(h=>[{id:String(Date.now()),command:selected.command,agent:agentKey,format,when:new Date().toISOString(),prepared:false,result:research},...h].slice(0,20));
        if(format==="pdf")exportResult(research,format,selected.command);
      }else{
        const response=await post<RunResponse>("/agentic-employees/chat-studio/conversations/"+conversation.id+"/quick-command",{
          toolName:selected.toolName,values,commandText:"/"+selected.command,outputFormat:format
        });
        setResult(response.result);setPrepared(Boolean(response.prepared));setStep(3);
        setHistory(h=>[{id:String(Date.now()),command:selected.command,agent:agentKey,format,when:new Date().toISOString(),prepared:Boolean(response.prepared),result:response.result},...h].slice(0,20));
        if(!response.prepared&&["csv","xlsx","pdf"].includes(format))exportResult(response.result,format,selected.command);
      }
    }catch(err){setError(errorText(err));}finally{setRunning(false);}
  }

  return <div className="acc-page">
    <header className="acc-hero">
      <div className="acc-title"><span className="acc-terminal-logo"><TerminalSquare size={22}/></span><div><p>LEDGERLY AGENTIC RUNTIME</p><h1>Command Center</h1><span>High-level command line for school operations, queries, reports and governed actions.</span></div></div>
      <div className="acc-agent-select"><Bot size={16}/><select value={agentKey} onChange={e=>setAgentKey(e.target.value)}>{agents.map(a=><option key={a.key} value={a.key}>{a.name} · {a.modelTier.toUpperCase()}</option>)}</select><ChevronDown size={14}/></div>
    </header>

    <section className="acc-stats">
      <Stat icon={Command} label="Commands" value={catalog?.stats.commandCount??"—"}/>
      <Stat icon={Gauge} label="Tools" value={catalog?.stats.toolCount??"—"}/>
      <Stat icon={Database} label="Read capabilities" value={catalog?.stats.reads??"—"}/>
      <Stat icon={ShieldCheck} label="Governed writes" value={catalog?.stats.writes??"—"}/>
      <Stat icon={Layers3} label="Modules" value={modules.length||"—"}/>
    </section>

    <div className="acc-shell">
      <aside className="acc-browser">
        <div className="acc-prompt-wrap">
          <span className="acc-prompt-mark">/</span>
          <input ref={promptRef} value={search.replace(/^\//,"")} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&matches[0])choose(matches[0]);}} placeholder="create student, report fees, find attendance..."/>
          {search&&<button onClick={()=>setSearch("")}><X size={14}/></button>}
        </div>
        <div className="acc-filters">
          <label><Filter size={13}/><select value={moduleFilter} onChange={e=>setModuleFilter(e.target.value)}><option value="all">All modules</option>{modules.map(m=><option key={m}>{m}</option>)}</select></label>
          <label><CircleDot size={13}/><select value={kindFilter} onChange={e=>setKindFilter(e.target.value)}><option value="all">All operations</option>{kinds.map(k=><option key={k}>{k}</option>)}</select></label>
        </div>
        <div className="acc-browser-label"><span>{matches.length} visible</span><small>type / then search</small></div>
        <div className="acc-command-list">
          {matches.map(c=><button key={c.toolName} className={selected?.toolName===c.toolName?"active":""} onClick={()=>choose(c)}>
            <span className={"acc-kind acc-kind-"+c.kind}>{kindInitial(c.kind)}</span>
            <span className="acc-command-copy"><b>/{c.command}</b><small>{c.description}</small><em>{c.module} · {c.group}</em></span>
            <ArrowRight size={15}/>
          </button>)}
          {!matches.length&&<div className="acc-empty"><Search size={25}/><b>No matching command</b><span>Try a broader phrase such as student, fees, report, staff or attendance.</span></div>}
        </div>
      </aside>

      <main className="acc-workbench">
        {!selected?<Welcome catalog={catalog}/>:<>
          <div className="acc-command-head">
            <div><span className="acc-command-path">/{selected.command}</span><h2>{humanize(selected.command)}</h2><p>{selected.description}</p></div>
            <div className="acc-command-badges"><span>{selected.kind}</span><span>{selected.module}</span><span className={selected.readOnly?"read":"write"}>{selected.readOnly?"READ":"APPROVAL-GATED WRITE"}</span></div>
          </div>

          <div className="acc-steps">
            <Step n={1} label={selected.readOnly?"Criteria & inputs":"Validated inputs"} active={step===1} done={step>1} onClick={()=>setStep(1)}/>
            <Step n={2} label="Output & review" active={step===2} done={step>2} onClick={()=>setStep(2)}/>
            <Step n={3} label="Result" active={step===3} done={false} onClick={()=>result!==null&&setStep(3)}/>
          </div>

          {step===1&&<div className="acc-panel">
            {criteria.length>0&&<section><div className="acc-section-title"><Search size={16}/><div><b>Query criteria</b><small>Optional filters narrow the data before Ledgerly runs the query.</small></div></div><div className="acc-fields">{criteria.map(f=><Field key={f.name} field={f} value={values[f.name]} agentKey={agentKey} onChange={v=>setValues(x=>({...x,[f.name]:v}))}/>)}</div></section>}
            {(selected.toolName==="__guided_analyse__"||selected.toolName==="__guided_account_for__")?
              <GuidedAnalysisBuilder mode={selected.toolName==="__guided_account_for__"?"account-for":"analyse"} agentKey={agentKey} values={values} onChange={patch=>setValues(x=>({...x,...patch}))}/>:
              inputs.length>0&&<section><div className="acc-section-title"><Database size={16}/><div><b>{selected.readOnly?"Command inputs":"Validated action details"}</b><small>{selected.readOnly?"Choose any records or required context.":"Writes are validated now and still require approval before Ledgerly changes data."}</small></div></div><div className="acc-fields">{inputs.map(f=><Field key={f.name} field={f} value={values[f.name]} agentKey={agentKey} onChange={v=>setValues(x=>({...x,[f.name]:v}))}/>)}</div></section>}
            {!criteria.length&&!inputs.length&&<div className="acc-ready-card"><Sparkles size={24}/><b>No extra criteria required</b><span>This command can run immediately using your current organization and permissions.</span></div>}
            <div className="acc-actions"><button className="acc-primary" onClick={()=>setStep(2)}>Continue to output <ArrowRight size={15}/></button></div>
          </div>}

          {step===2&&<div className="acc-panel">
            <section><div className="acc-section-title"><Table2 size={16}/><div><b>Output format</b><small>Choose how the result should be presented or exported.</small></div></div>
              <div className="acc-format-grid">{outputFormats.map(fmt=>{const meta=FORMAT_META[fmt]||FORMAT_META.table;const Icon=meta.icon;return <button key={fmt} className={format===fmt?"active":""} onClick={()=>setFormat(fmt)}><Icon size={20}/><span><b>{meta.label}</b><small>{meta.hint}</small></span>{format===fmt&&<Check size={16}/>}</button>;})}</div>
            </section>
            <section><div className="acc-section-title"><Activity size={16}/><div><b>Execution review</b><small>Command Center will use the selected AI employee’s allowed tool catalog and your own permissions.</small></div></div>
              <div className="acc-review">
                <Review label="Command" value={"/"+selected.command}/><Review label="Method" value={selected.method||selected.source}/><Review label="Module" value={selected.module}/><Review label="Criteria" value={String(criteria.filter(f=>values[f.name]!==undefined&&values[f.name]!=="").length)}/><Review label="Output" value={FORMAT_META[format]?.label||format}/>
              </div>
              {!selected.readOnly&&<div className="acc-guard"><ShieldCheck size={18}/><div><b>Human approval remains mandatory</b><span>This command prepares a governed action. It does not silently write to Ledgerly.</span></div></div>}
            </section>
            <div className="acc-actions"><button onClick={()=>setStep(1)}>Back</button><button className="acc-run" disabled={running} onClick={()=>void run()}>{running?<><Activity className="spin" size={15}/> Running…</>:<><Play size={15}/> Run /{selected.command}</>}</button></div>
          </div>}

          {step===3&&<div className="acc-panel">
            {prepared?<div className="acc-result-banner approval"><ShieldCheck size={22}/><div><b>Action prepared for approval</b><span>The validated write request is in the normal Agentic Employees approval workflow.</span></div></div>:<div className="acc-result-banner"><Check size={22}/><div><b>Command completed</b><span>Result returned from the permitted Ledgerly capability.</span></div></div>}
            <ResultView value={result} format={format}/>
            {!prepared&&result!==null&&<div className="acc-export-row">{["csv","xlsx","pdf","json"].map(fmt=><button key={fmt} onClick={()=>exportResult(result,fmt as OutputFormat,selected.command)}><Download size={14}/> {fmt.toUpperCase()}</button>)}</div>}
            <div className="acc-actions"><button onClick={()=>{setResult(null);setStep(1);}}>Run again</button><button className="acc-primary" onClick={()=>{setSelected(null);setSearch("");setResult(null);promptRef.current?.focus();}}>New command <Command size={15}/></button></div>
          </div>}
        </>}
        {error&&<div className="acc-error"><X size={16}/><span>{error}</span><button onClick={()=>setError("")}>Dismiss</button></div>}
      </main>

      <aside className="acc-history">
        <div className="acc-history-title"><Clock3 size={15}/><b>Recent runs</b></div>
        {history.map(h=><button key={h.id} onClick={()=>{setResult(h.result);setPrepared(h.prepared);setStep(3);}}><span>/{h.command}</span><small>{new Date(h.when).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} · {h.format}</small></button>)}
        {!history.length&&<div className="acc-history-empty">Commands you run in this session will appear here.</div>}
      </aside>
    </div>
  </div>;
}

function Stat({icon:Icon,label,value}:{icon:typeof Command;label:string;value:string|number}){return <div><Icon size={17}/><span><b>{value}</b><small>{label}</small></span></div>;}
function Step({n,label,active,done,onClick}:{n:number;label:string;active:boolean;done:boolean;onClick:()=>void}){return <button className={active?"active":done?"done":""} onClick={onClick}><span>{done?<Check size={13}/>:n}</span><b>{label}</b></button>;}
function Review({label,value}:{label:string;value:string}){return <div><small>{label}</small><b>{value}</b></div>;}

function Welcome({catalog}:{catalog:CommandCatalog|null}){return <div className="acc-welcome">
  <span className="acc-welcome-icon"><Command size={30}/></span>
  <p>COMMAND-DRIVEN OPERATIONS</p><h2>Start with <code>/</code> and tell Ledgerly what you want to do.</h2>
  <span>This is not a raw developer shell. It discovers permitted business capabilities, asks for safe criteria and inputs, validates references, lets you choose the output, and routes writes through approval.</span>
  <div className="acc-example-grid">{["/analyse","/account for","/research","/composite report","/create student","/report fee balances","/find staff attendance"].map(x=><code key={x}>{x}</code>)}</div>
  <div className="acc-welcome-stats"><b>{catalog?.stats.toolCount??"Hundreds of"} live tools</b><span>expanded into {catalog?.stats.commandCount??"many"} searchable command phrases.</span></div>
</div>;}


function GuidedAnalysisBuilder({mode,agentKey,values,onChange}:{mode:AnalysisMode;agentKey:string;values:Record<string,unknown>;onChange:(patch:Record<string,unknown>)=>void}){
  const[guidance,setGuidance]=useState<AnalysisGuidance|null>(null);
  const[topicSearch,setTopicSearch]=useState("");
  const[entitySearch,setEntitySearch]=useState(String(values.entityQuery||""));
  const[entityOptions,setEntityOptions]=useState<AnalysisEntity[]>(Array.isArray(values.serverEntityOptions)?values.serverEntityOptions as AnalysisEntity[]:[]);
  const[loadingTopics,setLoadingTopics]=useState(false);
  const[loadingEntities,setLoadingEntities]=useState(false);
  const selectedTopic=guidance?.topics.find(t=>t.id===String(values.topicId||""))||null;
  useEffect(()=>{const t=window.setTimeout(()=>{void loadGuidance();},120);return()=>window.clearTimeout(t);},[mode,agentKey,topicSearch]);
  useEffect(()=>{if(Array.isArray(values.serverEntityOptions))setEntityOptions(values.serverEntityOptions as AnalysisEntity[]);},[values.serverEntityOptions]);
  useEffect(()=>{const t=window.setTimeout(()=>{if(entitySearch.trim().length>=2)void loadEntities();else if(!values.serverEntityOptions)setEntityOptions([]);},180);return()=>window.clearTimeout(t);},[entitySearch,selectedTopic?.id,agentKey]);

  async function loadGuidance(){
    setLoadingTopics(true);
    try{
      const data=await get<AnalysisGuidance>("/agentic-employees/chat-studio/analysis-guidance?agentKey="+encodeURIComponent(agentKey)+"&mode="+encodeURIComponent(mode)+"&q="+encodeURIComponent(topicSearch));
      setGuidance(data);
      if(!values.topicId&&topicSearch&&data.topics.length===1)onChange({topicId:data.topics[0]!.id});
    }catch{}finally{setLoadingTopics(false);}
  }
  async function loadEntities(){
    setLoadingEntities(true);
    try{
      const types=selectedTopic?.entityTypes?.join(",")||"";
      const data=await get<AnalysisEntity[]>("/agentic-employees/chat-studio/entity-options?q="+encodeURIComponent(entitySearch)+"&types="+encodeURIComponent(types)+"&limit=24");
      setEntityOptions(data);
    }catch{setEntityOptions([]);}finally{setLoadingEntities(false);}
  }
  function chooseTopic(topic:AnalysisTopic){
    onChange({topicId:topic.id,entity:null,entityQuery:"",serverEntityOptions:[]});
    setEntitySearch("");setEntityOptions([]);
  }
  function chooseEntity(entity:AnalysisEntity){
    onChange({entity,entityQuery:entity.label,serverEntityOptions:[]});
    setEntitySearch(entity.label);setEntityOptions([]);
  }
  const topics=guidance?.topics||[];
  return <section className="acc-analysis-builder">
    <div className="acc-section-title"><Sparkles size={16}/><div><b>{mode==="account-for"?"Guided explanation":"Guided analysis"}</b><small>{mode==="account-for"?"Choose what kind of outcome you want explained. Ledgerly will test evidence and competing explanations.":"Choose an investigation area so Ledgerly knows which evidence families to consider before planning the analysis."}</small></div></div>

    <div className="acc-analysis-search">
      <Search size={14}/><input value={topicSearch} onChange={e=>setTopicSearch(e.target.value)} placeholder="Search supported analysis: attendance, fees, lesson delivery, payroll, cash, books…"/>
      {loadingTopics&&<Activity className="spin" size={14}/>}
    </div>

    <div className="acc-topic-grid">
      {topics.slice(0,18).map(topic=><button type="button" key={topic.id} className={String(values.topicId||"")===topic.id?"active":""} onClick={()=>chooseTopic(topic)}>
        <b>{topic.label}</b><small>{topic.category}</small><span>{topic.description}</span>
      </button>)}
    </div>
    {guidance&&<div className="acc-analysis-count">{guidance.stats.knowledgeTopics} guided topics matched · {guidance.stats.readCapabilities} live read capabilities available</div>}

    {selectedTopic&&<div className="acc-topic-detail">
      <div><b>{selectedTopic.label}</b><span>{selectedTopic.description}</span></div>
      <div className="acc-evidence-cloud">{selectedTopic.evidence.slice(0,10).map(item=><span key={item}>{item}</span>)}</div>
      <div className="acc-example-row">{selectedTopic.examples.slice(0,3).map(example=><button type="button" key={example} onClick={()=>onChange({prompt:example})}>{example}</button>)}</div>
    </div>}

    <div className="acc-analysis-entity">
      <label><b>Entity / record <em>optional</em></b><small>Enter a person, account, class, subject, department or other Ledgerly record. The resolver identifies its actual type instead of guessing.</small></label>
      <div className="acc-analysis-search"><Search size={14}/><input value={entitySearch} onChange={e=>{setEntitySearch(e.target.value);onChange({entity:null,entityQuery:e.target.value,serverEntityOptions:[]});}} placeholder="e.g. Mukisa Abraham, Mathematics, P6, School Fees Receivable…"/>{loadingEntities&&<Activity className="spin" size={14}/>}</div>
      {values.entity&&<div className="acc-resolved-entity"><Check size={14}/><span><b>{(values.entity as AnalysisEntity).label}</b><small>{(values.entity as AnalysisEntity).type} · {(values.entity as AnalysisEntity).subtitle}</small></span><button type="button" onClick={()=>{onChange({entity:null,entityQuery:""});setEntitySearch("");}}>Change</button></div>}
      {!values.entity&&entityOptions.length>0&&<div className="acc-entity-options">{entityOptions.slice(0,10).map(entity=><button type="button" key={entity.type+":"+entity.id} onClick={()=>chooseEntity(entity)}><b>{entity.label}</b><span>{entity.type}</span><small>{entity.subtitle}</small></button>)}</div>}
    </div>

    <label className="acc-field acc-field-wide"><span><b>{mode==="account-for"?"Outcome / explanation request":"Analysis request"} *</b><small>Write naturally. The evidence plan and final structure are generated from the request and the data actually found.</small></span><textarea rows={4} value={String(values.prompt||"")} onChange={e=>onChange({prompt:e.target.value})} placeholder={mode==="account-for"?"e.g. Account for Mukisa Abraham failing to achieve Division 1":"e.g. Analyse chronic absenteeism among P6 learners this term"}/></label>
  </section>;
}

function Field({field,value,onChange,agentKey}:{field:CommandField;value:unknown;onChange:(v:unknown)=>void;agentKey:string}){
  if(field.control==="reference")return <ReferenceField field={field} value={value} onChange={onChange} agentKey={agentKey}/>;
  if(field.control==="boolean")return <label className="acc-field acc-check"><span><b>{field.label}{field.required&&" *"}</b><small>{field.notes}</small></span><input type="checkbox" checked={Boolean(value)} onChange={e=>onChange(e.target.checked)}/></label>;
  if(field.control==="textarea"||field.control==="json")return <label className="acc-field acc-field-wide"><span><b>{field.label}{field.required&&" *"}</b><small>{field.notes}</small></span><textarea rows={field.control==="json"?6:3} value={String(value??"")} onChange={e=>onChange(e.target.value)} placeholder={field.control==="json"?"{ }":""}/></label>;
  if(field.control==="enum")return <label className="acc-field"><span><b>{field.label}{field.required&&" *"}</b><small>{field.notes}</small></span><select value={String(value??"")} onChange={e=>onChange(e.target.value)}><option value="">Any / select…</option>{(field.enum||[]).map(x=><option key={x}>{x}</option>)}</select></label>;
  return <label className="acc-field"><span><b>{field.label}{field.required&&" *"}</b><small>{field.notes}</small></span><input type={field.control==="date"?"date":field.control==="number"?"number":"text"} min={field.min} max={field.max} value={String(value??"")} onChange={e=>onChange(e.target.value)} /></label>;
}

function ReferenceField({field,value,onChange,agentKey}:{field:CommandField;value:unknown;onChange:(v:unknown)=>void;agentKey:string}){
  const[q,setQ]=useState("");const[label,setLabel]=useState("");const[items,setItems]=useState<Array<{value:string;label:string;subtitle?:string}>>([]);const[open,setOpen]=useState(false);const[loading,setLoading]=useState(false);
  useEffect(()=>{const t=window.setTimeout(()=>{void load();},180);return()=>window.clearTimeout(t);},[q,agentKey,field.referenceKey]);
  async function load(){setLoading(true);try{setItems(await get<Array<{value:string;label:string;subtitle?:string}>>("/agentic-employees/chat-studio/reference-options?agentKey="+encodeURIComponent(agentKey)+"&field="+encodeURIComponent(field.referenceKey||field.name)+"&q="+encodeURIComponent(q)+"&limit=20"));}catch{setItems([]);}finally{setLoading(false);}}
  const shown=label||String(value??"");
  return <label className="acc-field acc-reference"><span><b>{field.label}{field.required&&" *"}</b><small>{field.notes||"Search and select a record."}</small></span>
    <div className="acc-ref-input"><Search size={14}/><input value={open?q:shown} onFocus={()=>{setOpen(true);setQ("");}} onBlur={()=>window.setTimeout(()=>setOpen(false),120)} onChange={e=>{setQ(e.target.value);setOpen(true);}} placeholder={"Search "+field.label.toLowerCase()+"…"}/>{loading&&<Activity className="spin" size={13}/>}</div>
    {open&&<div className="acc-ref-menu">{items.map(item=><button type="button" key={item.value} onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange(item.value);setLabel(item.label);setQ(item.label);setOpen(false);}}><b>{item.label}</b><small>{item.subtitle}</small></button>)}{!items.length&&!loading&&<span>No matches yet</span>}</div>}
  </label>;
}

function ResultView({value,format}:{value:unknown;format:OutputFormat}){
  if(value===null||value===undefined)return <div className="acc-empty"><Database size={24}/><b>No result payload</b></div>;
  const composite:any=value;if(composite?.needsCriteria&&Array.isArray(composite.questions))return <div className="acc-ready-card"><Sparkles size={24}/><b>More criteria needed</b><span>{composite.questions.join(" ")}</span></div>;
  if(composite?.needsEntity&&Array.isArray(composite.entityOptions))return <div className="acc-ready-card"><Search size={24}/><b>Select the correct Ledgerly record</b><span>The name matched more than one record. Choose the student, teacher, staff member, account or other entity above and run again.</span></div>;
  if(format==="json")return <pre className="acc-json">{JSON.stringify(value,null,2)}</pre>;
  if(composite?.analysis)return <div className="acc-human-report"><AnalysisResult analysis={composite.analysis} humanResponse={composite.humanResponse} topic={composite.topic} entity={composite.entity}/><LearningFeedback result={composite} entityLabel={composite.entity?.label}/></div>;
  if(composite?.humanResponse)return <div className="acc-human-report"><div className="acc-human-response">{String(composite.humanResponse)}</div><LearningFeedback result={composite}/><TableResult value={value}/></div>;
  return <TableResult value={value}/>;
}

function LearningFeedback({result,entityLabel=""}:{result:any;entityLabel?:string}){
  const fingerprint=String(result?.responseMeta?.fingerprint||result?.routing?.responseFingerprint||"");
  const exampleId=String(result?.responseMeta?.trainingExampleId||result?.routing?.trainingExampleId||"");
  const[state,setState]=useState<"idle"|"correct"|"sending"|"sent">("idle");
  const[correction,setCorrection]=useState("");
  const[message,setMessage]=useState("");
  if(!fingerprint)return null;
  async function send(rating:-1|1,approveOriginal=false){
    setState("sending");
    try{
      await post<any>("/agentic-employees/chat-studio/response-feedback",{
        responseFingerprint:fingerprint,exampleId,rating,approveOriginal,
        correctionText:rating<0?correction.trim():"",entityLabel,
      });
      setMessage(rating>0?"Feedback saved. Trusted reviewers can approve it for learning.":"Correction saved. It will be reviewed before it becomes training material.");
      setState("sent");
    }catch(error){setMessage(errorText(error));setState(rating<0?"correct":"idle");}
  }
  if(state==="sent")return <div className="acc-learning-saved"><Check size={13}/><span>{message}</span></div>;
  return <div className="acc-learning-feedback">
    <div><b>Teach Ledgerly this response</b><small>Approve good answers or correct weak ones. Only approved/corrected examples become learning material.</small></div>
    <div className="acc-learning-actions">
      <button type="button" disabled={state==="sending"} onClick={()=>void send(1,true)}><ThumbsUp size={13}/> Good response</button>
      <button type="button" disabled={state==="sending"} onClick={()=>setState(state==="correct"?"idle":"correct")}><ThumbsDown size={13}/> Improve it</button>
    </div>
    {state==="correct"&&<div className="acc-learning-correction"><textarea rows={4} value={correction} onChange={e=>setCorrection(e.target.value)} placeholder="Write the better answer or correction you want Ledgerly to learn…"/><button type="button" disabled={!correction.trim()} onClick={()=>void send(-1,false)}>Save correction</button></div>}
    {message&&state!=="sent"&&<small className="acc-learning-error">{message}</small>}
  </div>;
}

function TableResult({value}:{value:unknown}){
  const rows=rowsFrom(value);
  if(!rows.length)return <pre className="acc-json">{JSON.stringify(value,null,2)}</pre>;
  const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))].slice(0,14);
  return <div className="acc-table-wrap"><table><thead><tr>{columns.map(c=><th key={c}>{humanize(c)}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r,i)=><tr key={i}>{columns.map(c=><td key={c}>{cell(r[c])}</td>)}</tr>)}</tbody></table>{rows.length>100&&<div className="acc-table-note">Showing first 100 of {rows.length} rows. Export to see the complete result.</div>}</div>;
}

function AnalysisResult({analysis,humanResponse,topic,entity}:{analysis:any;humanResponse?:string;topic?:AnalysisTopic|null;entity?:AnalysisEntity|null}){
  return <div className="acc-analysis-result">
    <header><div><small>{topic?.category||"Evidence analysis"}</small><h3>{analysis.title||topic?.label||"Ledgerly Analysis"}</h3>{entity&&<span>{entity.type}: <b>{entity.label}</b></span>}</div></header>
    {humanResponse?<div className="acc-human-response">{humanResponse}</div>:analysis.summary&&<div className="acc-analysis-summary">{analysis.summary}</div>}
    {Array.isArray(analysis.metrics)&&analysis.metrics.length>0&&<div className="acc-analysis-metrics">{analysis.metrics.slice(0,8).map((m:any,i:number)=><div key={i}>{typeof m==="object"?<><b>{String(m.label||m.name||"Metric")}</b><span>{String(m.value??m.result??JSON.stringify(m))}</span></>:<span>{String(m)}</span>}</div>)}</div>}
    {Array.isArray(analysis.sections)&&analysis.sections.map((section:any,i:number)=><section key={i}><h4>{section.title||"Analysis"}</h4><p>{section.analysis}</p>{Array.isArray(section.evidence)&&section.evidence.length>0&&<div className="acc-evidence-list">{section.evidence.map((e:any,j:number)=><span key={j}>{String(e)}</span>)}</div>}</section>)}
    {Array.isArray(analysis.findings)&&analysis.findings.length>0&&<section><h4>Evidence-backed findings</h4><div className="acc-finding-list">{analysis.findings.map((f:any,i:number)=><div key={i}>{typeof f==="object"?<><b>{String(f.title||f.finding||"Finding")}</b><span>{String(f.detail||f.analysis||f.evidence||JSON.stringify(f))}</span></>:<span>{String(f)}</span>}</div>)}</div></section>}
    {Array.isArray(analysis.relationships)&&analysis.relationships.length>0&&<section><h4>Observed relationships</h4><div className="acc-finding-list">{analysis.relationships.map((f:any,i:number)=><div key={i}><span>{typeof f==="object"?String(f.analysis||f.relationship||JSON.stringify(f)):String(f)}</span></div>)}</div></section>}
    {Array.isArray(analysis.limitations)&&analysis.limitations.length>0&&<section className="muted"><h4>Limits of the evidence</h4>{analysis.limitations.map((x:string,i:number)=><p key={i}>• {x}</p>)}</section>}
    {Array.isArray(analysis.unanswered)&&analysis.unanswered.length>0&&<section className="muted"><h4>Still unanswered</h4>{analysis.unanswered.map((x:string,i:number)=><p key={i}>• {x}</p>)}</section>}
    {Array.isArray(analysis.suggestedActions)&&analysis.suggestedActions.length>0&&<section><h4>Suggested follow-up</h4><div className="acc-finding-list">{analysis.suggestedActions.map((a:any,i:number)=><div key={i}>{typeof a==="object"?<><b>{String(a.title||a.action||"Follow-up")}</b><span>{String(a.reason||a.detail||JSON.stringify(a))}</span></>:<span>{String(a)}</span>}</div>)}</div></section>}
    {analysis.confidenceNote&&<div className="acc-confidence">{analysis.confidenceNote}</div>}
    {Array.isArray(analysis.rows)&&analysis.rows.length>0&&<><h4 className="acc-supporting-title">Supporting data</h4><ResultView value={{data:{rows:analysis.rows}}} format="table"/></>}
  </div>;
}

function rowsFrom(value:unknown):Record<string,unknown>[]{
  const v:any=value;if(Array.isArray(v?.analysis?.rows)&&v.analysis.rows.length)return v.analysis.rows.map(objectRow);const direct=v?.data??v?.results??v?.items??v;
  if(Array.isArray(direct))return direct.map(objectRow);
  if(direct&&typeof direct==="object"&&Array.isArray(direct.rows))return direct.rows.map(objectRow);
  if(direct&&typeof direct==="object"){
    for(const key of Object.keys(direct)){if(Array.isArray(direct[key]))return direct[key].map(objectRow);}
    return[objectRow(direct)];
  }
  return[{value:direct}];
}
function objectRow(v:any):Record<string,unknown>{return v&&typeof v==="object"&&!Array.isArray(v)?v:{value:v};}
function cell(value:unknown){if(value===null||value===undefined)return"—";if(typeof value==="object")return JSON.stringify(value);return String(value);}
function humanize(value:string){return value.replace(/[_-]+/g," ").replace(/([a-z])([A-Z])/g,"$1 $2").replace(/\b\w/g,c=>c.toUpperCase());}
function kindInitial(kind:string){return({query:"Q",report:"R",create:"C",update:"U",delete:"D",action:"A",document:"DOC",analysis:"AI",communication:"COM"} as Record<string,string>)[kind]||kind.slice(0,2).toUpperCase();}
function scoreCommand(c:CommandDescriptor,needle:string){if(!needle)return c.toolName==="__guided_analyse__"||c.toolName==="__guided_account_for__"?3:c.toolName==="__composite_report__"?2:1;if(c.toolName==="__guided_analyse__"&&/^(analyse|analyze)(\s|$)/.test(needle))return 1200;if(c.toolName==="__guided_account_for__"&&/^account\s+for(\s|$)/.test(needle))return 1200;const complex=needle.split(/\s+/).filter(Boolean).length>=5||/\b(compare|combined|whose|where|below|above|versus|trend|fallen|declined|across)\b/.test(needle);if(c.toolName==="__composite_report__"&&complex)return 850;const command=c.command.toLowerCase();if(command===needle)return 1000;if(command.startsWith(needle))return 800;if(command.includes(needle))return 600;let best=0;for(const a of c.aliases||[]){const x=a.toLowerCase();if(x===needle)best=Math.max(best,900);else if(x.startsWith(needle))best=Math.max(best,700);else if(x.includes(needle))best=Math.max(best,500);}const meta=(c.module+" "+c.group+" "+c.kind+" "+c.description).toLowerCase();if(meta.includes(needle))best=Math.max(best,250);const tokens=needle.split(/\s+/).filter(Boolean);if(tokens.length&&tokens.every(t=>(command+" "+meta+" "+c.aliases.join(" ")).toLowerCase().includes(t)))best=Math.max(best,350+tokens.length*20);return best;}

function exportResult(value:unknown,format:OutputFormat,command:string){
  const rows=rowsFrom(value),filename=safeName(command||"ledgerly-command"),analysis:any=(value as any)?.analysis,humanResponse=String((value as any)?.humanResponse??"");
  if(format==="json"){downloadBlob(JSON.stringify(value,null,2),"application/json",filename+".json");return;}
  if(format==="csv"){
    const csvRows=rows.length?rows:analysis?[
      {section:"Human response",content:humanResponse||String(analysis.summary||"")},
      ...(Array.isArray(analysis.sections)?analysis.sections.map((s:any)=>({section:String(s.title||"Analysis"),content:String(s.analysis||"")})):[])
    ]:humanResponse?[{section:"Report",content:humanResponse}]:[];
    const columns=[...new Set(csvRows.flatMap((r:any)=>Object.keys(r)))];const csv=[columns.join(","),...csvRows.map((r:any)=>columns.map(c=>csvCell(r[c])).join(","))].join("\n");downloadBlob(csv,"text/csv;charset=utf-8",filename+".csv");return;
  }
  if(format==="xlsx"){
    const wb=XLSX.utils.book_new();
    if(analysis){
      const narrative=[
        {section:"Title",content:String(analysis.title||humanize(command))},
        {section:"Human response",content:humanResponse||String(analysis.summary||"")},
        ...(Array.isArray(analysis.sections)?analysis.sections.map((s:any)=>({section:String(s.title||"Analysis"),content:String(s.analysis||"")})):[]),
        ...(Array.isArray(analysis.limitations)&&analysis.limitations.length?[{section:"Limits of evidence",content:analysis.limitations.join("\n")}]:[]),
        ...(analysis.confidenceNote?[{section:"Confidence",content:String(analysis.confidenceNote)}]:[])
      ];
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(narrative),"Analysis");
      if(rows.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),"Supporting Data");
    }else if(humanResponse){
      XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet([{section:"Report",content:humanResponse}]),"Report");
      if(rows.length)XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),"Data");
    }else XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),"Results");
    XLSX.writeFile(wb,filename+".xlsx");return;
  }
  if(format==="pdf"){
    if(analysis||humanResponse){
      const doc=new jsPDF({orientation:"portrait"});let y=16;const margin=14,width=182;
      doc.setFontSize(16);doc.text(String(analysis?.title||humanize(command)),margin,y);y+=9;
      const addText=(text:string,size=9,bold=false)=>{if(!text)return;doc.setFontSize(size);doc.setFont("helvetica",bold?"bold":"normal");const lines=doc.splitTextToSize(text,width);for(const line of lines){if(y>278){doc.addPage();y=16;}doc.text(line,margin,y);y+=size*.48+2;}};
      addText(humanResponse||String(analysis?.summary||""),10);y+=3;
      if(analysis)for(const section of Array.isArray(analysis.sections)?analysis.sections:[]){if(y>260){doc.addPage();y=16;}addText(String(section.title||"Analysis"),11,true);addText(String(section.analysis||""),9);y+=3;}
      if(analysis&&Array.isArray(analysis.limitations)&&analysis.limitations.length){addText("Limits of the evidence",10,true);addText(analysis.limitations.map((x:string)=>"• "+x).join("\n"),8);}
      if(analysis?.confidenceNote){y+=2;addText(String(analysis.confidenceNote),8);}
      if(rows.length){if(y>220){doc.addPage();y=16;}const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))].slice(0,10);autoTable(doc,{head:[columns.map(humanize)],body:rows.slice(0,300).map(r=>columns.map(c=>cell(r[c]).slice(0,140))),startY:y+4,styles:{fontSize:6}});}
      doc.save(filename+".pdf");return;
    }
    const doc=new jsPDF({orientation:"landscape"});doc.setFontSize(15);doc.text("/"+command,14,15);const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))].slice(0,12);autoTable(doc,{head:[columns.map(humanize)],body:rows.slice(0,500).map(r=>columns.map(c=>cell(r[c]).slice(0,180))),startY:22,styles:{fontSize:7}});doc.save(filename+".pdf");
  }
}
function csvCell(v:unknown){const s=cell(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function safeName(v:string){return v.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80)||"ledgerly-command";}
function downloadBlob(content:string,type:string,name:string){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}

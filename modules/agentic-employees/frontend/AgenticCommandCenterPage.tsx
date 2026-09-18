import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowRight, Bot, Check, ChevronDown, CircleDot, Clock3, Command,
  Database, Download, FileJson, FileSpreadsheet, FileText, Filter, Gauge,
  Layers3, Play, Search, ShieldCheck, Sparkles, Table2, TerminalSquare, X
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

const FORMAT_META:Record<string,{label:string;icon:typeof Table2;hint:string}>={
  table:{label:"Interactive table",icon:Table2,hint:"Best for browsing records on screen"},
  json:{label:"JSON",icon:FileJson,hint:"Structured developer/raw output"},
  csv:{label:"CSV",icon:Download,hint:"Simple spreadsheet-compatible export"},
  xlsx:{label:"Excel",icon:FileSpreadsheet,hint:"Formatted workbook download"},
  pdf:{label:"PDF",icon:FileText,hint:"Printable report snapshot"},
  approval:{label:"Approval workflow",icon:ShieldCheck,hint:"Write commands are reviewed before execution"},
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
    return (catalog?.commands||[])
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
      const response=await post<RunResponse>("/agentic-employees/chat-studio/conversations/"+conversation.id+"/quick-command",{
        toolName:selected.toolName,values,commandText:"/"+selected.command,outputFormat:format
      });
      setResult(response.result);setPrepared(Boolean(response.prepared));setStep(3);
      setHistory(h=>[{id:String(Date.now()),command:selected.command,agent:agentKey,format,when:new Date().toISOString(),prepared:Boolean(response.prepared),result:response.result},...h].slice(0,20));
      if(!response.prepared&&["csv","xlsx","pdf"].includes(format))exportResult(response.result,format,selected.command);
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
            {inputs.length>0&&<section><div className="acc-section-title"><Database size={16}/><div><b>{selected.readOnly?"Command inputs":"Validated action details"}</b><small>{selected.readOnly?"Choose any records or required context.":"Writes are validated now and still require approval before Ledgerly changes data."}</small></div></div><div className="acc-fields">{inputs.map(f=><Field key={f.name} field={f} value={values[f.name]} agentKey={agentKey} onChange={v=>setValues(x=>({...x,[f.name]:v}))}/>)}</div></section>}
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
  <div className="acc-example-grid">{["/create student","/open class","/report fee balances","/find staff attendance","/list subjects","/generate report"].map(x=><code key={x}>{x}</code>)}</div>
  <div className="acc-welcome-stats"><b>{catalog?.stats.toolCount??"Hundreds of"} live tools</b><span>expanded into {catalog?.stats.commandCount??"many"} searchable command phrases.</span></div>
</div>;}

function Field({field,value,onChange,agentKey}:{field:CommandField;value:unknown;onChange:(v:unknown)=>void;agentKey:string}){
  if(field.control==="reference")return <ReferenceField field={field} value={value} onChange={onChange} agentKey={agentKey}/>;
  if(field.control==="boolean")return <label className="acc-field acc-check"><span><b>{field.label}{field.required&&" *"}</b><small>{field.notes}</small></span><input type="checkbox" checked={Boolean(value)} onChange={e=>onChange(e.target.checked)}/></label>;
  if(field.control==="textarea"||field.control==="json")return <label className="acc-field acc-field-wide"><span><b>{field.label}{field.required&&" *"}</b><small>{field.notes}</small></span><textarea rows={field.control==="json"?6:3} value={String(value??"")} onChange={e=>onChange(e.target.value)} placeholder={field.control==="json"?"{ }":""}/></label>;
  if(field.control==="enum")return <label className="acc-field"><span><b>{field.label}{field.required&&" *"}</b><small>{field.notes}</small></span><select value={String(value??"")} onChange={e=>onChange(e.target.value)}><option value="">Any / select…</option>{(field.enum||[]).map(x=><option key={x}>{x}</option>)}</select></label>;
  return <label className="acc-field"><span><b>{field.label}{field.required&&" *"}</b><small>{field.notes}</small></span><input type={field.control==="date"?"date":field.control==="number"?"number":"text"} min={field.min} max={field.max} value={String(value??"")} onChange={e=>onChange(e.target.value)} /></label>;
}

function ReferenceField({field,value,onChange,agentKey}:{field:CommandField;value:unknown;onChange:(v:unknown)=>void;agentKey:string}){
  const[q,setQ]=useState("");const[items,setItems]=useState<Array<{value:string;label:string;subtitle?:string}>>([]);const[open,setOpen]=useState(false);const[loading,setLoading]=useState(false);
  useEffect(()=>{const t=window.setTimeout(()=>{void load();},180);return()=>window.clearTimeout(t);},[q,agentKey,field.referenceKey]);
  async function load(){setLoading(true);try{setItems(await get<Array<{value:string;label:string;subtitle?:string}>>("/agentic-employees/chat-studio/reference-options?agentKey="+encodeURIComponent(agentKey)+"&field="+encodeURIComponent(field.referenceKey||field.name)+"&q="+encodeURIComponent(q)+"&limit=20"));}catch{setItems([]);}finally{setLoading(false);}}
  const shown=String(value??"");
  return <label className="acc-field acc-reference"><span><b>{field.label}{field.required&&" *"}</b><small>{field.notes||"Search and select a record."}</small></span>
    <div className="acc-ref-input"><Search size={14}/><input value={open?q:shown} onFocus={()=>{setOpen(true);setQ("");}} onChange={e=>{setQ(e.target.value);setOpen(true);}} placeholder={"Search "+field.label.toLowerCase()+"…"}/>{loading&&<Activity className="spin" size={13}/>}</div>
    {open&&<div className="acc-ref-menu">{items.map(item=><button type="button" key={item.value} onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange(item.value);setQ(item.label);setOpen(false);}}><b>{item.label}</b><small>{item.subtitle}</small></button>)}{!items.length&&!loading&&<span>No matches yet</span>}</div>}
  </label>;
}

function ResultView({value,format}:{value:unknown;format:OutputFormat}){
  if(value===null||value===undefined)return <div className="acc-empty"><Database size={24}/><b>No result payload</b></div>;
  if(format==="json")return <pre className="acc-json">{JSON.stringify(value,null,2)}</pre>;
  const rows=rowsFrom(value);
  if(!rows.length)return <pre className="acc-json">{JSON.stringify(value,null,2)}</pre>;
  const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))].slice(0,14);
  return <div className="acc-table-wrap"><table><thead><tr>{columns.map(c=><th key={c}>{humanize(c)}</th>)}</tr></thead><tbody>{rows.slice(0,100).map((r,i)=><tr key={i}>{columns.map(c=><td key={c}>{cell(r[c])}</td>)}</tr>)}</tbody></table>{rows.length>100&&<div className="acc-table-note">Showing first 100 of {rows.length} rows. Export to see the complete result.</div>}</div>;
}

function rowsFrom(value:unknown):Record<string,unknown>[]{
  const v:any=value;const direct=v?.data??v?.results??v?.items??v;
  if(Array.isArray(direct))return direct.map(objectRow);
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
function scoreCommand(c:CommandDescriptor,needle:string){if(!needle)return 1;const command=c.command.toLowerCase();if(command===needle)return 1000;if(command.startsWith(needle))return 800;if(command.includes(needle))return 600;let best=0;for(const a of c.aliases||[]){const x=a.toLowerCase();if(x===needle)best=Math.max(best,900);else if(x.startsWith(needle))best=Math.max(best,700);else if(x.includes(needle))best=Math.max(best,500);}const meta=(c.module+" "+c.group+" "+c.kind+" "+c.description).toLowerCase();if(meta.includes(needle))best=Math.max(best,250);const tokens=needle.split(/\s+/).filter(Boolean);if(tokens.length&&tokens.every(t=>(command+" "+meta+" "+c.aliases.join(" ")).toLowerCase().includes(t)))best=Math.max(best,350+tokens.length*20);return best;}

function exportResult(value:unknown,format:OutputFormat,command:string){
  const rows=rowsFrom(value),filename=safeName(command||"ledgerly-command");
  if(format==="json"){downloadBlob(JSON.stringify(value,null,2),"application/json",filename+".json");return;}
  if(format==="csv"){const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))];const csv=[columns.join(","),...rows.map(r=>columns.map(c=>csvCell(r[c])).join(","))].join("\n");downloadBlob(csv,"text/csv;charset=utf-8",filename+".csv");return;}
  if(format==="xlsx"){const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Results");XLSX.writeFile(wb,filename+".xlsx");return;}
  if(format==="pdf"){const doc=new jsPDF({orientation:"landscape"});doc.setFontSize(15);doc.text("/"+command,14,15);const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))].slice(0,12);autoTable(doc,{head:[columns.map(humanize)],body:rows.slice(0,500).map(r=>columns.map(c=>cell(r[c]).slice(0,180))),startY:22,styles:{fontSize:7}});doc.save(filename+".pdf");}
}
function csvCell(v:unknown){const s=cell(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function safeName(v:string){return v.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,80)||"ledgerly-command";}
function downloadBlob(content:string,type:string,name:string){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}

import { forwardRef,useEffect,useImperativeHandle,useMemo,useRef,useState } from "react";
import { CheckCircle2,ChevronRight,Command,LoaderCircle,Search,ShieldCheck,X } from "lucide-react";
import { errorText,get,post } from "../../../web/api";

type FieldControl="text"|"textarea"|"date"|"number"|"boolean"|"enum"|"reference"|"json"|"array";
type CommandField={name:string;requestKey:string;label:string;control:FieldControl;required:boolean;location:string;enum?:string[];notes?:string;referenceKey?:string;min?:number;max?:number;integer?:boolean;defaultValue?:unknown};
type QuickCommand={toolName:string;command:string;aliases:string[];description:string;module:string;group:string;kind:string;source:"route"|"native";readOnly:boolean;method?:string;pathTemplate?:string;schemaCoverage:string;fields:CommandField[]};
type Catalog={commands:QuickCommand[];stats:{toolCount:number;commandCount:number;routeTools:number;nativeTools:number;writes:number;reads:number}};
type ReferenceOption={value:string;label:string;subtitle?:string};
type Match={command:QuickCommand;alias:string;score:number};

export type QuickCommandPaletteHandle={handleEnter:()=>boolean};
type Props={
  agentKey?:string;
  conversationId?:string;
  value:string;
  disabled?:boolean;
  onChange:(value:string)=>void;
  onExecuted:()=>void|Promise<void>;
  onError:(message:string)=>void;
};

function scoreAlias(alias:string,query:string){
  const a=alias.toLowerCase(),q=query.toLowerCase().trim();if(!q)return 1;if(a===q)return 1200;if(a.startsWith(q))return 1000-q.length;if(a.includes(q))return 780-q.length;
  const qTokens=q.split(/\s+/).filter(Boolean),aTokens=a.split(/\s+/);let score=0;
  for(const token of qTokens){if(aTokens.some(x=>x===token))score+=180;else if(aTokens.some(x=>x.startsWith(token)))score+=130;else if(a.includes(token))score+=80;else return -1;}
  return score;
}
function today(){return new Date().toISOString().slice(0,10);}
function defaultValues(command:QuickCommand){const values:Record<string,unknown>={};for(const field of command.fields)if(field.defaultValue!==undefined)values[field.name]=field.defaultValue==="$today"?today():field.defaultValue;return values;}
function empty(value:unknown){return value===undefined||value===null||String(value).trim()==="";}
function validate(command:QuickCommand,values:Record<string,unknown>){
  const errors:Record<string,string>={};
  for(const field of command.fields){const value=values[field.name];if(field.required&&empty(value)){errors[field.name]=`${field.label} is required`;continue;}if(empty(value))continue;
    if(field.enum?.length&&!field.enum.includes(String(value)))errors[field.name]=`Choose one of: ${field.enum.join(", ")}`;
    if(field.control==="date"&&!/^\d{4}-\d{2}-\d{2}$/.test(String(value)))errors[field.name]="Use YYYY-MM-DD";
    if(field.control==="number"){const n=Number(value);if(!Number.isFinite(n))errors[field.name]="Enter a valid number";else if(field.integer&&!Number.isInteger(n))errors[field.name]="Enter a whole number";else if(field.min!==undefined&&n<field.min)errors[field.name]=`Minimum is ${field.min}`;else if(field.max!==undefined&&n>field.max)errors[field.name]=`Maximum is ${field.max}`;}
    if(field.control==="json"&&typeof value==="string"){try{JSON.parse(value);}catch{errors[field.name]="Enter valid JSON";}}
  }
  return errors;
}

export const QuickCommandPalette=forwardRef<QuickCommandPaletteHandle,Props>(function QuickCommandPalette({agentKey,conversationId,value,disabled,onChange,onExecuted,onError},ref){
  const[catalog,setCatalog]=useState<Catalog|null>(null),[loading,setLoading]=useState(false),[selected,setSelected]=useState<QuickCommand|null>(null),[chosenAlias,setChosenAlias]=useState(""),[values,setValues]=useState<Record<string,unknown>>({}),[errors,setErrors]=useState<Record<string,string>>({}),[submitting,setSubmitting]=useState(false);
  const visible=value.startsWith("/")&&!selected&&Boolean(conversationId)&&!disabled,query=visible?value.slice(1).trim():"";
  useEffect(()=>{if(!agentKey){setCatalog(null);return;}let alive=true;setLoading(true);void get<Catalog>(`/agentic-employees/chat-studio/commands?agentKey=${encodeURIComponent(agentKey)}`).then(data=>{if(alive)setCatalog(data);}).catch(()=>{if(alive)setCatalog(null);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[agentKey]);

  const matches=useMemo<Match[]>(()=>{if(!visible||!catalog)return[];const out:Match[]=[];for(const command of catalog.commands){let bestAlias=command.command,best=-1;for(const alias of [command.command,...command.aliases]){const score=scoreAlias(alias,query);if(score>best){best=score;bestAlias=alias;}}if(best>=0)out.push({command,alias:bestAlias,score:best});}return out.sort((a,b)=>b.score-a.score||a.command.module.localeCompare(b.command.module)||a.alias.localeCompare(b.alias)).slice(0,14);},[catalog,query,visible]);

  async function run(command:QuickCommand,alias:string,nextValues:Record<string,unknown>){
    if(!conversationId||submitting)return;setSubmitting(true);setErrors({});
    try{await post(`/agentic-employees/chat-studio/conversations/${conversationId}/quick-command`,{toolName:command.toolName,values:nextValues,commandText:`/${alias}`});setSelected(null);setChosenAlias("");onChange("");await onExecuted();}
    catch(err){onError(errorText(err));}
    finally{setSubmitting(false);}
  }
  function choose(match:Match){
    if(disabled)return;const initial=defaultValues(match.command);setChosenAlias(match.alias);setValues(initial);setErrors({});
    if(!match.command.fields.length){void run(match.command,match.alias,initial);return;}
    setSelected(match.command);onChange(`/${match.alias}`);
  }
  useImperativeHandle(ref,()=>({handleEnter(){if(!visible||submitting||!matches.length)return false;choose(matches[0]!);return true;}}),[visible,submitting,matches]);

  async function submit(){if(!selected)return;const next=validate(selected,values);setErrors(next);if(Object.keys(next).length)return;await run(selected,chosenAlias||selected.command,values);}
  function closeForm(){if(submitting)return;setSelected(null);setErrors({});setChosenAlias("");onChange("");}

  return <>
    {visible&&<div className="acs-command-palette">
      <div className="acs-command-palette-head"><span><Command size={14}/><b>Quick commands</b></span><small>{catalog?`${catalog.stats.commandCount}+ phrases · ${catalog.stats.toolCount} live tools`:"Loading…"}</small></div>
      {loading&&!catalog&&<div className="acs-command-empty"><LoaderCircle className="spin" size={15}/>Loading permitted Ledgerly commands…</div>}
      {!loading&&catalog&&matches.length===0&&<div className="acs-command-empty"><Search size={15}/>No command matches “{query}”. Keep typing or use normal chat.</div>}
      <div className="acs-command-results">{matches.map((match,index)=><button key={match.command.toolName} className={index===0?"active":""} onMouseDown={e=>e.preventDefault()} onClick={()=>choose(match)}>
        <span className="acs-command-slash">/</span><span className="acs-command-copy"><b>{match.alias}</b><small>{match.command.module} · {match.command.group} · {match.command.readOnly?"read":"approval required"}</small></span><span className="acs-command-kind">{match.command.kind}</span><ChevronRight size={14}/>
      </button>)}</div>
      <div className="acs-command-help"><span>Enter selects the first match</span><span>Click any result</span><span>Fuzzy search works after /</span></div>
    </div>}

    {selected&&<div className="acs-command-backdrop" role="dialog" aria-modal="true" aria-label={`Quick command /${chosenAlias||selected.command}`}>
      <div className="acs-command-form">
        <div className="acs-command-form-head"><div><span><Command size={15}/> QUICK COMMAND</span><h3>/{chosenAlias||selected.command}</h3><p>{selected.description}</p></div><button onClick={closeForm} disabled={submitting} aria-label="Close"><X size={18}/></button></div>
        <div className="acs-command-form-meta"><span><b>Module</b>{selected.module}</span><span><b>Tool</b>{selected.toolName.replace(/_/g," ")}</span><span><b>Safety</b>{selected.readOnly?"Runs read-only":"Review required before write"}</span><span><b>Form</b>{selected.schemaCoverage}</span></div>
        <div className="acs-command-fields">{selected.fields.map(field=><CommandFieldEditor key={field.name} field={field} value={values[field.name]} error={errors[field.name]} disabled={submitting} onChange={next=>{setValues(current=>({...current,[field.name]:next}));if(errors[field.name])setErrors(current=>({...current,[field.name]:""}));}}/>)}</div>
        <div className="acs-command-form-foot"><div><ShieldCheck size={14}/><span>{selected.readOnly?"This command reads permitted Ledgerly data directly.":"Ledgerly validates the form again on the server, resolves selected records to canonical IDs, and creates an approval card before any write."}</span></div><button className="secondary" onClick={closeForm} disabled={submitting}>Cancel</button><button className="primary" onClick={()=>void submit()} disabled={submitting}>{submitting?<LoaderCircle className="spin" size={15}/>:<CheckCircle2 size={15}/>} {selected.readOnly?"Run command":"Validate & prepare"}</button></div>
      </div>
    </div>}
  </>;
});

function CommandFieldEditor({field,value,error,disabled,onChange}:{field:CommandField;value:unknown;error?:string;disabled:boolean;onChange:(value:unknown)=>void}){
  const id=`qcmd-${field.name}`;
  return <label className={`acs-command-field ${error?"invalid":""}`} htmlFor={id}><span>{field.label}{field.required&&<em>*</em>}</span>{field.notes&&<small>{field.notes}</small>}
    {field.control==="reference"?<ReferenceTextbox id={id} field={field} value={String(value??"")} disabled={disabled} onChange={onChange}/>:
      field.control==="boolean"?<div className="acs-command-bool"><input id={id} type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><span>{Boolean(value)?"Yes":"No"}</span></div>:
      field.control==="enum"?<><input id={id} list={`${id}-options`} value={String(value??"")} disabled={disabled} placeholder="Type to search choices…" onChange={e=>onChange(e.target.value)}/><datalist id={`${id}-options`}>{field.enum?.map(option=><option key={option} value={option}/>)}</datalist></>:
      field.control==="textarea"||field.control==="json"?<textarea id={id} rows={field.control==="json"?5:3} value={String(value??"")} disabled={disabled} placeholder={field.control==="json"?"{ }":"Enter details…"} onChange={e=>onChange(e.target.value)}/>:
      <input id={id} type={field.control==="date"?"date":field.control==="number"?"number":"text"} min={field.min} max={field.max} step={field.integer?1:undefined} value={String(value??"")} disabled={disabled} placeholder={field.control==="array"?"Separate multiple values with commas":"Enter value…"} onChange={e=>onChange(e.target.value)}/>}
    {error&&<strong>{error}</strong>}
  </label>;
}

function ReferenceTextbox({id,field,value,disabled,onChange}:{id:string;field:CommandField;value:string;disabled:boolean;onChange:(value:unknown)=>void}){
  const[query,setQuery]=useState(value),[options,setOptions]=useState<ReferenceOption[]>([]),[open,setOpen]=useState(false),[loading,setLoading]=useState(false),timer=useRef<number|undefined>(undefined);
  useEffect(()=>{if(!open||!field.referenceKey)return;window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>{setLoading(true);void get<ReferenceOption[]>(`/agentic-employees/chat-studio/reference-options?field=${encodeURIComponent(field.referenceKey!)}&q=${encodeURIComponent(query)}&limit=20`).then(setOptions).catch(()=>setOptions([])).finally(()=>setLoading(false));},160);return()=>window.clearTimeout(timer.current);},[open,query,field.referenceKey]);
  useEffect(()=>{if(!open&&value&&!query)setQuery(value);},[value,open,query]);
  return <div className="acs-reference-box"><div className="acs-reference-input"><Search size={14}/><input id={id} value={query} disabled={disabled} autoComplete="off" placeholder="Search by name, code or number…" onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);onChange(e.target.value);setOpen(true);}}/></div>
    {open&&<div className="acs-reference-results">{loading&&<div className="acs-reference-state"><LoaderCircle className="spin" size={13}/>Searching…</div>}{!loading&&!options.length&&<div className="acs-reference-state">Type to search Ledgerly records</div>}{options.map(option=><button type="button" key={option.value} onMouseDown={e=>e.preventDefault()} onClick={()=>{setQuery(option.label);onChange(option.value);setOpen(false);}}><span><b>{option.label}</b>{option.subtitle&&<small>{option.subtitle}</small>}</span><CheckCircle2 size={13}/></button>)}</div>}
  </div>;
}

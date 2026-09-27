import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Copy, FilePlus2, Plus, Settings2, Trash2, Users } from "lucide-react";
import { errorText, get, post, put } from "../../../web/api";
import { Badge, Button, Card, Field, Modal, Notice, Spinner } from "../../../web/components/ui";
import {
  lmjsSupervisionTemplate,
  supervisionFieldTypes,
  type SupervisionColumn,
  type SupervisionField,
  type SupervisionFieldType,
  type SupervisionSection,
} from "../shared/supervision-fields";

type Row = Record<string, any>;
type Setup = { teachers:Row[];classes:Row[];streams:Row[];subjects:Row[];students?:Row[] };
type Template = {id:string;name:string;description:string;sections:SupervisionSection[];active:boolean;version:number;reviewCount:number;updatedAt?:string};
type Review = {id:string;templateId:string;templateName:string;templateVersion:number;title:string;observedOn:string;status:string;primaryEntityType?:string;primaryEntityId?:string;answers:Record<string,any>;sections:SupervisionSection[];version:number;updatedAt?:string};

const base="/academics/supervision";
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const today=()=>new Date().toISOString().slice(0,10);
const keyFrom=(label:string,fallback:string)=>label.toLowerCase().trim().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"").slice(0,60)||fallback;
const words=(value:any)=>String(value??"").replaceAll("_"," ").replace(/\b\w/g,c=>c.toUpperCase());

function useRemote<T>(url:string,initial:T){
  const [data,setData]=useState(initial),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const load=async()=>{setLoading(true);setError("");try{setData(await get<T>(url));}catch(e){setError(errorText(e));}finally{setLoading(false)}};
  useEffect(()=>{void load()},[url]);
  return{data,setData,loading,error,load};
}

function statusTone(status:string){return status==="closed"||status==="completed"?"success":status==="follow_up"?"warning":"neutral"}

export function SupervisionWorkspace({setup}:{setup:Setup}){
  const templates=useRemote<Template[]>(`${base}/templates`,[]),reviews=useRemote<Review[]>(`${base}/reviews`,[]);
  const [tab,setTab]=useState<"reviews"|"templates">("reviews"),[editingTemplate,setEditingTemplate]=useState<Template|null>(null),[editingReview,setEditingReview]=useState<Review|null>(null);
  const createExample=()=>setEditingTemplate({id:"",name:"Academic supervision and teacher performance",description:"Reusable form based on the LMJS academic supervision example, with compliance, lesson observation, learner follow-up, progress and action planning.",sections:clone(lmjsSupervisionTemplate),active:true,version:1,reviewCount:0});
  const blankTemplate=()=>setEditingTemplate({id:"",name:"",description:"",sections:[{id:"section_1",title:"Supervision section",description:"",fields:[{id:"field_1",label:"Field name",type:"text",required:false}]}],active:true,version:1,reviewCount:0});
  const startReview=(template?:Template)=>{const t=template??templates.data.find(x=>x.active);if(!t)return;setEditingReview({id:"",templateId:t.id,templateName:t.name,templateVersion:t.version,title:"",observedOn:today(),status:"draft",answers:{},sections:clone(t.sections),version:1})};
  const entityName=(type?:string,id?:string)=>{if(!type||!id)return"—";const items=type==="teacher"?setup.teachers:type==="class"?setup.classes:type==="subject"?setup.subjects:setup.students??[];return items.find(x=>x.id===id)?.name||"Record unavailable"};

  return <div className="acad-page supervision-workspace">
    <div className="acad-head"><div><small>ACADEMICS</small><h1>Teacher supervision</h1><p>Build a form once, then reuse it for every teacher, class, subject or learner supervision visit.</p></div><div className="acad-head-actions">{tab==="reviews"&&templates.data.some(x=>x.active)&&<Button onClick={()=>startReview()}><FilePlus2 size={15}/> New supervision</Button>}{tab==="templates"&&<><Button variant="secondary" onClick={createExample}><Copy size={14}/> LMJS example</Button><Button onClick={blankTemplate}><Plus size={15}/> New form</Button></>}</div></div>
    <div className="acad-tabs"><button className={tab==="reviews"?"active":""} onClick={()=>setTab("reviews")}><ClipboardCheck size={15}/> Supervision records</button><button className={tab==="templates"?"active":""} onClick={()=>setTab("templates")}><Settings2 size={15}/> Form templates</button></div>
    {(templates.error||reviews.error)&&<Notice tone="danger">{templates.error||reviews.error}</Notice>}
    {tab==="reviews"?<>
      {!templates.loading&&!templates.data.length?<Card className="supervision-empty"><ClipboardCheck size={30}/><h2>Create your first supervision form</h2><p>Start with the attached LMJS-style form or build a shorter form from scratch.</p><div><Button onClick={createExample}>Use LMJS example</Button><Button variant="secondary" onClick={blankTemplate}>Build from scratch</Button></div></Card>:
      reviews.loading?<Spinner/>:<Card><div className="table-wrap"><table><thead><tr><th>Date</th><th>Person / subject</th><th>Form</th><th>Title</th><th>Status</th><th/></tr></thead><tbody>{reviews.data.map(r=><tr key={r.id}><td>{r.observedOn}</td><td>{entityName(r.primaryEntityType,r.primaryEntityId)}</td><td>{r.templateName}</td><td>{r.title||"—"}</td><td><Badge tone={statusTone(r.status) as any}>{words(r.status)}</Badge></td><td><button className="acad-link" onClick={()=>setEditingReview(clone(r))}>Open</button></td></tr>)}{!reviews.data.length&&<tr><td colSpan={6}>No supervision records yet. Use <b>New supervision</b> to complete a form.</td></tr>}</tbody></table></div></Card>}
    </>:templates.loading?<Spinner/>:<div className="supervision-template-grid">
      {templates.data.map(t=><Card key={t.id} className="supervision-template-card"><div className="supervision-template-title"><div><h2>{t.name}</h2><Badge tone={t.active?"success":"neutral"}>{t.active?"Active":"Inactive"}</Badge></div><p>{t.description||"No description"}</p></div><div className="supervision-template-meta"><span>{t.sections.length} sections</span><span>{t.sections.reduce((n,s)=>n+s.fields.length,0)} fields</span><span>{t.reviewCount} records</span><span>Version {t.version}</span></div><div className="supervision-card-actions"><Button variant="secondary" onClick={()=>setEditingTemplate(clone(t))}>Edit form</Button>{t.active&&<Button onClick={()=>startReview(t)}>Use form</Button>}<Button variant="secondary" onClick={()=>setEditingTemplate({...clone(t),id:"",name:`${t.name} copy`,version:1,reviewCount:0})}><Copy size={14}/> Copy</Button></div></Card>)}
      {!templates.data.length&&<Card className="supervision-empty"><h2>No form templates yet</h2><p>Create the LMJS example or build your own dynamic form.</p><div><Button onClick={createExample}>Use LMJS example</Button><Button variant="secondary" onClick={blankTemplate}>Build from scratch</Button></div></Card>}
    </div>}
    {editingTemplate&&<TemplateEditor template={editingTemplate} close={()=>setEditingTemplate(null)} saved={async()=>{setEditingTemplate(null);await templates.load();setTab("templates")}}/>}
    {editingReview&&<ReviewEditor review={editingReview} setup={setup} close={()=>setEditingReview(null)} saved={async()=>{setEditingReview(null);await reviews.load()}}/>}
  </div>
}

function TemplateEditor({template,close,saved}:{template:Template;close:()=>void;saved:()=>Promise<void>}){
  const [draft,setDraft]=useState(clone(template)),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const updateSection=(si:number,next:Partial<SupervisionSection>)=>setDraft(d=>({...d,sections:d.sections.map((s,i)=>i===si?{...s,...next}:s)}));
  const updateField=(si:number,fi:number,next:Partial<SupervisionField>)=>setDraft(d=>({...d,sections:d.sections.map((s,i)=>i!==si?s:{...s,fields:s.fields.map((f,j)=>j===fi?{...f,...next}:f)})}));
  const addSection=()=>setDraft(d=>{const n=d.sections.length+1;return{...d,sections:[...d.sections,{id:`section_${Date.now()}`,title:`Section ${n}`,description:"",fields:[]}]}});
  const addField=(si:number)=>{const id=`field_${Date.now()}`;updateSection(si,{fields:[...draft.sections[si]!.fields,{id,label:"New field",type:"text",required:false}]})};
  const removeField=(si:number,fi:number)=>updateSection(si,{fields:draft.sections[si]!.fields.filter((_,i)=>i!==fi)});
  const save=async()=>{setBusy(true);setError("");try{const payload={name:draft.name,description:draft.description,active:draft.active,sections:draft.sections,version:draft.version};if(draft.id)await put(`${base}/templates/${draft.id}`,payload);else await post(`${base}/templates`,payload);await saved()}catch(e){setError(errorText(e))}finally{setBusy(false)}};
  return <Modal title={draft.id?"Edit supervision form":"Create supervision form"} onClose={close}><div className="supervision-editor acad-wide">
    <div className="supervision-builder-head"><Field label="Form name"><input value={draft.name} onChange={e=>setDraft(d=>({...d,name:e.target.value}))} placeholder="e.g. Teacher lesson observation"/></Field><Field label="Description"><textarea rows={2} value={draft.description} onChange={e=>setDraft(d=>({...d,description:e.target.value}))}/></Field><label className="supervision-check"><input type="checkbox" checked={draft.active} onChange={e=>setDraft(d=>({...d,active:e.target.checked}))}/> Active and available for new supervision</label></div>
    <div className="supervision-sections">{draft.sections.map((section,si)=><div className="supervision-section-builder" key={section.id}><div className="supervision-section-head"><div><input className="supervision-title-input" value={section.title} onChange={e=>updateSection(si,{title:e.target.value,id:keyFrom(e.target.value,section.id)})}/><input value={section.description||""} onChange={e=>updateSection(si,{description:e.target.value})} placeholder="Optional instructions for this section"/></div><button className="icon-button" disabled={draft.sections.length===1} onClick={()=>setDraft(d=>({...d,sections:d.sections.filter((_,i)=>i!==si)}))} title="Remove section"><Trash2 size={16}/></button></div>
      <div className="supervision-field-list">{section.fields.map((field,fi)=><FieldBuilder key={`${section.id}-${fi}`} field={field} change={next=>updateField(si,fi,next)} remove={()=>removeField(si,fi)}/>)}</div>
      <Button variant="secondary" onClick={()=>addField(si)}><Plus size={14}/> Add field</Button>
    </div>)}</div>
    <Button variant="secondary" onClick={addSection}><Plus size={15}/> Add section</Button>
    {error&&<Notice tone="danger">{error}</Notice>}
    <div className="acad-modal-actions"><Button variant="secondary" onClick={close}>Cancel</Button><Button disabled={busy||!draft.name||draft.sections.some(s=>!s.fields.length)} onClick={()=>void save()}>{busy?"Saving…":"Save form"}</Button></div>
  </div></Modal>
}

function FieldBuilder({field,change,remove}:{field:SupervisionField;change:(next:Partial<SupervisionField>)=>void;remove:()=>void}){
  const setType=(type:SupervisionFieldType)=>{const next:Partial<SupervisionField>={type};if(type==="select"||type==="multi_select")next.options=field.options?.length?field.options:["Option 1","Option 2"];if(type==="rubric"){next.items=field.items?.length?field.items:["Indicator 1"];next.scale=field.scale||"compliance"}if(type==="table")next.columns=field.columns?.length?field.columns:[{id:"column_1",label:"Column 1",type:"text"}];change(next)};
  const updateColumn=(ci:number,next:Partial<SupervisionColumn>)=>change({columns:(field.columns??[]).map((c,i)=>i===ci?{...c,...next}:c)});
  return <div className="supervision-field-builder"><div className="supervision-field-main"><input value={field.label} onChange={e=>change({label:e.target.value,id:keyFrom(e.target.value,field.id)})} placeholder="Field name"/><select value={field.type} onChange={e=>setType(e.target.value as SupervisionFieldType)}>{supervisionFieldTypes.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select><label><input type="checkbox" checked={Boolean(field.required)} onChange={e=>change({required:e.target.checked})}/> Required</label><button className="icon-button" aria-label="Remove field" onClick={remove} title="Remove field"><Trash2 size={15}/></button></div>
    {(field.type==="select"||field.type==="multi_select")&&<textarea rows={2} value={(field.options??[]).join("\n")} onChange={e=>change({options:e.target.value.split("\n").map(x=>x.trim()).filter(Boolean)})} placeholder="One dropdown option per line"/>}
    {field.type==="rubric"&&<div className="supervision-config-row"><select value={field.scale||"compliance"} onChange={e=>change({scale:e.target.value as any})}><option value="compliance">Compliance: C / P / NC / NA</option><option value="rating4">Rating: 1–4 / NO</option><option value="rating5">Rating: 1–5 / NO</option></select><textarea rows={3} value={(field.items??[]).join("\n")} onChange={e=>change({items:e.target.value.split("\n").map(x=>x.trim()).filter(Boolean)})} placeholder="One indicator per line"/></div>}
    {field.type==="table"&&<div className="supervision-column-builder"><small>Repeating table columns</small>{(field.columns??[]).map((column,ci)=><div key={ci}><input value={column.label} onChange={e=>updateColumn(ci,{label:e.target.value,id:keyFrom(e.target.value,column.id)})}/><select value={column.type} onChange={e=>updateColumn(ci,{type:e.target.value as any})}>{supervisionFieldTypes.filter(t=>!["multi_select","rubric","table","time"].includes(t.value)).map(t=><option key={t.value} value={t.value}>{t.label}</option>)}</select><label><input type="checkbox" checked={Boolean(column.required)} onChange={e=>updateColumn(ci,{required:e.target.checked})}/> Required</label><button className="icon-button" aria-label={`Remove ${column.label || "column"}`} onClick={()=>change({columns:(field.columns??[]).filter((_,i)=>i!==ci)})}><Trash2 size={14}/></button></div>)}<button className="acad-link" onClick={()=>change({columns:[...(field.columns??[]),{id:`column_${Date.now()}`,label:"New column",type:"text"}]})}>+ Add column</button></div>}
  </div>
}

function ReviewEditor({review,setup,close,saved}:{review:Review;setup:Setup;close:()=>void;saved:()=>Promise<void>}){
  const [draft,setDraft]=useState(clone(review)),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const setAnswer=(id:string,value:any)=>setDraft(d=>({...d,answers:{...d.answers,[id]:value}}));
  const save=async(status:string)=>{setBusy(true);setError("");try{const payload={templateId:draft.templateId,title:draft.title,observedOn:draft.observedOn,status,answers:draft.answers,version:draft.version};if(draft.id)await put(`${base}/reviews/${draft.id}`,payload);else await post(`${base}/reviews`,payload);await saved()}catch(e){setError(errorText(e))}finally{setBusy(false)}};
  return <Modal title={`${draft.id?"Supervision record":"New supervision"} · ${draft.templateName}`} onClose={close}><div className="supervision-review acad-wide">
    <div className="supervision-review-meta"><Field label="Visit / review date"><input type="date" value={draft.observedOn} onChange={e=>setDraft(d=>({...d,observedOn:e.target.value}))}/></Field><Field label="Optional title"><input value={draft.title} onChange={e=>setDraft(d=>({...d,title:e.target.value}))} placeholder="e.g. Term 3 follow-up"/></Field><div><small>Status</small><Badge tone={statusTone(draft.status) as any}>{words(draft.status)}</Badge></div></div>
    {draft.sections.map((section,index)=><section className="supervision-form-section" key={section.id}><header><span>{index+1}</span><div><h2>{section.title}</h2>{section.description&&<p>{section.description}</p>}</div></header><div className="supervision-form-fields">{section.fields.map(field=><DynamicField key={field.id} field={field} value={draft.answers[field.id]} setup={setup} change={value=>setAnswer(field.id,value)}/>)}</div></section>)}
    {error&&<Notice tone="danger">{error}</Notice>}
    <div className="acad-modal-actions"><Button variant="secondary" onClick={close}>Cancel</Button><Button variant="secondary" disabled={busy} onClick={()=>void save("draft")}>{busy?"Saving…":"Save draft"}</Button><Button disabled={busy} onClick={()=>void save(draft.status==="follow_up"?"follow_up":"completed")}>{draft.id?"Save as completed":"Complete supervision"}</Button>{draft.id&&draft.status!=="closed"&&<Button disabled={busy} onClick={()=>void save("closed")}>Close record</Button>}</div>
  </div></Modal>
}

function entityItems(type:string,setup:Setup){return type==="teacher"?setup.teachers:type==="class"?setup.classes:type==="subject"?setup.subjects:type==="student"?setup.students??[]:[]}
function Input({type,value,field,setup,change}:{type:string;value:any;field:{options?:string[];placeholder?:string};setup:Setup;change:(value:any)=>void}){
  if(["teacher","class","subject","student"].includes(type)){const items=entityItems(type,setup);return <select value={value??""} onChange={e=>change(e.target.value)}><option value="">Select {type}…</option>{items.map(x=><option key={x.id} value={x.id}>{x.name}{type==="student"&&x.admissionNumber?` · ${x.admissionNumber}`:""}</option>)}</select>}
  if(type==="textarea")return <textarea rows={3} value={value??""} onChange={e=>change(e.target.value)} placeholder={field.placeholder}/>;
  if(type==="select")return <select value={value??""} onChange={e=>change(e.target.value)}><option value="">Select…</option>{(field.options??[]).map(x=><option key={x} value={x}>{x}</option>)}</select>;
  if(type==="number")return <input type="number" value={value??""} onChange={e=>change(e.target.value===""?"":Number(e.target.value))} placeholder={field.placeholder}/>;
  return <input type={type==="date"||type==="time"?type:"text"} value={value??""} onChange={e=>change(e.target.value)} placeholder={field.placeholder}/>;
}

function DynamicField({field,value,setup,change}:{field:SupervisionField;value:any;setup:Setup;change:(value:any)=>void}){
  if(field.type==="rubric")return <div className="supervision-rubric"><div className="supervision-field-label">{field.label}{field.required&&<b>*</b>}</div><div className="table-wrap"><table><thead><tr><th>Indicator</th><th>{field.scale==="compliance"?"C / P / NC / NA":"Rating"}</th><th>Evidence / coaching note</th></tr></thead><tbody>{(field.items??[]).map((item,index)=>{const row=value?.[String(index)]??{};const choices=field.scale==="compliance"?["C","P","NC","NA"]:field.scale==="rating5"?["1","2","3","4","5","NO"]:["1","2","3","4","NO"];return <tr key={index}><td>{item}</td><td><select value={row.value??""} onChange={e=>change({...value,[String(index)]:{...row,value:e.target.value===""?"":/^\d+$/.test(e.target.value)?Number(e.target.value):e.target.value}})}><option value="">—</option>{choices.map(x=><option key={x} value={x}>{x}</option>)}</select></td><td><input value={row.note??""} onChange={e=>change({...value,[String(index)]:{...row,note:e.target.value}})} placeholder="Evidence or note"/></td></tr>})}</tbody></table></div></div>;
  if(field.type==="table")return <div className="supervision-repeater"><div className="supervision-field-label">{field.label}{field.required&&<b>*</b>}</div><div className="table-wrap"><table><thead><tr>{(field.columns??[]).map(c=><th key={c.id}>{c.label}{c.required&&" *"}</th>)}<th/></tr></thead><tbody>{(Array.isArray(value)?value:[]).map((row:Row,ri:number)=><tr key={ri}>{(field.columns??[]).map(column=><td key={column.id}><Input type={column.type} value={row[column.id]} field={column} setup={setup} change={next=>change((value??[]).map((r:Row,i:number)=>i===ri?{...r,[column.id]:next}:r))}/></td>)}<td><button className="icon-button" onClick={()=>change(value.filter((_:any,i:number)=>i!==ri))}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div><Button variant="secondary" onClick={()=>change([...(Array.isArray(value)?value:[]),{}])}><Plus size={14}/> Add row</Button></div>;
  if(field.type==="multi_select")return <div className="supervision-choice-field"><div className="supervision-field-label">{field.label}{field.required&&<b>*</b>}</div>{(field.options??[]).map(option=><label key={option}><input type="checkbox" checked={(value??[]).includes(option)} onChange={e=>change(e.target.checked?[...(value??[]),option]:(value??[]).filter((x:string)=>x!==option))}/>{option}</label>)}</div>;
  return <Field label={`${field.label}${field.required?" *":""}`}><Input type={field.type} value={value} field={field} setup={setup} change={change}/>{field.helpText&&<small>{field.helpText}</small>}</Field>;
}

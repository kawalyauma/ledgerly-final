import { useEffect,useMemo,useState } from "react";
import { CalendarClock,Monitor,Plus,RefreshCw,ShieldCheck,Trash2 } from "lucide-react";
import { can,del,errorText,get,post } from "../../../web/api";
import { useAuth } from "../../../web/auth";
import { Badge,Button,Card,EmptyState,Field,Modal,Notice,Spinner } from "../../../web/components/ui";

type Row=Record<string,any>;
const base="/school/duty-roster";
const roles=["Teacher on duty","Deputy teacher on duty","Gate duty","Dining duty","Dormitory duty","Games duty"];

function isoDay(date:Date){return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,10)}
function nextFriday(from:string){const d=new Date(`${from}T00:00:00`);d.setDate(d.getDate()+((5-d.getDay()+7)%7));return isoDay(d)}
function staffLabel(s:Row){return [s.preferredName||s.firstName,s.lastName].filter(Boolean).join(" ")||s.staffNumber||"Staff member"}
function shortDate(value:string){return new Date(`${value}T00:00:00`).toLocaleDateString("en-UG",{weekday:"short",day:"numeric",month:"short"})}

export function DutyRosterPage(){
  const{principal}=useAuth(),write=can(principal,"school:write");
  const[rows,setRows]=useState<Row[]>([]),[staff,setStaff]=useState<Row[]>([]),[loading,setLoading]=useState(true),[message,setMessage]=useState(""),[adding,setAdding]=useState(false);
  const today=isoDay(new Date());
  async function load(){
    setLoading(true);setMessage("");
    try{
      const[r,s]=await Promise.all([get<Row[]>(base),get<Row[]>("/school/staff-management/staff?limit=500")]);
      setRows(r);setStaff(s.filter(x=>x.employmentStatus==="active"&&!x.deletedAt));
    }catch(e){setMessage(errorText(e))}finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[principal?.organizationId]);
  const onDuty=useMemo(()=>rows.filter(r=>r.startsOn<=today&&r.endsOn>=today),[rows,today]);
  const upcoming=useMemo(()=>rows.filter(r=>r.startsOn>today),[rows,today]);
  async function remove(row:Row){
    if(!confirm(`Remove ${row.staffName} from ${row.dutyRole} (${shortDate(row.startsOn)} – ${shortDate(row.endsOn)})?`))return;
    try{await del(`${base}/${row.id}`);setMessage("Duty entry removed.");await load()}catch(e){setMessage(errorText(e))}
  }
  return <div className="page school-shell">
    <div className="school-page-head"><div><span className="eyebrow">School management · Staff</span><h1>Duty roster</h1><p>Set the teacher on duty and other duties for each week. Whoever is on duty today appears on the school kiosk display.</p></div><div className="heading-actions"><Button variant="secondary" onClick={()=>void load()}><RefreshCw size={15}/> Refresh</Button>{write&&<Button onClick={()=>setAdding(true)}><Plus size={15}/> Assign duty</Button>}</div></div>
    <div className="school-metrics">
      <Card><span className="school-metric-icon"><ShieldCheck/></span><small>On duty today</small><strong>{onDuty.length}</strong><em>{onDuty.map(r=>r.staffName).join(", ")||"Nobody assigned"}</em></Card>
      <Card><span className="school-metric-icon"><CalendarClock/></span><small>Upcoming</small><strong>{upcoming.length}</strong><em>Duty assignments scheduled ahead</em></Card>
      <Card><span className="school-metric-icon"><Monitor/></span><small>Kiosk display</small><strong>Live</strong><em>Today's duty team shows on the wall screen</em></Card>
    </div>
    <Card className="school-panel">
      <div className="school-panel-head"><div><h2>Roster</h2><p>Past 30 days and the coming four months.</p></div></div>
      {message&&<div className="ops-pad"><Notice tone={/removed|assigned/i.test(message)?"success":"danger"}>{message}</Notice></div>}
      {loading?<Spinner/>:rows.length?<div className="table-wrap school-table"><table><thead><tr><th>Staff member</th><th>Duty</th><th>From</th><th>To</th><th>Status</th><th/></tr></thead><tbody>{rows.map(row=>{
        const state=row.endsOn<today?"Finished":row.startsOn>today?"Upcoming":"On duty";
        return <tr key={row.id}><td><b>{row.staffName}</b>{row.notes&&<small>{row.notes}</small>}</td><td>{row.dutyRole}</td><td>{shortDate(row.startsOn)}</td><td>{shortDate(row.endsOn)}</td><td><Badge tone={state==="On duty"?"success":state==="Upcoming"?"warning":"neutral"}>{state}</Badge></td><td className="row-actions">{write&&<Button variant="ghost" title="Remove" onClick={()=>void remove(row)}><Trash2 size={15}/></Button>}</td></tr>})}</tbody></table></div>
      :<EmptyState title="No duties assigned" description="Assign a teacher on duty for this week so it shows on the kiosk display." action={write?<Button onClick={()=>setAdding(true)}><Plus size={15}/> Assign duty</Button>:undefined}/>}
    </Card>
    {adding&&<DutyModal staff={staff} today={today} close={()=>setAdding(false)} done={async()=>{setAdding(false);setMessage("Duty assigned.");await load()}}/>}
  </div>
}

function DutyModal({staff,today,close,done}:{staff:Row[];today:string;close:()=>void;done:()=>void}){
  const teachers=useMemo(()=>[...staff].sort((a,b)=>Number(!!b.isTeacher)-Number(!!a.isTeacher)||staffLabel(a).localeCompare(staffLabel(b))),[staff]);
  const[form,setForm]=useState({staffId:"",dutyRole:roles[0],startsOn:today,endsOn:nextFriday(today),notes:""}),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const set=(key:keyof typeof form,value:string)=>setForm(f=>({...f,[key]:value}));
  async function save(){
    if(!form.staffId){setError("Choose a staff member.");return}
    if(form.endsOn<form.startsOn){setError("The end date must be on or after the start date.");return}
    setBusy(true);setError("");
    try{await post(base,{...form,notes:form.notes.trim()||null});done()}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  return <Modal title="Assign duty" onClose={close} locked={busy}><div className="modal-body">
    <Field label="Staff member"><select autoFocus value={form.staffId} onChange={e=>set("staffId",e.target.value)}><option value="">Choose…</option>{teachers.map(s=><option key={s.id} value={s.id}>{staffLabel(s)}{s.isTeacher?"":" (non-teaching)"}</option>)}</select></Field>
    <Field label="Duty"><input list="duty-roles" value={form.dutyRole} onChange={e=>set("dutyRole",e.target.value)}/><datalist id="duty-roles">{roles.map(r=><option key={r} value={r}/>)}</datalist></Field>
    <div className="form-grid" style={{gridTemplateColumns:"1fr 1fr"}}><Field label="From"><input type="date" value={form.startsOn} onChange={e=>set("startsOn",e.target.value)}/></Field><Field label="To"><input type="date" value={form.endsOn} min={form.startsOn} onChange={e=>set("endsOn",e.target.value)}/></Field></div>
    <Field label="Notes" hint="Optional, e.g. contact point or area covered."><input value={form.notes} maxLength={500} onChange={e=>set("notes",e.target.value)}/></Field>
    {error&&<Notice tone="danger">{error}</Notice>}
  </div><div className="modal-actions"><Button variant="ghost" onClick={close}>Cancel</Button><Button disabled={busy} onClick={()=>void save()}>{busy?"Saving…":"Assign duty"}</Button></div></Modal>
}

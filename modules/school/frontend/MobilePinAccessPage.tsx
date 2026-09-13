import { useEffect,useMemo,useState } from "react";
import { KeyRound,RefreshCw,Search,ShieldCheck,Smartphone,Trash2 } from "lucide-react";
import { can,del,errorText,get,put } from "../../../web/api";
import { useAuth } from "../../../web/auth";
import { Badge,Button,Card,EmptyState,Field,Modal,Notice,Spinner } from "../../../web/components/ui";

type Row=Record<string,any>;
type PinStatus={userId:string;pinConfigured:boolean;updatedAt?:string};
const base="/school/mobile-pin";
const weak=new Set(["0000","1111","2222","3333","4444","5555","6666","7777","8888","9999","0123","1234","2345","3456","4567","5678","6789","9876","8765","7654","6543","5432","4321","3210"]);

function makePin(){
  const values=new Uint32Array(1);
  for(let i=0;i<50;i++){
    crypto.getRandomValues(values);
    const pin=String(values[0]%10000).padStart(4,"0");
    if(!weak.has(pin))return pin;
  }
  return "4827";
}

function words(value:unknown){return String(value??"—").replaceAll("_"," ")}

export function MobilePinAccessPage(){
  const{principal}=useAuth(),write=can(principal,"school:write");
  const[users,setUsers]=useState<Row[]>([]),[status,setStatus]=useState<PinStatus[]>([]),[loading,setLoading]=useState(true),[message,setMessage]=useState(""),[query,setQuery]=useState(""),[selected,setSelected]=useState<Row|null>(null);
  async function load(){
    setLoading(true);setMessage("");
    try{
      const[u,s]=await Promise.all([get<Row[]>("/school/iam/users"),get<PinStatus[]>(`${base}/status`)]);
      setUsers(u);setStatus(s);
    }catch(e){setMessage(errorText(e))}finally{setLoading(false)}
  }
  useEffect(()=>{void load()},[principal?.organizationId]);
  const configured=new Map(status.map(x=>[x.userId,x]));
  const rows=useMemo(()=>users.filter(u=>`${u.displayName||""} ${u.email||""} ${u.staffNumber||""} ${u.username||""} ${u.coreRole||""}`.toLowerCase().includes(query.trim().toLowerCase())),[users,query]);
  async function remove(user:Row){
    if(!confirm(`Remove mobile PIN access for ${user.displayName}?`))return;
    setMessage("");
    try{await del(`${base}/users/${user.id}`);setMessage(`Mobile PIN removed for ${user.displayName}.`);await load()}catch(e){setMessage(errorText(e))}
  }
  return <div className="page school-shell">
    <div className="school-page-head"><div><span className="eyebrow">School management · Security</span><h1>Mobile PIN Access</h1><p>Give employees a fast 4-digit Ledgerly login for trusted school phones and attendance kiosks without changing their normal roles or permissions.</p></div><div className="heading-actions"><Button variant="secondary" onClick={()=>void load()}><RefreshCw size={15}/> Refresh</Button></div></div>
    <div className="school-metrics">
      <Card><span className="school-metric-icon"><KeyRound/></span><small>PIN enabled</small><strong>{status.length}</strong><em>School users with mobile PIN access</em></Card>
      <Card><span className="school-metric-icon"><Smartphone/></span><small>Trusted-device only</small><strong>4 digits</strong><em>PINs cannot log in from an unknown device</em></Card>
      <Card><span className="school-metric-icon"><ShieldCheck/></span><small>Permissions</small><strong>Unchanged</strong><em>Every employee keeps the same Ledgerly role scopes</em></Card>
    </div>
    <Card className="school-panel">
      <div className="school-panel-head"><div><h2>Employee PINs</h2><p>Assign, reset or remove a PIN. Existing PINs are never displayed after saving.</p></div></div>
      <div className="ops-pad"><Notice tone="info">For security, the PIN works only after a full Ledgerly login has trusted the phone, or on an already enrolled attendance kiosk. Five wrong attempts temporarily lock PIN entry on that device.</Notice></div>
      {message&&<div className="ops-pad"><Notice tone={/removed|saved|assigned|updated/i.test(message)?"success":"danger"}>{message}</Notice></div>}
      <div className="school-table-toolbar"><label><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search employee name, staff number, email or role…"/></label></div>
      {loading?<Spinner/>:rows.length?<div className="table-wrap school-table"><table><thead><tr><th>Employee / user</th><th>Staff number</th><th>Role</th><th>Mobile PIN</th><th>Last changed</th><th/></tr></thead><tbody>{rows.map(user=>{const pin=configured.get(user.id);return <tr key={user.id}><td><b>{user.displayName}</b><small>{user.email}{user.username?` · ${user.username}`:""}</small></td><td>{user.staffNumber||"—"}</td><td>{words(user.coreRole)}<small>{(user.roles||[]).map((r:Row)=>r.name).join(", ")||"No school role"}</small></td><td>{pin?<Badge tone="success">PIN ready</Badge>:<Badge tone="neutral">Not assigned</Badge>}</td><td>{pin?.updatedAt?new Date(pin.updatedAt).toLocaleString():"—"}</td><td><div className="row-actions">{write&&<Button variant="secondary" onClick={()=>setSelected(user)}><KeyRound size={14}/>{pin?"Reset PIN":"Assign PIN"}</Button>}{write&&pin&&<button aria-label={`Remove PIN for ${user.displayName}`} onClick={()=>void remove(user)}><Trash2 size={15}/></button>}</div></td></tr>})}</tbody></table></div>:<EmptyState title="No school users found" description="Create school users first, then assign their mobile PINs here."/>}
    </Card>
    {selected&&<PinModal user={selected} close={()=>setSelected(null)} done={async()=>{setSelected(null);setMessage(`Mobile PIN saved for ${selected.displayName}.`);await load()}}/>}
  </div>
}

function PinModal({user,close,done}:{user:Row;close:()=>void;done:()=>void}){
  const[pin,setPin]=useState(makePin()),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const valid=/^\d{4}$/.test(pin)&&!weak.has(pin);
  async function save(){
    if(!valid){setError("Choose exactly four less-predictable digits.");return}
    setBusy(true);setError("");
    try{await put(`${base}/users/${user.id}`,{pin});done()}catch(e){setError(errorText(e))}finally{setBusy(false)}
  }
  return <Modal title={`Mobile PIN · ${user.displayName}`} onClose={close} locked={busy}><div className="modal-body">
    <Notice tone="warning">Give this PIN privately to the employee. Ledgerly will not show it again after you save it.</Notice>
    <Field label="4-digit employee PIN" hint="Avoid repeated digits and simple sequences such as 1234."><input inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoFocus value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,4))} style={{fontSize:"2rem",fontWeight:900,letterSpacing:"1rem",textAlign:"center"}}/></Field>
    <div className="row-actions"><Button type="button" variant="secondary" onClick={()=>setPin(makePin())}>Generate another PIN</Button></div>
    {error&&<Notice tone="danger">{error}</Notice>}
  </div><div className="modal-actions"><Button variant="ghost" onClick={close}>Cancel</Button><Button disabled={busy||!valid} onClick={()=>void save()}>{busy?"Saving…":"Save PIN"}</Button></div></Modal>
}

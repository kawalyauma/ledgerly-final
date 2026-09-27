import{useEffect,useState}from"react";
import{ArrowRight,BookOpenCheck,CalendarCheck,CheckCircle2,CircleDollarSign,ClipboardList,GraduationCap,ListChecks,Receipt,RefreshCw,Sparkles,Users}from"lucide-react";
import{get,can,type Principal}from"../../../web/api";
import{useAuth}from"../../../web/auth";
import"./fusion-home.css";

type Overview={generatedAt:string;students:{active:number;total:number}|null;staff:{total:number;teachers:number}|null;fees:{billedMinor:number;collectedMinor:number;outstandingMinor:number;collectionRate:number}|null;attendance:{marked:number;present:number;absent:number}|null;finance:{revenueMinor:number;expensesMinor:number;cashMinor:number}|null;tasks:{open:number;overdue:number}|null;exams:Array<{label:string;value:number}>|null};
const money=(minor=0)=>`UGX ${Math.round(minor/100).toLocaleString()}`;
const go=(path:string)=>{location.hash=path};
function useIdentity(p:Principal|null){const[org,setOrg]=useState("Workspace"),[name,setName]=useState("");useEffect(()=>{get<Array<{id:string;name:string}>>("/organizations").then(xs=>setOrg(xs.find(x=>x.id===p?.organizationId)?.name||"Workspace")).catch(()=>{});if(can(p,"admin:read"))get<Array<{userId:string;displayName:string}>>("/admin/memberships").then(xs=>setName(xs.find(x=>x.userId===p?.userId)?.displayName||"")).catch(()=>{})},[p]);return{org,name}}
export function FusionWelcome(){
 const{principal}=useAuth(),{org,name}=useIdentity(principal),[data,setData]=useState<Overview|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState("");
 const load=()=>{setLoading(true);setError("");get<Overview>("/workspace/overview").then(setData).catch(()=>setError("Workspace summary is temporarily unavailable. Refresh to try again.")).finally(()=>setLoading(false))};useEffect(load,[]);
 const hour=new Date().getHours(),greeting=hour<12?"Good morning":hour<17?"Good afternoon":"Good evening",first=name.split(/\s+/).filter(Boolean)[0];
 const rate=Math.max(0,Math.min(100,Math.round((data?.fees?.collectionRate??0)*100))),attendance=data?.attendance?.marked?Math.round((data.attendance.present/data.attendance.marked)*100):0;
 const financeMax=Math.max(1,data?.finance?.revenueMinor??0,data?.finance?.expensesMinor??0),incomePct=Math.round(((data?.finance?.revenueMinor??0)/financeMax)*100),expensePct=Math.round(((data?.finance?.expensesMinor??0)/financeMax)*100),net=(data?.finance?.revenueMinor??0)-(data?.finance?.expensesMinor??0);
 const financeTarget=can(principal,"reports:read")?"reports":"dashboards";
 const quick=[{label:"Students",path:"school/students",scope:"school:read",Icon:GraduationCap},{label:"Receive fees",path:"school/fees/receipts",scope:"school:read",Icon:Receipt},{label:"Attendance",path:"attendance/live",scope:"school:read",Icon:CalendarCheck},{label:"Tasks",path:"work/tasks",scope:undefined,Icon:ListChecks},{label:"Examinations",path:"exams/exams",scope:"school:read",Icon:ClipboardList},{label:"Academics",path:"academics",scope:"school:read",Icon:BookOpenCheck}].filter(item=>!item.scope||can(principal,item.scope));
 return <div className="page fusion-home">
  <header className="fusion-greeting"><div><span className="fusion-kicker"><Sparkles size={14}/> Ledgerly workspace</span><h1>{greeting}{first?`, ${first}`:""}!</h1><p>{org} · {new Date().toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"})}</p></div><button className="fusion-refresh" onClick={load} disabled={loading}><RefreshCw size={15}/> Refresh</button></header>
  <nav className="fusion-quick" aria-label="Quick actions">{quick.map(({label,path,Icon})=><button key={path} onClick={()=>go(path)}><span><Icon size={16}/></span>{label}</button>)}</nav>
  {error&&<div className="fusion-error" role="status">{error}</div>}
  <section className="fusion-feed"><div className="fusion-section-head"><div><span className="fusion-spark">✦</span><h2>School feed</h2></div><small>Live signals from your records</small></div><div className="fusion-feed-grid">
   <article><span className="fusion-feed-icon"><CircleDollarSign size={18}/></span><div><strong>Fees & billing</strong><p>{data?.fees?`${money(data.fees.outstandingMinor)} is still outstanding.`:"Fee information will appear here when available."}</p><button onClick={()=>go("school/fees/balances")}>Review balances <ArrowRight size={13}/></button></div></article>
   <article><span className="fusion-feed-icon"><CalendarCheck size={18}/></span><div><strong>Attendance</strong><p>{data?.attendance?.marked?`${data.attendance.present.toLocaleString()} present and ${data.attendance.absent.toLocaleString()} absent today.`:"No attendance register has been marked yet today."}</p><button onClick={()=>go("attendance/live")}>Open attendance <ArrowRight size={13}/></button></div></article>
   <article><span className="fusion-feed-icon"><ListChecks size={18}/></span><div><strong>Tasks & work</strong><p>{data?.tasks?`${data.tasks.open.toLocaleString()} open tasks${data.tasks.overdue?`, ${data.tasks.overdue} overdue`:""}.`:"Team work updates will appear here."}</p><button onClick={()=>go("work/tasks")}>Review tasks <ArrowRight size={13}/></button></div></article>
  </div></section>
  <div className="fusion-overview-row"><section className="fusion-glance"><div className="fusion-section-head"><div><h2>School at a glance</h2></div><button onClick={()=>go("dashboards")}>Open full dashboard <ArrowRight size={14}/></button></div><div className="fusion-glance-grid">
   <article className="fusion-stat"><span>Active students</span><strong>{loading?"—":data?.students?.active.toLocaleString()??"—"}</strong><small>{data?.students?`${data.students.total.toLocaleString()} learners on record`:"Student records"}</small><span className="fusion-stat-icon"><GraduationCap size={18}/></span></article>
   <article className="fusion-stat"><span>Staff</span><strong>{loading?"—":data?.staff?.total.toLocaleString()??"—"}</strong><small>{data?.staff?`${data.staff.teachers.toLocaleString()} teachers`:"Staff records"}</small><span className="fusion-stat-icon"><Users size={18}/></span></article>
   <article className="fusion-stat fusion-progress-card"><div><span>Fee collection</span><strong>{data?.fees?`${rate}%`:"—"}</strong></div><div className="fusion-progress"><span style={{width:`${rate}%`}}/></div><small>{data?.fees?`${money(data.fees.collectedMinor)} of ${money(data.fees.billedMinor)} collected`:"No billing summary yet"}</small></article>
   <article className="fusion-stat fusion-progress-card"><div><span>Attendance today</span><strong>{data?.attendance?.marked?`${attendance}%`:"—"}</strong></div><div className="fusion-progress"><span style={{width:`${attendance}%`}}/></div><small>{data?.attendance?.marked?`${data.attendance.marked.toLocaleString()} marked today`:"Waiting for registers"}</small></article>
   <article className="fusion-stat"><span>Cash & bank</span><strong>{data?.finance?money(data.finance.cashMinor):"—"}</strong><small>Current finance position</small><span className="fusion-stat-icon"><CircleDollarSign size={18}/></span></article>
   <article className="fusion-stat"><span>Open tasks</span><strong>{data?.tasks?data.tasks.open.toLocaleString():"—"}</strong><small>{data?.tasks?.overdue?`${data.tasks.overdue} overdue`:"No overdue work flagged"}</small><span className="fusion-stat-icon"><CheckCircle2 size={18}/></span></article>
  </div></section>
  <section className="fusion-finance-card">
   <header><div><span>Finance snapshot</span><h2>{data?.finance?money(net):"—"}</h2><p>{data?.finance?(net>=0?"Net income":"Net position"):"Finance data will appear here"}</p></div><button onClick={()=>go(financeTarget)}>{financeTarget==="reports"?"Reports":"Dashboard"} <ArrowRight size={14}/></button></header>
   <div className="fusion-finance-row"><div><span>Income</span><strong>{data?.finance?money(data.finance.revenueMinor):"—"}</strong></div><div className="fusion-finance-track"><i style={{width:`${incomePct}%`}}/></div></div>
   <div className="fusion-finance-row"><div><span>Expenses</span><strong>{data?.finance?money(data.finance.expensesMinor):"—"}</strong></div><div className="fusion-finance-track expense"><i style={{width:`${expensePct}%`}}/></div></div>
   <div className="fusion-finance-footer"><span>Cash & bank</span><strong>{data?.finance?money(data.finance.cashMinor):"—"}</strong></div>
  </section></div>
  {data?.generatedAt&&<p className="fusion-updated">Updated {new Date(data.generatedAt).toLocaleTimeString()}</p>}
 </div>
}

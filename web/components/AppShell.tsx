import{useEffect,useMemo,useRef,useState,type ReactNode}from"react";
import{Bell,ChevronDown,ChevronRight,Circle,FileBarChart,Home,LayoutGrid,LogOut,Menu,Plus,Search,Settings,ShieldCheck,Sparkles,Wallet,X}from"lucide-react";
import{get,post,can,type Principal,type Session}from"../api";
import{useAuth}from"../auth";
import{arrangeGroups,useNavigationSettings}from"../navigationSettings";
import{moduleInPlan,sectionInPlan,useSubscription}from"../plans";
import{appGlobalActions,appNavigation}from"../../modules/frontend-registry";
import type{FrontendGlobalAction as GlobalAction,FrontendNavigationGroup as Group,FrontendNavigationItem as Item}from"../../modules/frontend-types";

const allowed=(i:{scope?:string;admin?:boolean},p:Principal|null)=>(!i.scope||can(p,i.scope))&&(!i.admin||!!p&&["owner","admin"].includes(p.role));
const visible=(xs:Item[],p:Principal|null):Item[]=>xs.filter(i=>allowed(i,p)).map(i=>i.children?{...i,children:visible(i.children,p)}:i);
const flat=(xs:Item[]):Item[]=>xs.flatMap(i=>[i,...flat(i.children??[])]);
const hit=(path:string,p:string)=>path===p||path.startsWith(`${p}/`);

function Link({item,active,onGo,depth=0}:{item:Item;active:string;onGo:(p:string)=>void;depth?:number}){
 const kids=item.children??[],current=kids.length?hit(active,item.path):active===item.path,[open,setOpen]=useState(flat(kids).some(k=>hit(active,k.path)));
 useEffect(()=>{if(current)setOpen(true)},[current]);const Icon=item.icon??Circle;
 if(!kids.length)return <button className={`nav-item depth-${depth} ${current?"active":""}`} onClick={()=>onGo(item.path)}><Icon size={17}/><span>{item.label}</span></button>;
 return <div className={`nav-branch ${current?"current":""}`}><button className={`nav-item depth-${depth}`} onClick={()=>{setOpen(v=>!v);if(depth>0)onGo(item.path)}}><Icon size={17}/><span>{item.label}</span>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>{open&&<div className="nav-branch-children">{kids.map(k=><Link key={`${k.path}-${k.label}`} item={k} active={active} onGo={onGo} depth={depth+1}/>)}</div>}</div>
}

type Org={id:string;name:string};
export function AppShell({children,active,onNavigate}:{children:ReactNode;active:string;onNavigate:(p:string)=>void}){
 const[mobile,setMobile]=useState(false),[account,setAccount]=useState(false),[orgs,setOrgs]=useState<Org[]>([]),[switching,setSwitching]=useState(false),[name,setName]=useState("Current user"),[chatUnread,setChatUnread]=useState(0),[menu,setMenu]=useState<string|null>(null),[apps,setApps]=useState(false),[quick,setQuick]=useState(false),[q,setQ]=useState("");
 const searchRef=useRef<HTMLInputElement>(null);
 const{principal,login,logout}=useAuth();
 useEffect(()=>{get<Org[]>("/organizations").then(setOrgs).catch(()=>{});if(can(principal,"admin:read"))get<Array<{userId:string;displayName:string}>>("/admin/memberships").then(x=>setName(x.find(m=>m.userId===principal?.userId)?.displayName||"Current user")).catch(()=>{})},[principal]);
 useEffect(()=>{const load=()=>get<Array<{unread_count?:number}>>("/work/chat/threads").then(x=>setChatUnread(x.reduce((n,t)=>n+Number(t.unread_count||0),0))).catch(()=>{});load();const timer=setInterval(load,15000);return()=>clearInterval(timer)},[principal]);
 useEffect(()=>{const onKey=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();searchRef.current?.focus()}if(e.key==="Escape"){setMobile(false);setAccount(false);setMenu(null);setApps(false);setQuick(false);setQ("")}};addEventListener("keydown",onKey);return()=>removeEventListener("keydown",onKey)},[]);
 async function switchOrg(id:string){if(id===principal?.organizationId)return;setSwitching(true);try{const s=await post<Session>("/organizations/switch",{organizationId:id});localStorage.setItem("finance.activeOrganization",id);login(s,localStorage.getItem("finance.remember")!=="false");location.reload()}finally{setSwitching(false)}}
 const go=(p:string)=>{onNavigate(p);setMobile(false);setAccount(false);setMenu(null);setApps(false);setQuick(false);setQ("")};
 const layout=useNavigationSettings(principal?.organizationId),subscription=useSubscription(principal?.organizationId),isAdmin=!!principal&&["owner","admin"].includes(principal.role);
 const groups=useMemo(()=>layout===undefined||!subscription?[]:arrangeGroups(appNavigation,layout).filter(g=>sectionInPlan(g.key,subscription.plan)).map(g=>({group:g,items:visible(g.items,principal)})).filter(g=>g.items.length),[principal,layout,subscription]);
 const entries=useMemo(()=>{const all=groups.flatMap(({group,items})=>flat(items).map(item=>({group,item})));return all.filter((entry,index)=>all.findIndex(other=>other.item.path===entry.item.path)===index)},[groups]);
 const activeItem=entries.filter(x=>hit(active,x.item.path)).sort((a,b)=>b.item.path.length-a.item.path.length)[0]?.item.path??active;
 const activeGroup=groups.find(g=>flat(g.items).some(i=>hit(active,i.path)))?.group.key;
 const stripGroups=groups.filter(({group})=>!["Dashboard","Organization","System status","Billing"].includes(group.label));
 const selected=groups.find(g=>g.group.key===menu),currentOrg=orgs.find(o=>o.id===principal?.organizationId);
 const search=q.trim().toLowerCase()?entries.filter(({group,item})=>`${group.label} ${item.label}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0,8):[];
 const initials=name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]?.toUpperCase()).join("")||"U";
 const find=(labels:string[])=>entries.find(({item})=>labels.some(x=>item.label.toLowerCase().includes(x)))?.item;
 const quickItems=[find(["students"]),find(["receipts","payment"]),find(["sales"]),find(["expenses"]),find(["attendance"]),find(["tasks"])].filter((x,i,a):x is Item=>!!x&&a.findIndex(y=>y?.path===x.path)===i);
 const canAskAi=entries.some(({item})=>item.path==="ledgerly-ai-ask");
 const askSearch=()=>{const query=q.trim();if(!query||!canAskAi)return;try{sessionStorage.setItem("ledgerly-ai.prefill",query)}catch{}go("ledgerly-ai-ask")};
 return <div className="app-shell fusion-shell">
  {mobile&&<button className="scrim" aria-label="Close navigation" onClick={()=>setMobile(false)}/>} 
  <aside className={`sidebar unified-sidebar ${mobile?"sidebar--open":""}`}>
   <div className="brand"><button className="brand-home" onClick={()=>go("welcome")}><span className="ledgerly-mark">L</span><b>Ledgerly</b></button><button className="mobile-close" aria-label="Close navigation" onClick={()=>setMobile(false)}><X size={19}/></button></div>
   <button className={`rail-action ${quick?"active":""}`} aria-expanded={quick} aria-label="Open create and quick actions" onClick={()=>{setQuick(v=>!v);setApps(false);setMenu(null);setMobile(false)}}><Plus size={20}/><span>Create</span></button>
   <nav className="rail-links"><button className={active==="welcome"?"active":""} onClick={()=>go("welcome")}><Home size={19}/><span>Home</span></button><button className={hit(active,"dashboards")?"active":""} onClick={()=>go("dashboards")}><LayoutGrid size={19}/><span>Dashboard</span></button>{entries.some(e=>e.item.path==="reports")&&<button className={hit(active,"reports")?"active":""} onClick={()=>go("reports")}><FileBarChart size={19}/><span>Reports</span></button>}<button className={apps?"active":""} aria-expanded={apps} onClick={()=>{setApps(v=>!v);setQuick(false);setMenu(null)}}><LayoutGrid size={19}/><span>Apps</span></button></nav>
   <div className="mobile-navigation">{orgs.length>1&&<select disabled={switching} value={principal?.organizationId||""} onChange={e=>void switchOrg(e.target.value)}>{orgs.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select>}<div className="nav-list">{groups.map(({group,items})=><section className="nav-section" key={group.key}><div className="nav-section-head"><span>{group.label}</span></div>{items.map(i=><Link key={`${i.path}-${i.label}`} item={i} active={activeItem} onGo={go}/>)}</section>)}</div></div>
   {isAdmin&&<button className="rail-customize" onClick={()=>go("workspace-settings")}><Settings size={18}/><span>Customize</span></button>}
  </aside>
  <div className="workspace">
   <header className="topbar"><button className="menu-button" aria-label="Open navigation" onClick={()=>setMobile(true)}><Menu size={20}/></button><div className="workspace-name"><span>Ledgerly</span>{orgs.length>1?<select aria-label="Active organization" disabled={switching} value={principal?.organizationId||""} onChange={e=>void switchOrg(e.target.value)}>{orgs.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select>:<strong>{currentOrg?.name||"Workspace"}</strong>}</div><div className="search-wrap"><label className="global-search"><Search size={17}/><input ref={searchRef} value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();if(search[0])go(search[0].item.path);else askSearch()}}} placeholder="Search, jump to, or ask a question"/></label>{q.trim()&&<div className="search-results">{search.map(({group,item})=>{const Icon=item.icon??group.icon;return <button key={`${group.key}-${item.path}`} onClick={()=>go(item.path)}><Icon size={16}/><span><strong>{item.label}</strong><small>{group.label}</small></span><ChevronRight size={15}/></button>})}{canAskAi&&<button className="search-ask-ai" onClick={askSearch}><Sparkles size={16}/><span><strong>Ask Ledgerly AI</strong><small>{q.trim()}</small></span><ChevronRight size={15}/></button>}{!search.length&&!canAskAi&&<p>No matching page</p>}</div>}</div><div className="topbar__actions">{appGlobalActions.filter(a=>allowed(a as GlobalAction,principal)&&!!subscription&&moduleInPlan(a.moduleKey,subscription.plan)).map(a=>{const A=a.component;return <A key={a.key} activePath={active}/>})}<button className="icon-button app-chat-bell" onClick={()=>go("work/chats")}><Bell size={19}/>{chatUnread>0&&<b>{chatUnread>99?"99+":chatUnread}</b>}</button><div className="account-wrap"><button className="profile" aria-label="Account menu" aria-expanded={account} onClick={()=>setAccount(v=>!v)}><span className="profile-avatar">{initials}</span><span className="profile-copy"><strong>{name}</strong><small>{principal?.role}</small></span><ChevronDown size={14}/></button>{account&&<div className="account-menu"><p><b>{name}</b><small>{principal?.role}</small></p><button onClick={()=>go("billing")}><Wallet size={15}/> Plan &amp; usage</button>{isAdmin&&<button onClick={()=>go("workspace-settings")}><LayoutGrid size={15}/> Modules &amp; sections</button>}{subscription?.isPlatformAdmin&&<button onClick={()=>go("platform-admin")}><ShieldCheck size={15}/> Platform admin</button>}<button onClick={logout}><LogOut size={15}/> Log out</button></div>}</div></div></header>
   <nav className="module-strip">{stripGroups.map(({group,items})=>{const Icon=group.icon,open=menu===group.key;return <button key={group.key} className={`module-pill ${activeGroup===group.key?"active":""} ${open?"open":""}`} onClick={()=>{setQuick(false);setApps(false);if(items.length===1&&!items[0]!.children?.length)go(items[0]!.path);else setMenu(open?null:group.key!)}}><span><Icon size={17}/></span>{group.label}{(items.length>1||items[0]?.children?.length)&&<ChevronDown size={14}/>}</button>})}</nav>
   {subscription?.status==="suspended"&&<div className="plan-suspended">This organization's Ledgerly subscription is suspended. <button onClick={()=>go("billing")}>View plan &amp; usage</button></div>}
   <main>{children}</main>
  </div>
  <nav className="mobile-dock" aria-label="Mobile navigation">
   <button className={active==="welcome"?"active":""} onClick={()=>go("welcome")}><Home size={19}/><span>Home</span></button>
   <button className={quick?"active":""} onClick={()=>{setQuick(v=>!v);setApps(false);setMenu(null)}}><Plus size={20}/><span>Create</span></button>
   <button className={apps?"active":""} onClick={()=>{setApps(v=>!v);setQuick(false);setMenu(null)}}><LayoutGrid size={19}/><span>Apps</span></button>
   <button onClick={()=>setMobile(true)}><Menu size={19}/><span>Menu</span></button>
  </nav>
  {(quick||selected||apps)&&<button className="floating-panel-scrim" aria-label="Close menu" onClick={()=>{setQuick(false);setMenu(null);setApps(false)}}/>}
  {quick&&<section className="floating-panel quick-panel"><header><div><strong>Create / quick actions</strong><small>Jump straight to common work.</small></div><button onClick={()=>setQuick(false)}><X size={17}/></button></header><div className="quick-action-grid">{quickItems.map(item=>{const Icon=item.icon??Circle;return <button key={item.path} onClick={()=>go(item.path)}><span><Icon size={18}/></span><strong>{item.label}</strong></button>})}</div></section>}
  {selected&&<section className="floating-panel module-menu"><header><div><strong>{selected.group.label}</strong><small>Choose a page in this module</small></div><button onClick={()=>setMenu(null)}><X size={17}/></button></header><div className="module-menu-grid">{selected.items.map(item=><Link key={`${item.path}-${item.label}`} item={item} active={activeItem} onGo={go}/>)}</div></section>}
  {apps&&<section className="floating-panel apps-panel"><header><div><strong>Apps &amp; modules</strong><small>Everything available to you.</small></div><button onClick={()=>setApps(false)}><X size={17}/></button></header><div className="apps-grid">{groups.map(({group,items})=>{const Icon=group.icon;return <button key={group.key} onClick={()=>go(items[0]!.path)}><span><Icon size={18}/></span><strong>{group.label}</strong><small>{items.length} {items.length===1?"page":"pages"}</small></button>})}</div></section>}
 </div>
}

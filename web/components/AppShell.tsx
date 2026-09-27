import{useEffect,useMemo,useState,type ReactNode}from"react";
import{Bell,ChevronDown,ChevronRight,Circle,LayoutGrid,LogOut,Menu,Search,ShieldCheck,Wallet,X}from"lucide-react";
import{get,post,can,type Principal,type Session}from"../api";
import{useAuth}from"../auth";
import{arrangeGroups,useNavigationSettings}from"../navigationSettings";
import{moduleInPlan,sectionInPlan,useSubscription}from"../plans";
import{appGlobalActions,appNavigation}from"../../modules/frontend-registry";
import type{FrontendGlobalAction as GlobalAction,FrontendNavigationGroup as Group,FrontendNavigationItem as Item}from"../../modules/frontend-types";

const allowed=(i:{scope?:string;admin?:boolean},p:Principal|null)=>(!i.scope||can(p,i.scope))&&(!i.admin||!!p&&["owner","admin"].includes(p.role));
const visible=(items:Item[],p:Principal|null):Item[]=>items.filter(i=>allowed(i,p)).map(i=>i.children?{...i,children:visible(i.children,p)}:i);
const flatten=(items:Item[]):Item[]=>items.flatMap(i=>[i,...flatten(i.children??[])]);
const matches=(path:string,itemPath:string)=>path===itemPath||path.startsWith(`${itemPath}/`);
const SECTIONS_KEY="ledgerly.nav.sections";
const readSections=():Record<string,boolean>=>{try{return JSON.parse(localStorage.getItem(SECTIONS_KEY)||"{}")}catch{return{}}};

function NavLink({item,activeItem,depth,onNavigate}:{item:Item;activeItem:string;depth:number;onNavigate:(p:string)=>void}){
 const kids=item.children??[],branchActive=flatten(kids).some(k=>k.path===activeItem),[open,setOpen]=useState(branchActive);
 useEffect(()=>{if(branchActive)setOpen(true)},[branchActive]);
 const Icon=item.icon??(depth?null:Circle),active=item.path===activeItem&&!branchActive;
 if(!kids.length)return <button className={`nav-item depth-${depth} ${active?"active":""}`} onClick={()=>onNavigate(item.path)}>{Icon&&<Icon size={17}/>}<span>{item.label}</span></button>;
 return <div className={`nav-branch ${branchActive?"current":""}`}>
  <button className={`nav-item depth-${depth} ${active?"active":""}`} aria-expanded={open} onClick={()=>{setOpen(!open||!active);onNavigate(item.path)}}>{Icon&&<Icon size={17}/>}<span>{item.label}</span>{open?<ChevronDown className="nav-chevron" size={14}/>:<ChevronRight className="nav-chevron" size={14}/>}</button>
  {open&&<div className="nav-branch-children">{kids.map(k=><NavLink key={`${k.path}-${k.label}`} item={k} activeItem={activeItem} depth={depth+1} onNavigate={onNavigate}/>)}</div>}
 </div>;
}

function NavSection({group,items,activeItem,open,onToggle,onNavigate}:{group:Group;items:Item[];activeItem:string;open:boolean;onToggle:()=>void;onNavigate:(p:string)=>void}){
 const hasActive=flatten(items).some(i=>i.path===activeItem);
 return <section className={`nav-section ${hasActive?"current":""}`}>
  <button className="nav-section-head" aria-expanded={open} onClick={onToggle}><span>{group.label}</span>{open?<ChevronDown size={13}/>:<ChevronRight size={13}/>}</button>
  {open&&<div className="nav-section-items">{items.map(i=><NavLink key={`${i.path}-${i.label}`} item={i} activeItem={activeItem} depth={0} onNavigate={onNavigate}/>)}</div>}
 </section>;
}

type Org={id:string;name:string};
export function AppShell({children,active,onNavigate}:{children:ReactNode;active:string;onNavigate:(p:string)=>void}){
 const[mobile,setMobile]=useState(false),[account,setAccount]=useState(false),[orgs,setOrgs]=useState<Org[]>([]),[switching,setSwitching]=useState(false),[name,setName]=useState("Current user"),[chatUnread,setChatUnread]=useState(0),[sections,setSections]=useState(readSections);
 const{principal,login,logout}=useAuth();
 useEffect(()=>{get<Org[]>("/organizations").then(setOrgs).catch(()=>{});if(can(principal,"admin:read"))get<Array<{userId:string;displayName:string}>>("/admin/memberships").then(x=>setName(x.find(m=>m.userId===principal?.userId)?.displayName||"Current user")).catch(()=>{})},[principal]);
 useEffect(()=>{const load=()=>get<Array<{unread_count?:number}>>("/work/chat/threads").then(x=>setChatUnread(x.reduce((n,t)=>n+Number(t.unread_count||0),0))).catch(()=>{});load();const timer=setInterval(load,15000);return()=>clearInterval(timer)},[principal]);
 async function switchOrg(id:string){if(id===principal?.organizationId)return;setSwitching(true);try{const s=await post<Session>("/organizations/switch",{organizationId:id});localStorage.setItem("finance.activeOrganization",id);login(s,localStorage.getItem("finance.remember")!=="false");location.reload()}finally{setSwitching(false)}}
 const navigate=(p:string)=>{onNavigate(p);setMobile(false)};
 const layout=useNavigationSettings(principal?.organizationId),subscription=useSubscription(principal?.organizationId),isAdmin=!!principal&&["owner","admin"].includes(principal.role);
 // Allowed sections, filtered and ordered by the organization's "Modules & sections" layout.
 const groups=useMemo(()=>layout===undefined||!subscription?[]:arrangeGroups(appNavigation,layout).filter(g=>sectionInPlan(g.key,subscription.plan)).map(g=>({group:g,items:visible(g.items,principal)})).filter(g=>g.items.length),[principal,layout,subscription]);
 // The most specific nav path that prefixes the current hash path is the highlighted item.
 const activeItem=useMemo(()=>groups.flatMap(g=>flatten(g.items)).filter(i=>matches(active,i.path)).sort((a,b)=>b.path.length-a.path.length||Number(!!a.children?.length)-Number(!!b.children?.length))[0]?.path??active,[groups,active]);
 const toggle=(label:string,current:boolean)=>setSections(s=>{const next={...s,[label]:!current};try{localStorage.setItem(SECTIONS_KEY,JSON.stringify(next))}catch{}return next});
 const activeLabel=groups.flatMap(g=>flatten(g.items)).find(i=>i.path===activeItem)?.label;
 return <div className="app-shell">
  {mobile&&<button className="scrim" aria-label="Close navigation" onClick={()=>setMobile(false)}/>}
  <aside className={`sidebar unified-sidebar ${mobile?"sidebar--open":""}`}>
   <div className="brand"><button className="brand-home" onClick={()=>navigate("welcome")}>Ledgerly</button><button className="mobile-close" aria-label="Close navigation" onClick={()=>setMobile(false)}><X size={19}/></button></div>
   {orgs.length>1&&<div className="org-switch"><select aria-label="Active organization" disabled={switching} value={principal?.organizationId||""} onChange={e=>void switchOrg(e.target.value)}>{orgs.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></div>}
   <nav className="nav-list" aria-label="Main navigation">
    {groups.map(({group,items})=>{
     // A module with a single page (e.g. Dashboard) is a plain link; others are collapsible sections, open by default.
     if(items.length===1&&!items[0]!.children?.length)return <NavLink key={group.key} item={{...items[0]!,label:items[0]!.label,icon:items[0]!.icon??group.icon}} activeItem={activeItem} depth={0} onNavigate={navigate}/>;
     const open=sections[group.key??group.label]??true;
     return <NavSection key={group.key} group={group} items={items} activeItem={activeItem} open={open} onToggle={()=>toggle(group.key??group.label,open)} onNavigate={navigate}/>})}
   </nav>
  </aside>
  <div className="workspace">
   <header className="topbar">
    <button className="menu-button" aria-label="Open navigation" onClick={()=>setMobile(true)}><Menu size={20}/></button>
    <label className="global-search"><Search size={17}/><input placeholder={activeLabel?`Search ${activeLabel.toLowerCase()}…`:"Search workspace…"}/></label>
    <div className="topbar__actions">
     {appGlobalActions.filter(a=>allowed(a as GlobalAction,principal)&&!!subscription&&moduleInPlan(a.moduleKey,subscription.plan)).map(action=>{const Action=action.component;return <Action key={action.key} activePath={active}/>})}
     <button className="icon-button app-chat-bell" aria-label={`${chatUnread} unread chat messages`} onClick={()=>navigate("work/chats")}><Bell size={19}/>{chatUnread>0&&<b>{chatUnread>99?"99+":chatUnread}</b>}</button>
     <div className="account-wrap"><button className="profile" onClick={()=>setAccount(!account)}><span><strong>{name}</strong><small>{principal?.role}</small></span></button>{account&&<div className="account-menu"><p><b>{principal?.role}</b><small>{principal?.scopes.length?principal.scopes.join(", "):"Full organization access"}</small></p><button onClick={()=>{setAccount(false);navigate("billing")}}><Wallet size={15}/> Plan &amp; usage</button>{isAdmin&&<button onClick={()=>{setAccount(false);navigate("workspace-settings")}}><LayoutGrid size={15}/> Modules &amp; sections</button>}{subscription?.isPlatformAdmin&&<button onClick={()=>{setAccount(false);navigate("platform-admin")}}><ShieldCheck size={15}/> Platform admin</button>}<button onClick={logout}><LogOut size={15}/> Log out</button></div>}</div>
     <button className="icon-button" aria-label="Log out" title="Log out" onClick={logout}><LogOut size={18}/></button>
    </div>
   </header>
   {subscription?.status==="suspended"&&<div className="plan-suspended">This organization's Ledgerly subscription is suspended. <button onClick={()=>navigate("billing")}>View plan &amp; usage</button></div>}
   <main>{children}</main>
  </div>
 </div>;
}

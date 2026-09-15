import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bot, BookOpen, Brain, Briefcase, Camera, CheckCircle2, ChevronRight, Clock3, Crown,
  FileText, GraduationCap, History, MessageSquare, Play, Search, Send, Settings2,
  ShieldCheck, Sparkles, Users, Wallet, Zap,
} from "lucide-react";
import { authStore, errorText, get, patch, post, uploadFile } from "../../../web/api";

type Agent = {
  key: string;
  name: string;
  title: string;
  description: string;
  modelTier: "luna" | "terra" | "sol";
  enabled: boolean;
  configuredTools: string[];
};
type Conversation = { id: string; agentKey: string; title: string; status: string; lastMessageAt?: string; createdAt?: string };
type ImageAttachment = { id: string; originalName: string; mimeType: string; sizeBytes: number; previewUrl: string };
type Message = { id: string; role: "user" | "assistant"; content: string; model?: string; createdAt?: string; attachments?: ImageAttachment[] };
type Task = { id: string; agentKey: string; title: string; status: string; resultText?: string; errorText?: string; createdAt?: string };
type Approval = { id: string; agentKey: string; actionType: string; requiredScope: string; status: string; payload: Record<string, unknown>; createdAt: string };
type Settings = { provider: string; configured: boolean; models: Record<string, string> };
type Activity = { toolCalls: Array<{ id: string; agentKey: string; toolName: string; status: string; createdAt: string; errorText?: string }>; approvals: Array<{ id: string; agentKey: string; actionType: string; status: string; createdAt: string }> };
type Tab = "employees" | "workspace" | "tasks" | "approvals" | "activity" | "settings";
type Profile = { icon: ReactNode; accent: string; short: string; bestFor: string[]; prompts: string[]; domain: string };

type PendingImage = { file: File; preview: string };

const PROFILES: Record<string, Profile> = {
  secretary: { icon: <Briefcase size={21}/>, accent: "mint", short: "Front office & communications", domain: "Office", bestFor: ["Admissions", "Parents", "Letters", "Communications"], prompts: ["Draft a parent communication for…", "Use this admission information to prepare the student records", "Show me front-office work that needs attention"] },
  dos: { icon: <GraduationCap size={21}/>, accent: "blue", short: "Academic supervision", domain: "Academics", bestFor: ["Lesson plans", "Schemes", "Timetables", "Supervision"], prompts: ["Check lesson-plan compliance this week", "Prepare a lesson plan from the information I give you", "Show teachers who need academic follow-up"] },
  bursar: { icon: <Wallet size={21}/>, accent: "amber", short: "Fees & finance operations", domain: "Finance", bestFor: ["Fees", "Payments", "Banking", "Journals"], prompts: ["Review today's fee collections", "Find students with the largest outstanding balances", "Prepare these payment records for posting"] },
  headteacher: { icon: <Crown size={21}/>, accent: "violet", short: "Executive school coordination", domain: "Management", bestFor: ["Briefings", "Exceptions", "Delegation", "Decisions"], prompts: ["Give me today's executive school brief", "What requires my attention across the school?", "Prepare a management presentation for…"] },
  hr: { icon: <Users size={21}/>, accent: "rose", short: "Staff & people operations", domain: "HR", bestFor: ["Staff", "Leave", "Payroll", "HR documents"], prompts: ["Show staff matters that need follow-up", "Prepare an HR handover brief", "Review approved leave and staffing impact"] },
  librarian: { icon: <BookOpen size={21}/>, accent: "teal", short: "Books & learning inventory", domain: "Books", bestFor: ["Stock", "Issues", "Returns", "Inventory"], prompts: ["Show books that need restocking", "Prepare a writing-book stock report", "Review learner book distributions"] },
};
const FALLBACK_PROFILE: Profile = { icon: <Bot size={21}/>, accent: "slate", short: "Ledgerly AI employee", domain: "General", bestFor: ["School work"], prompts: ["What needs my attention today?"] };

const INTENTS = [
  { label: "Fees & payments", agent: "bursar", icon: <Wallet size={17}/>, prompt: "Help me with fees, payments or finance records" },
  { label: "Lesson plans", agent: "dos", icon: <GraduationCap size={17}/>, prompt: "Help me review or create lesson-plan work" },
  { label: "Staff & leave", agent: "hr", icon: <Users size={17}/>, prompt: "Help me with staff, leave or HR work" },
  { label: "Books & stock", agent: "librarian", icon: <BookOpen size={17}/>, prompt: "Help me with books and stock work" },
  { label: "Parents & office", agent: "secretary", icon: <Briefcase size={17}/>, prompt: "Help me with front-office, parent or student work" },
  { label: "Executive brief", agent: "headteacher", icon: <Crown size={17}/>, prompt: "Give me an executive school briefing" },
];

function ProtectedChatImage({ attachment }: { attachment: ImageAttachment }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let live = true; let objectUrl = "";
    void fetch(attachment.previewUrl, { headers: { Authorization: `Bearer ${authStore.getAccess() || ""}` } })
      .then(response => { if (!response.ok) throw new Error("preview failed"); return response.blob(); })
      .then(blob => { if (!live) return; objectUrl = URL.createObjectURL(blob); setSrc(objectUrl); })
      .catch(() => undefined);
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment.previewUrl]);
  return <div className="ae-chat-image">{src ? <img src={src} alt={attachment.originalName}/> : <span><Camera size={18}/> {attachment.originalName}</span>}</div>;
}

export function AgenticEmployeesPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState("secretary");
  const [tab, setTab] = useState<Tab>("employees");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskInstructions, setTaskInstructions] = useState("");
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("All");

  const agent = useMemo(() => agents.find(item => item.key === selected) || agents[0], [agents, selected]);
  const profile = agent ? (PROFILES[agent.key] || FALLBACK_PROFILE) : FALLBACK_PROFILE;
  const domains = useMemo(() => ["All", ...Array.from(new Set(agents.map(a => (PROFILES[a.key] || FALLBACK_PROFILE).domain)))], [agents]);
  const filteredAgents = useMemo(() => agents.filter(item => {
    const p = PROFILES[item.key] || FALLBACK_PROFILE; const q = search.trim().toLowerCase();
    const domainMatch = domain === "All" || p.domain === domain;
    const haystack = [item.name, item.title, item.description, p.short, ...p.bestFor, ...item.configuredTools].join(" ").toLowerCase();
    return domainMatch && (!q || haystack.includes(q));
  }), [agents, search, domain]);

  async function refresh() {
    try {
      const [nextAgents, nextTasks, nextConversations, pendingApprovals, approvedApprovals, nextSettings] = await Promise.all([
        get<Agent[]>("/agentic-employees/agents"), get<Task[]>("/agentic-employees/tasks"), get<Conversation[]>("/agentic-employees/conversations"),
        get<Approval[]>("/agentic-employees/approvals?status=pending"), get<Approval[]>("/agentic-employees/approvals?status=approved"), get<Settings>("/agentic-employees/settings"),
      ]);
      setAgents(nextAgents); setTasks(nextTasks); setConversations(nextConversations); setApprovals([...pendingApprovals, ...approvedApprovals]); setSettings(nextSettings);
      if (nextAgents.length && !nextAgents.some(item => item.key === selected)) setSelected(nextAgents[0].key);
    } catch (err) { setError(errorText(err)); }
  }
  useEffect(() => { void refresh(); }, []);

  function latestConversation(agentKey: string) { return conversations.filter(item => item.agentKey === agentKey).sort((a, b) => String(b.lastMessageAt || b.createdAt || "").localeCompare(String(a.lastMessageAt || a.createdAt || "")))[0]; }
  function workload(agentKey: string) { const openTasks = tasks.filter(item => item.agentKey === agentKey && !["completed", "failed", "cancelled"].includes(item.status)).length; const waiting = approvals.filter(item => item.agentKey === agentKey && ["pending", "approved"].includes(item.status)).length; return { openTasks, waiting }; }
  async function loadConversation(next: Conversation) {
    setBusy(true); setError(""); setSelected(next.agentKey);
    try { const history = await get<Message[]>(`/agentic-employees/conversations/${next.id}/messages`); setConversation(next); setMessages(history); setTab("workspace"); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function openWorkspace(nextAgent: Agent, forceNew = false, initialText = "") {
    setSelected(nextAgent.key); setError(""); const recent = !forceNew ? latestConversation(nextAgent.key) : undefined;
    if (recent) { if (initialText) setText(initialText); await loadConversation(recent); return; }
    setBusy(true);
    try { const nextConversation = await post<Conversation>("/agentic-employees/conversations", { agentKey: nextAgent.key, title: nextAgent.title }); setConversation(nextConversation); setMessages([]); setText(initialText); setTab("workspace"); setConversations(current => [nextConversation, ...current]); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  function chooseImages(files: FileList | null) {
    if (!files) return; setError("");
    const accepted = Array.from(files).filter(file => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 8 * 1024 * 1024);
    if (accepted.length !== files.length) setError("Chat images must be JPEG, PNG or WebP and no larger than 8 MB each.");
    setPendingImages(current => [...current, ...accepted.map(file => ({ file, preview: URL.createObjectURL(file) }))].slice(0, 4));
  }
  function removePending(index: number) {
    setPendingImages(current => { const target = current[index]; if (target) URL.revokeObjectURL(target.preview); return current.filter((_, i) => i !== index); });
  }
  async function send() {
    if (!conversation || busy || (!text.trim() && !pendingImages.length)) return;
    const content = text.trim(); setBusy(true); setError("");
    try {
      const uploaded: ImageAttachment[] = [];
      for (const image of pendingImages) uploaded.push(await uploadFile<ImageAttachment>(`/agentic-employees/conversations/${conversation.id}/images`, image.file, "agent-chat-image"));
      await post<Message>(`/agentic-employees/conversations/${conversation.id}/messages`, { content, attachmentIds: uploaded.map(item => item.id) });
      const history = await get<Message[]>(`/agentic-employees/conversations/${conversation.id}/messages`);
      for (const image of pendingImages) URL.revokeObjectURL(image.preview);
      setPendingImages([]); setText(""); setMessages(history); await refresh();
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function createTask() {
    if (!agent || !taskTitle.trim() || !taskInstructions.trim()) return; setBusy(true); setError("");
    try { await post("/agentic-employees/tasks", { agentKey: agent.key, title: taskTitle, instructions: taskInstructions }); setTaskTitle(""); setTaskInstructions(""); await refresh(); setTab("tasks"); }
    catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function decide(id: string, decision: "approve" | "reject") { setBusy(true); setError(""); try { await post(`/agentic-employees/approvals/${id}/${decision}`, {}); await refresh(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); } }
  async function execute(id: string) { setBusy(true); setError(""); try { await post(`/agentic-employees/approvals/${id}/execute`, {}); await refresh(); await openActivity(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); } }
  async function setTier(nextAgent: Agent, modelTier: Agent["modelTier"]) { setError(""); try { await patch(`/agentic-employees/agents/${nextAgent.key}`, { modelTier }); await refresh(); } catch (err) { setError(errorText(err)); } }
  async function openActivity() { setTab("activity"); setError(""); try { setActivity(await get<Activity>("/agentic-employees/activity")); } catch (err) { setActivity(null); setError(errorText(err)); } }
  async function launchIntent(intent: typeof INTENTS[number]) { const target = agents.find(item => item.key === intent.agent) || agents.find(item => item.enabled); if (target) await openWorkspace(target, false, intent.prompt); }
  function go(path: string) { location.hash = path; }

  const tabs: Array<[Tab, string, ReactNode]> = [["employees", "Workforce", <Users size={17}/>], ["workspace", "Workspace", <MessageSquare size={17}/>], ["tasks", "Tasks", <Play size={17}/>], ["approvals", "Approvals", <ShieldCheck size={17}/>], ["activity", "Activity", <Clock3 size={17}/>], ["settings", "Settings", <Settings2 size={17}/>]];

  return <div className="ae-page ae-command-center">
    <div className="ae-hero ae-command-hero"><div><span className="ae-kicker"><Sparkles size={13}/> LEDGERLY AI WORKFORCE</span><h1>Your digital school team</h1><p>Choose the right employee by the work you need done. They can see permitted Ledgerly data, remember context, understand images attached directly in chat, prepare documents and execute governed system work.</p></div><div className={`ae-provider ${settings?.configured ? "ok" : "warn"}`}><Bot size={19}/><div><b>{settings?.configured ? "AI workforce online" : "Primary AI key required"}</b><span>{settings?.provider || "provider not configured"}</span></div></div></div>
    {error && <div className="ae-error">{error}</div>}
    <div className="ae-command-stats"><div><span className="ae-stat-icon"><Users size={18}/></span><b>{agents.filter(a => a.enabled).length}</b><small>active employees</small></div><div><span className="ae-stat-icon"><Play size={18}/></span><b>{tasks.filter(t => !["completed", "failed", "cancelled"].includes(t.status)).length}</b><small>open tasks</small></div><div className={approvals.length ? "attention" : ""}><span className="ae-stat-icon"><ShieldCheck size={18}/></span><b>{approvals.length}</b><small>awaiting review</small></div><div><span className="ae-stat-icon"><History size={18}/></span><b>{conversations.length}</b><small>saved conversations</small></div></div>
    <div className="ae-tabs">{tabs.map(([key, label, icon]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => key === "activity" ? void openActivity() : setTab(key)}>{icon}{label}{key === "approvals" && approvals.length > 0 ? <em>{approvals.length}</em> : null}</button>)}</div>

    {tab === "employees" && <div className="ae-workforce-home"><section className="ae-intent-panel"><div className="ae-section-heading"><div><span>START WITH THE JOB</span><h2>What do you want done?</h2></div><p>Ledgerly routes the work to the specialist employee. You can switch employees at any time.</p></div><div className="ae-intent-grid">{INTENTS.map(intent => <button key={intent.label} onClick={() => void launchIntent(intent)}>{intent.icon}<span><b>{intent.label}</b><small>{agents.find(a => a.key === intent.agent)?.name || "AI employee"}</small></span><ChevronRight size={17}/></button>)}</div></section><div className="ae-workforce-toolbar"><label className="ae-search"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find an employee by job, capability or tool…"/></label><div className="ae-domain-filter">{domains.map(item => <button key={item} className={domain === item ? "active" : ""} onClick={() => setDomain(item)}>{item}</button>)}</div></div><div className="ae-advanced-grid">{filteredAgents.map(item => { const p = PROFILES[item.key] || FALLBACK_PROFILE; const work = workload(item.key); const recent = latestConversation(item.key); return <article key={item.key} className={`ae-employee-pro ${selected === item.key ? "selected" : ""} ae-accent-${p.accent}`} onClick={() => setSelected(item.key)}><div className="ae-pro-top"><div className="ae-pro-avatar">{p.icon}<span className={`ae-live-dot ${item.enabled ? "online" : ""}`}/></div><div className="ae-pro-identity"><span>{p.domain}</span><h3>{item.name}</h3><b>{item.title}</b></div><span className={`ae-status ${item.enabled ? "on" : "off"}`}>{item.enabled ? "Ready" : "Off"}</span></div><p className="ae-pro-copy">{p.short}. {item.description}</p><div className="ae-specialties">{p.bestFor.slice(0, 4).map(tag => <span key={tag}>{tag}</span>)}</div><div className="ae-workload"><div><b>{work.openTasks}</b><small>open tasks</small></div><div><b>{work.waiting}</b><small>actions</small></div><div><b>{item.configuredTools.length}</b><small>tools</small></div><div><b>{item.modelTier.toUpperCase()}</b><small>model</small></div></div><div className="ae-pro-footer"><div>{recent ? <><History size={14}/><span>Conversation ready to resume</span></> : <><Zap size={14}/><span>Ready for a new assignment</span></>}</div><div className="ae-pro-actions"><button className="secondary" disabled={!item.enabled || busy} onClick={e => { e.stopPropagation(); setSelected(item.key); setTaskTitle(""); setTaskInstructions(""); document.getElementById("ae-quick-task")?.scrollIntoView({ behavior: "smooth" }); }}>Assign</button><button disabled={!item.enabled || busy} onClick={e => { e.stopPropagation(); void openWorkspace(item); }}>{recent ? "Resume" : "Chat"}<ChevronRight size={15}/></button></div></div></article>; })}</div>{!filteredAgents.length && <div className="ae-empty-card"><Search/><h3>No employee matches that search</h3><p>Try a job such as fees, lesson plans, staff, books or communications.</p></div>}{agent && <div className="ae-employee-focus" id="ae-quick-task"><div className={`ae-focus-profile ae-accent-${profile.accent}`}><div className="ae-pro-avatar">{profile.icon}</div><div><span>SELECTED SPECIALIST</span><h2>{agent.name}</h2><p>{agent.title} · {profile.short}</p></div></div><div className="ae-focus-content"><div className="ae-focus-meta"><div><span>Best for</span><b>{profile.bestFor.join(" · ")}</b></div><div><span>Model</span><select value={agent.modelTier} onChange={e => void setTier(agent, e.target.value as Agent["modelTier"])}><option value="luna">Luna · fast</option><option value="terra">Terra · balanced</option><option value="sol">Sol · strongest</option></select></div></div><h3>Assign work directly</h3><div className="ae-form-row"><input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Task title"/><button className="secondary" onClick={() => void openWorkspace(agent)}>Open conversation</button></div><textarea value={taskInstructions} onChange={e => setTaskInstructions(e.target.value)} placeholder={`Tell ${agent.name} the outcome you need, context to use, and any limits…`}/><button disabled={busy || !taskTitle.trim() || !taskInstructions.trim()} onClick={() => void createTask()}><Play size={16}/> Assign task</button></div></div>}</div>}

    {tab === "workspace" && <div className="ae-cockpit"><aside className="ae-cockpit-sidebar"><div className="ae-side-title"><span>YOUR TEAM</span><button className="icon-button" title="New conversation" disabled={!agent} onClick={() => agent && void openWorkspace(agent, true)}>+</button></div>{agents.map(item => { const p = PROFILES[item.key] || FALLBACK_PROFILE; const work = workload(item.key); return <button key={item.key} className={`ae-agent-row ${item.key === selected ? "active" : ""}`} disabled={!item.enabled} onClick={() => void openWorkspace(item)}><span className={`ae-mini-avatar ae-accent-${p.accent}`}>{p.icon}</span><span><b>{item.name}</b><small>{item.title}</small></span>{work.waiting > 0 && <em>{work.waiting}</em>}</button>; })}<div className="ae-thread-list"><span>RECENT THREADS</span>{conversations.slice(0, 8).map(item => <button key={item.id} className={conversation?.id === item.id ? "active" : ""} onClick={() => void loadConversation(item)}><MessageSquare size={14}/><span><b>{item.title}</b><small>{item.agentKey} · {formatWhen(item.lastMessageAt || item.createdAt)}</small></span></button>)}</div></aside><section className="ae-cockpit-main"><header className="ae-cockpit-head"><div className={`ae-cockpit-agent ae-accent-${profile.accent}`}><div className="ae-pro-avatar">{profile.icon}</div><div><span>{profile.domain.toUpperCase()} SPECIALIST</span><h2>{agent?.name || "AI Workspace"}</h2><p>{agent?.title} · {agent?.modelTier.toUpperCase()} · {agent?.configuredTools.length || 0} permitted tools</p></div></div><div className="ae-head-actions"><button className="secondary" onClick={() => go("agentic-employees-vision")}><Camera size={16}/> Vision workspace</button><button className="secondary" onClick={() => go("agentic-employees-memory")}><Brain size={16}/> Memory</button><button className="secondary" onClick={() => go("agentic-employees-documents")}><FileText size={16}/> Files</button><button className={approvals.length ? "attention-button" : "secondary"} onClick={() => go("agentic-employees-actions")}><ShieldCheck size={16}/> Actions{approvals.length ? <em>{approvals.length}</em> : null}</button></div></header><div className="ae-context-strip"><div><ShieldCheck size={15}/><span>Role-scoped Ledgerly access</span></div><div><Brain size={15}/><span>Primary AI + always-on Workers AI</span></div><div><Camera size={15}/><span>Images go directly to chat AI, not Scannerly</span></div></div><div className="ae-chat ae-chat-pro">{!conversation && <div className="ae-empty"><MessageSquare/><h3>Choose an employee to start</h3><p>Your conversations are saved and can be resumed later.</p></div>}{conversation && !messages.length && <div className="ae-chat-welcome"><div className={`ae-welcome-icon ae-accent-${profile.accent}`}>{profile.icon}</div><h3>What should {agent?.name} do?</h3><p>{profile.short}. Type naturally or attach up to four JPEG, PNG or WebP images.</p><div className="ae-starter-grid">{profile.prompts.map(prompt => <button key={prompt} onClick={() => setText(prompt)}>{prompt}<ChevronRight size={14}/></button>)}</div></div>}{messages.map(message => <div key={message.id} className={`ae-message ${message.role}`}><div className="ae-message-label"><b>{message.role === "user" ? "You" : agent?.name}</b>{message.createdAt && <span>{formatWhen(message.createdAt)}</span>}</div>{message.attachments?.length ? <div className="ae-message-images">{message.attachments.map(attachment => <ProtectedChatImage key={attachment.id} attachment={attachment}/>)}</div> : null}{message.content && <p>{message.content}</p>}{message.model && <small>{message.model}</small>}</div>)}{busy && <div className="ae-message assistant ae-working"><b>{agent?.name}</b><p><Sparkles size={14}/> Working with Ledgerly and AI…</p></div>}</div>{conversation && <><input id="ae-chat-image-input" className="ae-hidden-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => { chooseImages(e.target.files); e.currentTarget.value = ""; }}/><div className="ae-quick-tools"><label htmlFor="ae-chat-image-input" className="ae-chat-attach"><Camera size={15}/> Attach image</label><button onClick={() => setText(`Create a ${agent?.key === "bursar" ? "spreadsheet" : "document"} for `)}><FileText size={15}/> Create document</button><button onClick={() => setText("What do you remember about ")}><Brain size={15}/> Ask memory</button><button onClick={() => go("agentic-employees-actions")}><ShieldCheck size={15}/> Review actions</button></div>{pendingImages.length > 0 && <div className="ae-pending-images">{pendingImages.map((image, index) => <div key={`${image.file.name}-${index}`}><img src={image.preview} alt={image.file.name}/><button type="button" onClick={() => removePending(index)}>×</button><small>{image.file.name}</small></div>)}</div>}<footer className="ae-composer-pro"><label htmlFor="ae-chat-image-input" className="ae-composer-camera" title="Attach image"><Camera size={18}/></label><textarea value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder={`Message ${agent?.name || "this employee"}… attach an image if useful.`}/><button disabled={busy || (!text.trim() && !pendingImages.length)} onClick={() => void send()}><Send size={17}/> Send</button></footer></>}</section></div>}

    {tab === "tasks" && <div className="ae-panel"><div className="ae-section-heading"><div><span>WORK QUEUE</span><h2>Agent tasks</h2></div><p>Track assignments across your AI workforce.</p></div><div className="ae-list">{tasks.map(task => <div key={task.id}><span className={`ae-dot ${task.status}`}/><div><b>{task.title}</b><small>{agents.find(a => a.key === task.agentKey)?.name || task.agentKey} · {task.status} · {formatWhen(task.createdAt)}</small>{task.resultText && <p>{task.resultText}</p>}{task.errorText && <p className="bad">{task.errorText}</p>}</div></div>)}{!tasks.length && <p>No tasks yet.</p>}</div></div>}
    {tab === "approvals" && <div className="ae-panel"><div className="ae-section-heading"><div><span>HUMAN CONTROL</span><h2>Approval & execution queue</h2></div><p>Review exactly what an employee wants Ledgerly to change before execution.</p></div><div className="ae-list">{approvals.map(approval => <div key={approval.id}><ShieldCheck/><div><b>{friendly(approval.actionType)}</b><small>{agents.find(a => a.key === approval.agentKey)?.name || approval.agentKey} · {approval.status} · requires {approval.requiredScope}</small><pre>{JSON.stringify(approval.payload, null, 2)}</pre><div className="ae-actions">{approval.status === "pending" && <><button disabled={busy} onClick={() => void decide(approval.id, "approve")}><CheckCircle2 size={15}/> Approve</button><button className="secondary" disabled={busy} onClick={() => void decide(approval.id, "reject")}>Reject</button></>}{approval.status === "approved" && <button disabled={busy} onClick={() => void execute(approval.id)}><Send size={15}/> Execute approved action</button>}</div></div></div>)}{!approvals.length && <div className="ae-empty-card"><ShieldCheck/><h3>Queue is clear</h3><p>No sensitive AI actions are waiting for review.</p></div>}</div></div>}
    {tab === "activity" && <div className="ae-panel"><h2>Audit & tool activity</h2><div className="ae-list">{activity?.toolCalls.map(call => <div key={call.id}><Clock3/><div><b>{call.toolName}</b><small>{call.agentKey} · {call.status} · {call.createdAt}</small>{call.errorText && <p className="bad">{call.errorText}</p>}</div></div>)}{activity && !activity.toolCalls.length && <p>No tool calls yet.</p>}{!activity && <p>Activity requires school write/admin permission.</p>}</div></div>}
    {tab === "settings" && <div className="ae-panel"><h2>AI providers</h2><div className="ae-settings"><div><span>Primary provider</span><b>{settings?.provider}</b></div><div><span>Luna</span><b>{settings?.models?.luna}</b></div><div><span>Terra</span><b>{settings?.models?.terra}</b></div><div><span>Sol</span><b>{settings?.models?.sol}</b></div></div><p>OpenAI, Gemini or Anthropic Claude may be the primary provider. Cloudflare Workers AI is configured separately as the always-on secondary partner. Employee authority still comes from Ledgerly roles/scopes and governed Action Center execution.</p></div>}
  </div>;
}

function formatWhen(value?: string) {
  if (!value) return "recent"; const date = new Date(value); if (Number.isNaN(date.getTime())) return value; const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "now"; if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`; if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`; return date.toLocaleDateString();
}
function friendly(value: string) { return value.replace(/[._-]+/g, " ").replace(/\b\w/g, x => x.toUpperCase()); }

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, CheckCircle2, Clock3, MessageSquare, Play, Settings2, ShieldCheck, Users } from "lucide-react";
import { errorText, get, patch, post } from "../../../web/api";

type Agent = {
  key: string;
  name: string;
  title: string;
  description: string;
  modelTier: "luna" | "terra" | "sol";
  enabled: boolean;
  configuredTools: string[];
};
type Conversation = { id: string; agentKey: string; title: string; status: string };
type Message = { id: string; role: "user" | "assistant"; content: string; model?: string; createdAt?: string };
type Task = { id: string; agentKey: string; title: string; status: string; resultText?: string; errorText?: string };
type Approval = { id: string; agentKey: string; actionType: string; requiredScope: string; status: string; payload: Record<string, unknown>; createdAt: string };
type Settings = { provider: string; configured: boolean; models: Record<string, string> };
type Activity = { toolCalls: Array<{ id: string; agentKey: string; toolName: string; status: string; createdAt: string; errorText?: string }>; approvals: Array<{ id: string; agentKey: string; actionType: string; status: string; createdAt: string }> };
type Tab = "employees" | "workspace" | "tasks" | "approvals" | "activity" | "settings";

export function AgenticEmployeesPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState("secretary");
  const [tab, setTab] = useState<Tab>("employees");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskInstructions, setTaskInstructions] = useState("");

  const agent = useMemo(() => agents.find(item => item.key === selected) || agents[0], [agents, selected]);

  async function refresh() {
    try {
      const [nextAgents, nextTasks, nextApprovals, nextSettings] = await Promise.all([
        get<Agent[]>("/agentic-employees/agents"),
        get<Task[]>("/agentic-employees/tasks"),
        get<Approval[]>("/agentic-employees/approvals"),
        get<Settings>("/agentic-employees/settings"),
      ]);
      setAgents(nextAgents);
      setTasks(nextTasks);
      setApprovals(nextApprovals);
      setSettings(nextSettings);
      if (nextAgents.length && !nextAgents.some(item => item.key === selected)) setSelected(nextAgents[0].key);
    } catch (err) {
      setError(errorText(err));
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function openWorkspace(nextAgent: Agent) {
    setSelected(nextAgent.key);
    setError("");
    setBusy(true);
    try {
      const nextConversation = await post<Conversation>("/agentic-employees/conversations", { agentKey: nextAgent.key, title: nextAgent.title });
      setConversation(nextConversation);
      setMessages([]);
      setTab("workspace");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!conversation || !text.trim() || busy) return;
    const content = text.trim();
    setText("");
    setMessages(current => [...current, { id: `local-${Date.now()}`, role: "user", content }]);
    setBusy(true);
    setError("");
    try {
      const message = await post<Message>(`/agentic-employees/conversations/${conversation.id}/messages`, { content });
      setMessages(current => [...current, message]);
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function createTask() {
    if (!agent || !taskTitle.trim() || !taskInstructions.trim()) return;
    setBusy(true);
    setError("");
    try {
      await post("/agentic-employees/tasks", { agentKey: agent.key, title: taskTitle, instructions: taskInstructions });
      setTaskTitle("");
      setTaskInstructions("");
      await refresh();
      setTab("tasks");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(true);
    setError("");
    try {
      await post(`/agentic-employees/approvals/${id}/${decision}`, {});
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function setTier(nextAgent: Agent, modelTier: Agent["modelTier"]) {
    setError("");
    try {
      await patch(`/agentic-employees/agents/${nextAgent.key}`, { modelTier });
      await refresh();
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function openActivity() {
    setTab("activity");
    setError("");
    try {
      setActivity(await get<Activity>("/agentic-employees/activity"));
    } catch (err) {
      setActivity(null);
      setError(errorText(err));
    }
  }

  const tabs: Array<[Tab, string, ReactNode]> = [
    ["employees", "Employees", <Users size={17} />],
    ["workspace", "Workspace", <MessageSquare size={17} />],
    ["tasks", "Tasks", <Play size={17} />],
    ["approvals", "Approvals", <ShieldCheck size={17} />],
    ["activity", "Activity", <Clock3 size={17} />],
    ["settings", "Settings", <Settings2 size={17} />],
  ];

  return <div className="ae-page">
    <div className="ae-hero">
      <div>
        <span className="ae-kicker">LEDGERLY AI WORKFORCE</span>
        <h1>Agentic Employees</h1>
        <p>School employees that reason with Ledgerly data, use restricted tools, and stop for human approval before sensitive actions.</p>
      </div>
      <div className={`ae-provider ${settings?.configured ? "ok" : "warn"}`}>
        <Bot size={19} />
        <div><b>{settings?.configured ? "OpenAI connected" : "OpenAI key required"}</b><span>{settings?.provider || "openai-responses"}</span></div>
      </div>
    </div>

    {error && <div className="ae-error">{error}</div>}

    <div className="ae-tabs">
      {tabs.map(([key, label, icon]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => key === "activity" ? void openActivity() : setTab(key)}>
        {icon}{label}{key === "approvals" && approvals.length > 0 ? <em>{approvals.length}</em> : null}
      </button>)}
    </div>

    {tab === "employees" && <>
      <div className="ae-grid">
        {agents.map(item => <article key={item.key} className={`ae-card ${selected === item.key ? "selected" : ""}`} onClick={() => setSelected(item.key)}>
          <div className="ae-avatar"><Bot /></div>
          <div className="ae-card-top"><div><h3>{item.name}</h3><b>{item.title}</b></div><span className={`ae-status ${item.enabled ? "on" : "off"}`}>{item.enabled ? "Active" : "Disabled"}</span></div>
          <p>{item.description}</p>
          <div className="ae-tags"><span>{item.modelTier.toUpperCase()}</span><span>{item.configuredTools.length} tools</span></div>
          <button disabled={!item.enabled || busy} onClick={event => { event.stopPropagation(); void openWorkspace(item); }}>Open workspace</button>
        </article>)}
      </div>
      {agent && <div className="ae-panel">
        <h2>Create a task for {agent.title}</h2>
        <div className="ae-form-row">
          <input value={taskTitle} onChange={event => setTaskTitle(event.target.value)} placeholder="Task title" />
          <select value={agent.modelTier} onChange={event => void setTier(agent, event.target.value as Agent["modelTier"])}>
            <option value="luna">Luna · fast / low cost</option><option value="terra">Terra · balanced</option><option value="sol">Sol · strongest</option>
          </select>
        </div>
        <textarea value={taskInstructions} onChange={event => setTaskInstructions(event.target.value)} placeholder="Describe the work this employee should complete…" />
        <button disabled={busy} onClick={() => void createTask()}><Play size={16} /> Run task</button>
      </div>}
    </>}

    {tab === "workspace" && <div className="ae-workspace">
      <aside>{agents.map(item => <button key={item.key} className={item.key === selected ? "active" : ""} onClick={() => void openWorkspace(item)}><Bot size={18} /><span><b>{item.name}</b><small>{item.title}</small></span></button>)}</aside>
      <section>
        <header><div><h2>{agent?.title || "AI Workspace"}</h2><span>{agent?.configuredTools.join(" · ")}</span></div>{conversation && <small>{conversation.id}</small>}</header>
        <div className="ae-chat">
          {!messages.length && <div className="ae-empty"><MessageSquare /><h3>Start working with {agent?.name}</h3><p>Ask for school information or give a task. Ledgerly tool calls are tenant-filtered and logged.</p></div>}
          {messages.map(message => <div key={message.id} className={`ae-message ${message.role}`}><b>{message.role === "user" ? "You" : agent?.name}</b><p>{message.content}</p>{message.model && <small>{message.model}</small>}</div>)}
          {busy && <div className="ae-message assistant"><b>{agent?.name}</b><p>Working…</p></div>}
        </div>
        <footer><textarea value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask the AI employee to do something…" /><button disabled={!conversation || busy || !text.trim()} onClick={() => void send()}>Send</button></footer>
      </section>
    </div>}

    {tab === "tasks" && <div className="ae-panel"><h2>Agent tasks</h2><div className="ae-list">
      {tasks.map(task => <div key={task.id}><span className={`ae-dot ${task.status}`} /><div><b>{task.title}</b><small>{task.agentKey} · {task.status}</small>{task.resultText && <p>{task.resultText}</p>}{task.errorText && <p className="bad">{task.errorText}</p>}</div></div>)}
      {!tasks.length && <p>No tasks yet.</p>}
    </div></div>}

    {tab === "approvals" && <div className="ae-panel"><h2>Human approval queue</h2><p>Sensitive actions stop here. Approval checks the reviewer's Ledgerly permissions and does not itself claim the action was sent or executed.</p><div className="ae-list">
      {approvals.map(approval => <div key={approval.id}><ShieldCheck /><div><b>{approval.actionType}</b><small>{approval.agentKey} · requires {approval.requiredScope}</small><pre>{JSON.stringify(approval.payload, null, 2)}</pre><div className="ae-actions"><button disabled={busy} onClick={() => void decide(approval.id, "approve")}><CheckCircle2 size={15} />Approve</button><button className="secondary" disabled={busy} onClick={() => void decide(approval.id, "reject")}>Reject</button></div></div></div>)}
      {!approvals.length && <p>No approvals waiting.</p>}
    </div></div>}

    {tab === "activity" && <div className="ae-panel"><h2>Audit & tool activity</h2><div className="ae-list">
      {activity?.toolCalls.map(call => <div key={call.id}><Clock3 /><div><b>{call.toolName}</b><small>{call.agentKey} · {call.status} · {call.createdAt}</small>{call.errorText && <p className="bad">{call.errorText}</p>}</div></div>)}
      {activity && !activity.toolCalls.length && <p>No tool calls yet.</p>}
      {!activity && <p>Activity requires school write/admin permission.</p>}
    </div></div>}

    {tab === "settings" && <div className="ae-panel"><h2>AI provider</h2><div className="ae-settings">
      <div><span>Provider</span><b>{settings?.provider}</b></div><div><span>Luna</span><b>{settings?.models?.luna}</b></div><div><span>Terra</span><b>{settings?.models?.terra}</b></div><div><span>Sol</span><b>{settings?.models?.sol}</b></div>
    </div><p>Set <code>OPENAI_API_KEY</code> on the backend server. Optional overrides: <code>OPENAI_MODEL_LUNA</code>, <code>OPENAI_MODEL_TERRA</code>, <code>OPENAI_MODEL_SOL</code> and <code>OPENAI_BASE_URL</code>. Secrets are never stored in school settings.</p></div>}
  </div>;
}

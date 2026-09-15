import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Cloud, KeyRound, RefreshCw, Save, ShieldCheck, Sparkles, TestTube2 } from "lucide-react";
import { errorText, get, patch, post } from "../../../web/api";
import "./provider-configuration.css";

type ProviderId = "openai" | "google" | "anthropic";
type Tier = "luna" | "terra" | "sol";
type ProviderModel = { id: string; label: string; tier: string };
type ProviderCatalogItem = { id: ProviderId; label: string; description: string; models: ProviderModel[]; defaults: Record<Tier, string> };
type Catalog = { providers: ProviderCatalogItem[] };
type Settings = {
  provider: ProviderId;
  source: "school" | "environment-default";
  configured: boolean;
  apiKeyConfigured: boolean;
  apiKeyHint: string | null;
  models: Record<Tier, string>;
  config: { temperature: number | null; topP: number | null; maxOutputTokens: number; timeoutMs: number; reasoningEffort: "default" | "low" | "medium" | "high" | "max" };
  updatedAt: string | null;
};
type WorkersSettings = {
  configured: boolean;
  accountId: string;
  apiTokenConfigured: boolean;
  apiTokenHint: string | null;
  model: string;
  visionCapable: boolean;
  maxOutputTokens: number;
  timeoutMs: number;
  alwaysOn: true;
  updatedAt: string | null;
};
type FormState = {
  provider: ProviderId;
  models: Record<Tier, string>;
  apiKey: string;
  clearApiKey: boolean;
  temperature: string;
  topP: string;
  maxOutputTokens: number;
  timeoutMs: number;
  reasoningEffort: Settings["config"]["reasoningEffort"];
};
type WorkersForm = { accountId: string; apiToken: string; model: string; maxOutputTokens: number; timeoutMs: number };

const providerTone: Record<ProviderId, string> = { openai: "OpenAI", google: "Gemini", anthropic: "Anthropic Claude" };
const tierCopy: Record<Tier, { title: string; description: string }> = {
  luna: { title: "Luna · Fast", description: "Routine, high-volume employee work" },
  terra: { title: "Terra · Balanced", description: "Planning, analysis and daily operations" },
  sol: { title: "Sol · Advanced", description: "Complex reasoning and high-value work" },
};
function toForm(settings: Settings): FormState { return { provider: settings.provider, models: { ...settings.models }, apiKey: "", clearApiKey: false, temperature: settings.config.temperature === null ? "" : String(settings.config.temperature), topP: settings.config.topP === null ? "" : String(settings.config.topP), maxOutputTokens: settings.config.maxOutputTokens, timeoutMs: settings.config.timeoutMs, reasoningEffort: settings.config.reasoningEffort }; }
function toWorkersForm(settings: WorkersSettings): WorkersForm { return { accountId: settings.accountId || "", apiToken: "", model: settings.model || "@cf/google/gemma-4-26b-a4b-it", maxOutputTokens: settings.maxOutputTokens || 768, timeoutMs: settings.timeoutMs || 30000 }; }

export function ProviderConfigurationPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [workers, setWorkers] = useState<WorkersSettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [workersForm, setWorkersForm] = useState<WorkersForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingWorkers, setSavingWorkers] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingWorkers, setTestingWorkers] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [testResult, setTestResult] = useState<{ provider: string; model: string; latencyMs: number } | null>(null);
  const [workersTest, setWorkersTest] = useState<{ model: string; latencyMs: number } | null>(null);

  async function load() {
    setLoading(true); setError("");
    try {
      const [catalogData, settingsData, workersData] = await Promise.all([
        get<Catalog>("/agentic-employees/provider-catalog"),
        get<Settings>("/agentic-employees/provider-settings"),
        get<WorkersSettings>("/agentic-employees/workers-ai-settings"),
      ]);
      setCatalog(catalogData); setSettings(settingsData); setForm(toForm(settingsData));
      setWorkers(workersData); setWorkersForm(toWorkersForm(workersData));
    } catch (err) { setError(errorText(err)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const selectedProvider = useMemo(() => catalog?.providers.find(item => item.id === form?.provider) || null, [catalog, form?.provider]);
  function chooseProvider(provider: ProviderCatalogItem) { setForm(current => current ? { ...current, provider: provider.id, models: { ...provider.defaults }, apiKey: "", clearApiKey: false } : current); setSuccess(""); setTestResult(null); }
  function setModel(tier: Tier, value: string) { setForm(current => current ? { ...current, models: { ...current.models, [tier]: value } } : current); }

  async function save() {
    if (!form) return; setSaving(true); setError(""); setSuccess(""); setTestResult(null);
    try {
      const data = await patch<Settings>("/agentic-employees/provider-settings", { provider: form.provider, models: form.models, apiKey: form.apiKey.trim() || undefined, clearApiKey: form.clearApiKey, config: { temperature: form.temperature === "" ? null : Number(form.temperature), topP: form.topP === "" ? null : Number(form.topP), maxOutputTokens: Number(form.maxOutputTokens), timeoutMs: Number(form.timeoutMs), reasoningEffort: form.reasoningEffort } });
      setSettings(data); setForm(toForm(data)); setSuccess(`${providerTone[data.provider]} is now this school's primary AI provider.`);
    } catch (err) { setError(errorText(err)); } finally { setSaving(false); }
  }
  async function testConnection() {
    setTesting(true); setError(""); setSuccess(""); setTestResult(null);
    try { const result = await post<{ ok: boolean; provider: string; model: string; latencyMs: number }>("/agentic-employees/provider-settings/test", { tier: "luna" }); setTestResult(result); setSuccess(`Primary provider connection successful using ${result.model}.`); }
    catch (err) { setError(errorText(err)); } finally { setTesting(false); }
  }
  async function saveWorkers() {
    if (!workersForm) return; setSavingWorkers(true); setError(""); setSuccess(""); setWorkersTest(null);
    try {
      const data = await patch<WorkersSettings>("/agentic-employees/workers-ai-settings", { accountId: workersForm.accountId.trim(), apiToken: workersForm.apiToken.trim() || undefined, model: workersForm.model.trim(), maxOutputTokens: Number(workersForm.maxOutputTokens), timeoutMs: Number(workersForm.timeoutMs) });
      setWorkers(data); setWorkersForm(toWorkersForm(data)); setSuccess("Cloudflare Workers AI saved. It now participates automatically beside every AI employee run for this school.");
    } catch (err) { setError(errorText(err)); } finally { setSavingWorkers(false); }
  }
  async function testWorkersConnection() {
    setTestingWorkers(true); setError(""); setSuccess(""); setWorkersTest(null);
    try { const result = await post<{ ok: boolean; model: string; latencyMs: number }>("/agentic-employees/workers-ai-settings/test", {}); setWorkersTest(result); setSuccess(`Workers AI connection successful using ${result.model}.`); }
    catch (err) { setError(errorText(err)); } finally { setTestingWorkers(false); }
  }

  if (loading) return <div className="aipc-state"><RefreshCw className="aipc-spin" size={20}/> Loading AI provider configuration…</div>;
  if (!catalog || !settings || !form || !workers || !workersForm) return <div className="aipc-state aipc-error">{error || "AI provider configuration could not be loaded."}</div>;

  return <div className="aipc-page">
    <header className="aipc-hero"><div><div className="aipc-kicker"><Sparkles size={16}/> AI Workforce · School Configuration</div><h1>AI Provider Configuration</h1><p>Choose the school's primary AI — OpenAI, Google Gemini or Anthropic Claude — then configure Cloudflare Workers AI as the always-on secondary reasoning partner.</p></div><div className={`aipc-status ${settings.configured ? "is-ready" : ""}`}>{settings.configured ? <CheckCircle2 size={18}/> : <KeyRound size={18}/>} {settings.configured ? `${providerTone[settings.provider]} primary ready` : "Primary API key required"}</div></header>
    {error && <div className="aipc-alert aipc-alert-error">{error}</div>}{success && <div className="aipc-alert aipc-alert-success"><CheckCircle2 size={18}/>{success}</div>}

    <section className="aipc-panel"><div className="aipc-section-heading"><div><span>1</span><h2>Primary AI company</h2></div><p>One primary provider is active per school. Anthropic Claude is a full primary option, not a fallback.</p></div><div className="aipc-provider-grid">{catalog.providers.map(provider => <button key={provider.id} type="button" className={`aipc-provider-card ${form.provider === provider.id ? "is-selected" : ""}`} onClick={() => chooseProvider(provider)}><div className="aipc-provider-icon"><Bot size={22}/></div><div><strong>{provider.label}</strong><p>{provider.description}</p><small>{provider.models.length} listed models · custom model IDs also allowed</small></div><div className="aipc-radio">{form.provider === provider.id && <span/>}</div></button>)}</div></section>

    <section className="aipc-panel"><div className="aipc-section-heading"><div><span>2</span><h2>Primary provider credential</h2></div><p>The school's key is encrypted before storage and is never returned after saving.</p></div><div className="aipc-credential-grid"><label className="aipc-field aipc-wide"><span>{selectedProvider?.label} API key</span><input type="password" autoComplete="new-password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value, clearApiKey: false })} placeholder={settings.apiKeyConfigured ? `Saved: ${settings.apiKeyHint || "credential configured"} — leave blank to keep it` : "Paste this school's API key"}/><small>Leave blank to keep the saved key.</small></label><div className="aipc-secret-summary"><ShieldCheck size={22}/><div><strong>{settings.apiKeyConfigured ? "Credential protected" : "No primary credential yet"}</strong><span>{settings.apiKeyHint || "Add the API key supplied by the selected provider."}</span></div></div></div>{settings.apiKeyConfigured && <label className="aipc-check"><input type="checkbox" checked={form.clearApiKey} onChange={e => setForm({ ...form, clearApiKey: e.target.checked, apiKey: e.target.checked ? "" : form.apiKey })}/> Remove the stored primary API key when I save</label>}</section>

    <section className="aipc-panel"><div className="aipc-section-heading"><div><span>3</span><h2>Primary model routing</h2></div><p>Map Luna, Terra and Sol employee tiers to models from the selected primary provider.</p></div><div className="aipc-model-grid">{(["luna", "terra", "sol"] as Tier[]).map(tier => <label className="aipc-model-card" key={tier}><div><strong>{tierCopy[tier].title}</strong><span>{tierCopy[tier].description}</span></div><input list={`aipc-models-${form.provider}`} value={form.models[tier]} onChange={e => setModel(tier, e.target.value)} placeholder="Model ID"/></label>)}</div><datalist id={`aipc-models-${form.provider}`}>{selectedProvider?.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</datalist><div className="aipc-model-list"><strong>Available {selectedProvider?.label} models</strong><div>{selectedProvider?.models.map(model => <button type="button" key={model.id} onClick={() => setModel(model.tier === "luna" || model.tier === "terra" || model.tier === "sol" ? model.tier : "terra", model.id)}>{model.label}<code>{model.id}</code></button>)}</div></div></section>

    <section className="aipc-panel"><div className="aipc-section-heading"><div><span>4</span><h2>Primary advanced controls</h2></div><p>Tune output behavior, cost ceiling and timeout for the primary provider.</p></div><div className="aipc-form-grid"><label className="aipc-field"><span>Temperature</span><input type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={e => setForm({ ...form, temperature: e.target.value })} placeholder="Provider default"/></label><label className="aipc-field"><span>Top P</span><input type="number" min="0" max="1" step="0.05" value={form.topP} onChange={e => setForm({ ...form, topP: e.target.value })} placeholder="Provider default"/></label><label className="aipc-field"><span>Maximum output tokens</span><input type="number" min="128" max="65536" step="128" value={form.maxOutputTokens} onChange={e => setForm({ ...form, maxOutputTokens: Number(e.target.value) })}/></label><label className="aipc-field"><span>Request timeout (ms)</span><input type="number" min="5000" max="120000" step="1000" value={form.timeoutMs} onChange={e => setForm({ ...form, timeoutMs: Number(e.target.value) })}/></label><label className="aipc-field"><span>Reasoning effort</span><select value={form.reasoningEffort} onChange={e => setForm({ ...form, reasoningEffort: e.target.value as FormState["reasoningEffort"] })}><option value="default">Automatic by tier</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="max">Maximum</option></select></label></div></section>

    <section className="aipc-panel"><div className="aipc-section-heading"><div><span>5</span><h2>Cloudflare Workers AI · always-on secondary</h2></div><p>Once configured, Workers AI runs automatically beside Amina, Daniel, Grace, Mirembe, Sarah and Peter. It advises and cross-checks; the selected primary provider remains the tool-calling orchestrator.</p></div><div className="aipc-credential-grid"><label className="aipc-field"><span>Cloudflare Account ID</span><input value={workersForm.accountId} onChange={e => setWorkersForm({ ...workersForm, accountId: e.target.value })} placeholder="Cloudflare Account ID"/></label><label className="aipc-field"><span>Workers AI API token</span><input type="password" autoComplete="new-password" value={workersForm.apiToken} onChange={e => setWorkersForm({ ...workersForm, apiToken: e.target.value })} placeholder={workers.apiTokenConfigured ? `Saved: ${workers.apiTokenHint || "token configured"} — leave blank to keep it` : "Token with Workers AI permission"}/></label><div className="aipc-secret-summary"><Cloud size={22}/><div><strong>{workers.configured ? "Workers AI active" : "Workers AI setup required"}</strong><span>{workers.configured ? "Always-on collaboration is configured for this school." : "Save Account ID and an API token to activate the sidecar."}</span></div></div></div><div className="aipc-form-grid"><label className="aipc-field aipc-wide"><span>Workers AI model</span><input value={workersForm.model} onChange={e => setWorkersForm({ ...workersForm, model: e.target.value })}/><small>Default: @cf/google/gemma-4-26b-a4b-it. The default supports vision; if you use a custom model, choose a vision-capable model for image chats.</small></label><label className="aipc-field"><span>Maximum output tokens</span><input type="number" min="128" max="4096" step="128" value={workersForm.maxOutputTokens} onChange={e => setWorkersForm({ ...workersForm, maxOutputTokens: Number(e.target.value) })}/></label><label className="aipc-field"><span>Timeout (ms)</span><input type="number" min="5000" max="120000" step="1000" value={workersForm.timeoutMs} onChange={e => setWorkersForm({ ...workersForm, timeoutMs: Number(e.target.value) })}/></label></div><div className="aipc-actions"><div><strong>Always on: yes</strong><span>{workers.visionCapable ? "Configured model is recognized as vision-capable." : "Configured model is not in Ledgerly's known vision-capable Workers AI list."}</span></div><button className="aipc-secondary" type="button" disabled={!workers.configured || testingWorkers || savingWorkers} onClick={() => void testWorkersConnection()}>{testingWorkers ? <RefreshCw className="aipc-spin" size={17}/> : <TestTube2 size={17}/>} Test Workers AI</button><button className="aipc-primary" type="button" disabled={savingWorkers || testingWorkers || !workersForm.accountId.trim()} onClick={() => void saveWorkers()}>{savingWorkers ? <RefreshCw className="aipc-spin" size={17}/> : <Save size={17}/>} Save Workers AI</button></div>{workersTest && <div className="aipc-test-result"><CheckCircle2 size={18}/><div><strong>Workers AI verified</strong><span>{workersTest.model} · {workersTest.latencyMs} ms</span></div></div>}</section>

    <footer className="aipc-actions"><div><strong>Primary provider · this school only</strong><span>{settings.updatedAt ? `Last saved ${new Date(settings.updatedAt).toLocaleString()}` : "Using server defaults until this school saves configuration."}</span></div><button className="aipc-secondary" type="button" onClick={() => void testConnection()} disabled={testing || saving || !settings.configured}>{testing ? <RefreshCw className="aipc-spin" size={17}/> : <TestTube2 size={17}/>} {testing ? "Testing…" : "Test primary"}</button><button className="aipc-primary" type="button" onClick={() => void save()} disabled={saving || testing}>{saving ? <RefreshCw className="aipc-spin" size={17}/> : <Save size={17}/>} {saving ? "Saving…" : "Save primary provider"}</button></footer>
    {testResult && <div className="aipc-test-result"><CheckCircle2 size={18}/><div><strong>Primary connection verified</strong><span>{testResult.provider} · {testResult.model} · {testResult.latencyMs} ms</span></div></div>}
  </div>;
}

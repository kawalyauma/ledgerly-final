import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, KeyRound, RefreshCw, Save, ShieldCheck, Sparkles, TestTube2 } from "lucide-react";
import { errorText, get, patch, post } from "../../../web/api";
import "./provider-configuration.css";

type ProviderId = "openai" | "google" | "anthropic" | "cloudflare";
type Tier = "luna" | "terra" | "sol";
type ProviderModel = { id: string; label: string; tier: string };
type ProviderCatalogItem = {
  id: ProviderId;
  label: string;
  description: string;
  models: ProviderModel[];
  defaults: Record<Tier, string>;
};
type Catalog = { providers: ProviderCatalogItem[] };
type Settings = {
  provider: ProviderId;
  source: "school" | "environment-default";
  configured: boolean;
  apiKeyConfigured: boolean;
  apiKeyHint: string | null;
  models: Record<Tier, string>;
  config: {
    temperature: number | null;
    topP: number | null;
    maxOutputTokens: number;
    timeoutMs: number;
    reasoningEffort: "default" | "low" | "medium" | "high" | "max";
    accountId: string | null;
  };
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
  accountId: string;
};

const providerTone: Record<ProviderId, string> = { openai: "OpenAI", google: "Gemini", anthropic: "Claude", cloudflare: "Cloudflare" };
const tierCopy: Record<Tier, { title: string; description: string }> = {
  luna: { title: "Luna · Fast", description: "Routine, high-volume employee work" },
  terra: { title: "Terra · Balanced", description: "Planning, analysis and daily operations" },
  sol: { title: "Sol · Advanced", description: "Complex reasoning and high-value work" },
};

function toForm(settings: Settings): FormState {
  return {
    provider: settings.provider,
    models: { ...settings.models },
    apiKey: "",
    clearApiKey: false,
    temperature: settings.config.temperature === null ? "" : String(settings.config.temperature),
    topP: settings.config.topP === null ? "" : String(settings.config.topP),
    maxOutputTokens: settings.config.maxOutputTokens,
    timeoutMs: settings.config.timeoutMs,
    reasoningEffort: settings.config.reasoningEffort,
    accountId: settings.config.accountId || "",
  };
}

export function ProviderConfigurationPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [testResult, setTestResult] = useState<{ provider: string; model: string; latencyMs: number } | null>(null);

  async function load() {
    setLoading(true); setError("");
    try {
      const [catalogData, settingsData] = await Promise.all([
        get<Catalog>("/agentic-employees/provider-catalog"),
        get<Settings>("/agentic-employees/provider-settings"),
      ]);
      setCatalog(catalogData);
      setSettings(settingsData);
      setForm(toForm(settingsData));
    } catch (err) { setError(errorText(err)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const selectedProvider = useMemo(() => catalog?.providers.find(item => item.id === form?.provider) || null, [catalog, form?.provider]);

  function chooseProvider(provider: ProviderCatalogItem) {
    setForm(current => current ? { ...current, provider: provider.id, models: { ...provider.defaults }, apiKey: "", clearApiKey: false } : current);
    setSuccess(""); setTestResult(null);
  }

  function setModel(tier: Tier, value: string) {
    setForm(current => current ? { ...current, models: { ...current.models, [tier]: value } } : current);
  }

  // Some browsers' native <input list=…> autofill/suggestion UI can insert a
  // "Label value" concatenation instead of the option's bare value. Model IDs
  // never contain whitespace, so recover the intended ID defensively.
  function sanitizeModelId(value: string) {
    const trimmed = value.trim();
    const valid = /^[A-Za-z0-9._:/@-]+$/;
    if (valid.test(trimmed)) return trimmed;
    const lastToken = trimmed.split(/\s+/).filter(Boolean).pop() || "";
    if (valid.test(lastToken)) return lastToken;
    return trimmed.replace(/[^A-Za-z0-9._:/@-]/g, "");
  }

  async function save() {
    if (!form) return;
    setSaving(true); setError(""); setSuccess(""); setTestResult(null);
    try {
      const data = await patch<Settings>("/agentic-employees/provider-settings", {
        provider: form.provider,
        models: { luna: sanitizeModelId(form.models.luna), terra: sanitizeModelId(form.models.terra), sol: sanitizeModelId(form.models.sol) },
        apiKey: form.apiKey.trim() || undefined,
        clearApiKey: form.clearApiKey,
        config: {
          temperature: form.temperature === "" ? null : Number(form.temperature),
          topP: form.topP === "" ? null : Number(form.topP),
          maxOutputTokens: Number(form.maxOutputTokens),
          timeoutMs: Number(form.timeoutMs),
          reasoningEffort: form.reasoningEffort,
          accountId: form.provider === "cloudflare" ? (form.accountId.trim() || null) : null,
        },
      });
      setSettings(data); setForm(toForm(data));
      setSuccess(`${providerTone[data.provider]} configuration saved for this school.`);
    } catch (err) { setError(errorText(err)); }
    finally { setSaving(false); }
  }

  async function testConnection() {
    setTesting(true); setError(""); setSuccess(""); setTestResult(null);
    try {
      const result = await post<{ ok: boolean; provider: string; model: string; latencyMs: number }>("/agentic-employees/provider-settings/test", { tier: "luna" });
      setTestResult(result);
      setSuccess(`Connection successful using ${result.model}.`);
    } catch (err) { setError(errorText(err)); }
    finally { setTesting(false); }
  }

  if (loading) return <div className="aipc-state"><RefreshCw className="aipc-spin" size={20}/> Loading AI provider configuration…</div>;
  if (!catalog || !settings || !form) return <div className="aipc-state aipc-error">{error || "AI provider configuration could not be loaded."}</div>;

  return <div className="aipc-page">
    <header className="aipc-hero">
      <div>
        <div className="aipc-kicker"><Sparkles size={16}/> AI Workforce · School Configuration</div>
        <h1>AI Provider Configuration</h1>
        <p>Choose the AI company this school will use, enter the school’s own API key, and map each Ledgerly employee tier to the model you want.</p>
      </div>
      <div className={`aipc-status ${settings.configured ? "is-ready" : ""}`}>
        {settings.configured ? <CheckCircle2 size={18}/> : <KeyRound size={18}/>} {settings.configured ? "Provider ready" : "API key required"}
      </div>
    </header>

    {error && <div className="aipc-alert aipc-alert-error">{error}</div>}
    {success && <div className="aipc-alert aipc-alert-success"><CheckCircle2 size={18}/>{success}</div>}

    <section className="aipc-panel">
      <div className="aipc-section-heading"><div><span>1</span><h2>AI company</h2></div><p>One provider is active per school. Changing it does not affect other schools.</p></div>
      <div className="aipc-provider-grid">
        {catalog.providers.map(provider => <button key={provider.id} type="button" className={`aipc-provider-card ${form.provider === provider.id ? "is-selected" : ""}`} onClick={() => chooseProvider(provider)}>
          <div className="aipc-provider-icon"><Bot size={22}/></div>
          <div><strong>{provider.label}</strong><p>{provider.description}</p><small>{provider.models.length} listed models · custom model IDs also allowed</small></div>
          <div className="aipc-radio">{form.provider === provider.id && <span/>}</div>
        </button>)}
      </div>
    </section>

    <section className="aipc-panel">
      <div className="aipc-section-heading"><div><span>2</span><h2>School API credential</h2></div><p>The key is encrypted before storage and is never returned to the browser after saving.</p></div>
      <div className="aipc-credential-grid">
        <label className="aipc-field aipc-wide"><span>{selectedProvider?.label} API key</span><input type="password" autoComplete="new-password" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value, clearApiKey: false })} placeholder={settings.apiKeyConfigured ? `Saved: ${settings.apiKeyHint || "credential configured"} — leave blank to keep it` : "Paste this school's API key"}/><small>Leave blank to keep the saved key. Ledgerly only shows a masked hint after save.</small></label>
        {form.provider === "cloudflare" && <label className="aipc-field aipc-wide"><span>Cloudflare account ID</span><input type="text" value={form.accountId} onChange={e => setForm({ ...form, accountId: e.target.value })} placeholder="e.g. a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"/><small>Found on your Cloudflare dashboard's Workers AI overview page. The Workers AI endpoint is scoped to this account.</small></label>}
        <div className="aipc-secret-summary"><ShieldCheck size={22}/><div><strong>{settings.apiKeyConfigured ? "Credential protected" : "No school credential yet"}</strong><span>{settings.apiKeyHint || "Add the API key supplied by the selected AI company."}</span></div></div>
      </div>
      {settings.apiKeyConfigured && <label className="aipc-check"><input type="checkbox" checked={form.clearApiKey} onChange={e => setForm({ ...form, clearApiKey: e.target.checked, apiKey: e.target.checked ? "" : form.apiKey })}/> Remove the stored school API key when I save</label>}
    </section>

    <section className="aipc-panel">
      <div className="aipc-section-heading"><div><span>3</span><h2>Model routing</h2></div><p>Each AI employee already has a Luna, Terra or Sol tier. Choose what model each tier uses for this school.</p></div>
      <div className="aipc-model-grid">
        {(["luna", "terra", "sol"] as Tier[]).map(tier => <label className="aipc-model-card" key={tier}>
          <div><strong>{tierCopy[tier].title}</strong><span>{tierCopy[tier].description}</span></div>
          <input list={`aipc-models-${form.provider}`} value={form.models[tier]} onChange={e => setModel(tier, e.target.value)} placeholder="Model ID"/>
        </label>)}
      </div>
      <datalist id={`aipc-models-${form.provider}`}>{selectedProvider?.models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</datalist>
      <div className="aipc-model-list"><strong>Available {selectedProvider?.label} models</strong><div>{selectedProvider?.models.map(model => <button type="button" key={model.id} onClick={() => setModel(model.tier === "luna" || model.tier === "terra" || model.tier === "sol" ? model.tier : "terra", model.id)}>{model.label}<code>{model.id}</code></button>)}</div></div>
    </section>

    <section className="aipc-panel">
      <div className="aipc-section-heading"><div><span>4</span><h2>Advanced controls</h2></div><p>Tune output behavior, cost ceiling and network timeout for this school.</p></div>
      <div className="aipc-form-grid">
        <label className="aipc-field"><span>Temperature</span><input type="number" min="0" max="2" step="0.1" value={form.temperature} onChange={e => setForm({ ...form, temperature: e.target.value })} placeholder="Provider default"/><small>0–2. Blank uses the provider default.</small></label>
        <label className="aipc-field"><span>Top P</span><input type="number" min="0" max="1" step="0.05" value={form.topP} onChange={e => setForm({ ...form, topP: e.target.value })} placeholder="Provider default"/><small>0–1. Blank uses the provider default.</small></label>
        <label className="aipc-field"><span>Maximum output tokens</span><input type="number" min="128" max="65536" step="128" value={form.maxOutputTokens} onChange={e => setForm({ ...form, maxOutputTokens: Number(e.target.value) })}/><small>Caps the response length and helps control cost.</small></label>
        <label className="aipc-field"><span>Request timeout (ms)</span><input type="number" min="5000" max="120000" step="1000" value={form.timeoutMs} onChange={e => setForm({ ...form, timeoutMs: Number(e.target.value) })}/><small>5,000–120,000 milliseconds.</small></label>
        <label className="aipc-field"><span>Reasoning effort</span><select value={form.reasoningEffort} onChange={e => setForm({ ...form, reasoningEffort: e.target.value as FormState["reasoningEffort"] })}><option value="default">Automatic by tier</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="max">Maximum</option></select><small>Applied where the selected provider/model supports it.</small></label>
      </div>
    </section>

    <footer className="aipc-actions">
      <div><strong>Scope: this school only</strong><span>{settings.updatedAt ? `Last saved ${new Date(settings.updatedAt).toLocaleString()}` : "Using server defaults until this school saves configuration."}</span></div>
      <button className="aipc-secondary" type="button" onClick={() => void testConnection()} disabled={testing || saving || !settings.configured}>{testing ? <RefreshCw className="aipc-spin" size={17}/> : <TestTube2 size={17}/>} {testing ? "Testing…" : "Test saved connection"}</button>
      <button className="aipc-primary" type="button" onClick={() => void save()} disabled={saving || testing}>{saving ? <RefreshCw className="aipc-spin" size={17}/> : <Save size={17}/>} {saving ? "Saving…" : "Save school configuration"}</button>
    </footer>
    {testResult && <div className="aipc-test-result"><CheckCircle2 size={18}/><div><strong>Connection verified</strong><span>{testResult.provider} · {testResult.model} · {testResult.latencyMs} ms</span></div></div>}
  </div>;
}

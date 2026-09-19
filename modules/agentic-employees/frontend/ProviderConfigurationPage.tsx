import { useEffect, useState } from "react";
import { Bot, CheckCircle2, RefreshCw, ShieldCheck, Sparkles, TestTube2 } from "lucide-react";
import { errorText, get, post } from "../../../web/api";
import "./provider-configuration.css";

type Settings={
  provider:string;
  providerId:string;
  configured:boolean;
  apiKeyConfigured:boolean;
  apiKeyHint:string|null;
  models:Record<string,string>;
  config:{providerSelection?:string};
  source:string;
};
type TestResult={ok:boolean;provider:string;model:string;latencyMs:number;availableWorkers?:number};

export function ProviderConfigurationPage(){
  const[settings,setSettings]=useState<Settings|null>(null);
  const[loading,setLoading]=useState(true);
  const[testing,setTesting]=useState(false);
  const[error,setError]=useState("");
  const[result,setResult]=useState<TestResult|null>(null);

  async function load(){
    setLoading(true);setError("");
    try{setSettings(await get<Settings>("/agentic-employees/provider-settings"));}
    catch(err){setError(errorText(err));}
    finally{setLoading(false);}
  }
  async function test(){
    setTesting(true);setError("");setResult(null);
    try{setResult(await post<TestResult>("/agentic-employees/provider-settings/test",{}));}
    catch(err){setError(errorText(err));}
    finally{setTesting(false);}
  }
  useEffect(()=>{void load();},[]);

  if(loading)return <div className="aipc-state"><RefreshCw className="aipc-spin" size={20}/> Loading Ledgerly AI runtime status…</div>;
  return <div className="aipc-page">
    <header className="aipc-hero">
      <div><div className="aipc-kicker"><Sparkles size={16}/> LEDGERLY AI · MANAGED RUNTIME</div><h1>AI Runtime Status</h1><p>Agentic Employees use Ledgerly AI as one managed execution service. Ordinary users do not choose or configure hidden model providers.</p></div>
      <div className={"aipc-status "+(settings?.configured?"is-ready":"")}>{settings?.configured?<CheckCircle2 size={18}/>:<RefreshCw size={18}/>} {settings?.configured?"Ledgerly AI ready":"Runtime unavailable"}</div>
    </header>
    {error&&<div className="aipc-alert aipc-alert-error">{error}</div>}
    <section className="aipc-panel">
      <div className="aipc-section-heading"><div><span>1</span><h2>Managed execution</h2></div><p>Provider credentials, failover and worker sessions are maintained centrally by Ledgerly AI.</p></div>
      <div className="aipc-provider-grid">
        <div className="aipc-provider-card is-selected"><div className="aipc-provider-icon"><Bot size={22}/></div><div><strong>Ledgerly AI</strong><p>Single AI interface for all named employees and custom agents.</p><small>Provider selection is managed and hidden from ordinary users.</small></div><div className="aipc-radio"><span/></div></div>
      </div>
    </section>
    <section className="aipc-panel">
      <div className="aipc-section-heading"><div><span>2</span><h2>Security model</h2></div><p>Employee authority is determined by Ledgerly roles, scopes, tool allowlists and approval gates—not by the hidden execution engine.</p></div>
      <div className="aipc-credential-grid">
        <div className="aipc-secret-summary"><ShieldCheck size={22}/><div><strong>Credentials protected</strong><span>{settings?.apiKeyHint||"Managed internally by Ledgerly AI."}</span></div></div>
        <div className="aipc-secret-summary"><ShieldCheck size={22}/><div><strong>Permission gateway active</strong><span>Every employee action is re-checked against the current Ledgerly user permissions.</span></div></div>
      </div>
    </section>
    <footer className="aipc-actions">
      <div><strong>Runtime: {settings?.provider||"Ledgerly AI"}</strong><span>Execution routing and failover are centrally managed.</span></div>
      <button className="aipc-secondary" type="button" onClick={()=>void load()} disabled={loading||testing}><RefreshCw size={17}/> Refresh</button>
      <button className="aipc-primary" type="button" onClick={()=>void test()} disabled={testing||!settings?.configured}>{testing?<RefreshCw className="aipc-spin" size={17}/>:<TestTube2 size={17}/>} {testing?"Testing…":"Test Ledgerly AI"}</button>
    </footer>
    {result&&<div className="aipc-test-result"><CheckCircle2 size={18}/><div><strong>Ledgerly AI verified</strong><span>{result.latencyMs} ms{typeof result.availableWorkers==="number"?` · ${result.availableWorkers} available worker(s)`:""}</span></div></div>}
  </div>;
}

import { useEffect, useState } from "react";
import { Bot, Clock3, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { errorText, get, patch, post } from "../../../web/api";

type Schedule = {
  id: string;
  workflowKey: string;
  agentKey: string;
  actorUserId: string;
  enabled: number | boolean;
  cadence: "daily" | "weekly";
  runHour: number;
  runMinute: number;
  weekday?: number | null;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
};

type Run = {
  id: string;
  workflowKey: string;
  agentKey: string;
  triggerType: string;
  status: string;
  summary?: string | null;
  errorText?: string | null;
  model?: string | null;
  startedAt: string;
  completedAt?: string | null;
};

const NAMES: Record<string, string> = {
  dos_daily_review: "DOS daily academic review",
  bursar_daily_review: "Bursar daily collections review",
  hr_daily_review: "HR daily workforce review",
  secretary_daily_review: "Secretary daily front-office review",
  librarian_weekly_review: "Librarian weekly books review",
  headteacher_daily_brief: "Head Teacher daily management brief",
};

function fmt(value?: string | null) {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString();
}

export function ProactiveEmployeesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    setError("");
    try {
      const [nextSchedules, nextRuns] = await Promise.all([
        get<Schedule[]>("/agentic-employees/proactive/schedules"),
        get<Run[]>("/agentic-employees/proactive/runs?limit=40"),
      ]);
      setSchedules(nextSchedules);
      setRuns(nextRuns);
    } catch (err) {
      setError(errorText(err));
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function initialize() {
    setBusy("initialize");
    setError("");
    try {
      await post("/agentic-employees/proactive/initialize", {});
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  async function toggle(schedule: Schedule) {
    setBusy(schedule.id);
    setError("");
    try {
      await patch(`/agentic-employees/proactive/schedules/${schedule.id}`, { enabled: !Boolean(schedule.enabled) });
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  async function runNow(workflowKey: string) {
    setBusy(workflowKey);
    setError("");
    try {
      await post(`/agentic-employees/proactive/run/${workflowKey}`, {});
      await refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy("");
    }
  }

  return <div className="ae-page">
    <div className="ae-hero">
      <div>
        <span className="ae-kicker">PROACTIVE AI WORKFORCE</span>
        <h1>Proactive Employees</h1>
        <p>Scheduled, read-only school reviews that produce management briefs without silently sending messages or changing records.</p>
      </div>
      <button disabled={busy === "initialize"} onClick={() => void initialize()}><ShieldCheck size={17} />{schedules.length ? "Ensure defaults" : "Enable proactive workforce"}</button>
    </div>

    {error && <div className="ae-error">{error}</div>}

    <div className="ae-panel">
      <div className="ae-card-top"><div><h2>Schedules</h2><p>Times use the school timezone. Only organization owners/admins can enable or change proactive automation.</p></div><button className="secondary" onClick={() => void refresh()}><RefreshCw size={16} />Refresh</button></div>
      {!schedules.length && <div className="ae-empty"><Bot /><h3>Proactive workforce is not initialized</h3><p>Enable it to create the safe default review schedules.</p></div>}
      <div className="ae-list">
        {schedules.map(schedule => <div key={schedule.id}>
          <Clock3 />
          <div>
            <b>{NAMES[schedule.workflowKey] || schedule.workflowKey}</b>
            <small>{schedule.agentKey} · {schedule.cadence} · {String(schedule.runHour).padStart(2, "0")}:{String(schedule.runMinute).padStart(2, "0")}</small>
            <p>Last: {fmt(schedule.lastRunAt)} · Next: {fmt(schedule.nextRunAt)}</p>
            <div className="ae-actions">
              <button disabled={busy === schedule.id} onClick={() => void toggle(schedule)}>{Boolean(schedule.enabled) ? "Pause" : "Enable"}</button>
              <button className="secondary" disabled={busy === schedule.workflowKey} onClick={() => void runNow(schedule.workflowKey)}><Play size={15} />Run now</button>
            </div>
          </div>
        </div>)}
      </div>
    </div>

    <div className="ae-panel">
      <h2>Recent proactive briefs</h2>
      <div className="ae-list">
        {runs.map(run => <div key={run.id}>
          <Bot />
          <div>
            <b>{NAMES[run.workflowKey] || run.workflowKey}</b>
            <small>{run.agentKey} · {run.triggerType} · {run.status} · {fmt(run.startedAt)}{run.model ? ` · ${run.model}` : ""}</small>
            {run.summary && <p>{run.summary}</p>}
            {run.errorText && <p className="bad">{run.errorText}</p>}
          </div>
        </div>)}
        {!runs.length && <p>No proactive runs yet.</p>}
      </div>
    </div>
  </div>;
}

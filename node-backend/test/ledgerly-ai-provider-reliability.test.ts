import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseLedgerlyAiConfig } from "../src/features/ledgerly-ai/config.js";
import { ProviderSessionStore } from "../src/features/ledgerly-ai/providers/session.js";
import { ProviderCommandBuilder } from "../src/features/ledgerly-ai/providers/command-builder.js";
import { CodexCliProvider } from "../src/features/ledgerly-ai/providers/codex.js";
import { ClaudeCodeCliProvider } from "../src/features/ledgerly-ai/providers/claude-code.js";
import { LedgerlyAiProviderRouter } from "../src/features/ledgerly-ai/providers/router.js";
import { LedgerlyAiProviderRuntime } from "../src/features/ledgerly-ai/providers/runtime.js";
import { LedgerlyAiExecutionQueue } from "../src/features/ledgerly-ai/providers/execution-queue.js";
import type { LedgerlyAiProviderAdapter, LedgerlyAiTaskKind, ProviderRequest, ProviderResult } from "../src/features/ledgerly-ai/providers/types.js";

let root="";
let workRoot="";
let sessionRoot="";
let codexBin="";
let claudeBin="";

function result(provider:"codex"|"claude-code",text:string):ProviderResult{
  return{provider,text,durationMs:2,exitCode:0,events:[]};
}
function config(extra:Record<string,unknown>={}){
  return parseLedgerlyAiConfig({
    LEDGERLY_AI_STARTUP_HEALTHCHECK:false,
    LEDGERLY_AI_EXECUTION_MODE:"local",
    LEDGERLY_AI_WORK_ROOT:workRoot,
    LEDGERLY_AI_SESSION_ROOT:sessionRoot,
    LEDGERLY_AI_CODEX_BIN:codexBin,
    LEDGERLY_AI_CLAUDE_BIN:claudeBin,
    LEDGERLY_AI_RETRY_ATTEMPTS:0,
    LEDGERLY_AI_JOB_TIMEOUT_MS:15_000,
    LEDGERLY_AI_HEALTH_TIMEOUT_MS:5_000,
    ...extra,
  });
}
function fakeDb(rows:Record<string,unknown>[]=[]){
  return{query:async()=>({rows,rowCount:rows.length})};
}
function fakeLogger(){
  const logger:any={info(){},warn(){},error(){},debug(){},child(){return logger;}};
  return logger;
}

beforeAll(async()=>{
  root=await mkdtemp(path.join(os.tmpdir(),"ledgerly-ai-rel-"));
  workRoot=path.join(root,"work");
  sessionRoot=path.join(root,"sessions");
  codexBin=path.join(root,"fake-codex");
  claudeBin=path.join(root,"fake-claude");
  await Promise.all([
    writeFile(codexBin,[
      "#!/bin/sh",
      "echo '{\"type\":\"thread.started\",\"thread_id\":\"codex-thread-1\"}'",
      "echo '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Codex integration OK\"}}'",
      "echo '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":12,\"output_tokens\":5}}'",
    ].join("\n")),
    writeFile(claudeBin,[
      "#!/bin/sh",
      "echo '{\"type\":\"system\",\"session_id\":\"claude-session-1\"}'",
      "echo '{\"type\":\"result\",\"session_id\":\"claude-session-1\",\"result\":\"Claude integration OK\",\"duration_ms\":7,\"num_turns\":1}'",
    ].join("\n")),
  ]);
  await Promise.all([chmod(codexBin,0o755),chmod(claudeBin,0o755)]);
});
afterAll(async()=>{if(root)await rm(root,{recursive:true,force:true});});

describe("Ledgerly AI provider reliability",()=>{
  it("executes the Codex adapter end-to-end through a real subprocess",async()=>{
    const cfg=config();
    const sessions=new ProviderSessionStore(cfg);
    await sessions.initialize();
    const workspace=path.join(workRoot,"codex-job");
    await import("node:fs/promises").then(fs=>fs.mkdir(workspace,{recursive:true}));
    const provider=new CodexCliProvider(cfg,sessions,new ProviderCommandBuilder(cfg,sessions));
    const response=await provider.execute({
      id:"job_codex",organizationId:"org_1",userId:"usr_1",correlationId:"corr_1",
      prompt:"test",taskKind:"chat",workspacePath:workspace,sandbox:"read-only",
    });
    expect(response.text).toBe("Codex integration OK");
    expect(response.sessionId).toBe("codex-thread-1");
    expect(response.usage).toMatchObject({input_tokens:12,output_tokens:5});
  });

  it("executes the Claude Code adapter end-to-end through a real subprocess",async()=>{
    const cfg=config();
    const sessions=new ProviderSessionStore(cfg);
    await sessions.initialize();
    const workspace=path.join(workRoot,"claude-job");
    await import("node:fs/promises").then(fs=>fs.mkdir(workspace,{recursive:true}));
    const provider=new ClaudeCodeCliProvider(cfg,sessions,new ProviderCommandBuilder(cfg,sessions));
    const response=await provider.execute({
      id:"job_claude",organizationId:"org_1",userId:"usr_1",correlationId:"corr_2",
      prompt:"test",taskKind:"analysis",workspacePath:workspace,sandbox:"read-only",
    });
    expect(response.text).toBe("Claude integration OK");
    expect(response.sessionId).toBe("claude-session-1");
    expect(response.usage).toMatchObject({duration_ms:7,num_turns:1});
  });

  it("ranks healthy capable providers and prefers Codex for code work",async()=>{
    const cfg=config({LEDGERLY_AI_DEFAULT_PROVIDER:"claude-code",LEDGERLY_AI_FALLBACK_PROVIDER:"codex"});
    const make=(id:"codex"|"claude-code"):LedgerlyAiProviderAdapter=>({
      id,capabilities:new Set<LedgerlyAiTaskKind>(["chat","code","analysis"]),
      health:async()=>({provider:id,available:true,executable:true,sessionConfigured:true,checkedAt:new Date().toISOString(),latencyMs:1}),
      execute:async()=>result(id,"ok"),
    });
    const providers=new Map<any,any>([["codex",make("codex")],["claude-code",make("claude-code")]]);
    const router=new LedgerlyAiProviderRouter(fakeDb([]) as never,cfg,providers,()=>({active:0,queued:0}));
    await expect(router.rank("code")).resolves.toEqual(["codex","claude-code"]);
  });

  it("fails over from the first provider to the second provider",async()=>{
    const cfg=config();
    const runtime:any={db:fakeDb(),logger:fakeLogger()};
    const providers=new LedgerlyAiProviderRuntime(runtime,cfg);
    const attempted:string[]=[];
    const first:LedgerlyAiProviderAdapter={
      id:"codex",capabilities:new Set<LedgerlyAiTaskKind>(["chat"]),
      health:async()=>({provider:"codex",available:true,executable:true,sessionConfigured:true,checkedAt:new Date().toISOString(),latencyMs:1}),
      execute:async()=>{attempted.push("codex");throw new Error("codex unavailable");},
    };
    const second:LedgerlyAiProviderAdapter={
      id:"claude-code",capabilities:new Set<LedgerlyAiTaskKind>(["chat"]),
      health:async()=>({provider:"claude-code",available:true,executable:true,sessionConfigured:true,checkedAt:new Date().toISOString(),latencyMs:1}),
      execute:async()=>{attempted.push("claude-code");return result("claude-code","fallback worked");},
    };
    (providers as any).providers=new Map([["codex",first],["claude-code",second]]);
    (providers.router as any).rank=async()=>["codex","claude-code"];
    const response=await providers.execute({
      id:"failover-job",organizationId:"org_1",userId:"usr_1",correlationId:"corr_failover",
      prompt:"hello",taskKind:"chat",sandbox:"read-only",
    });
    expect(response.text).toBe("fallback worked");
    expect(attempted).toEqual(["codex","claude-code"]);
    expect(providers.queue.active).toBe(0);
    expect(providers.queue.queued).toBe(0);
  });

  it("fails cleanly when both providers are unavailable and recovers for later work",async()=>{
    const cfg=config();
    const runtime:any={db:fakeDb(),logger:fakeLogger()};
    const providers=new LedgerlyAiProviderRuntime(runtime,cfg);
    const broken=(id:"codex"|"claude-code"):LedgerlyAiProviderAdapter=>({
      id,capabilities:new Set<LedgerlyAiTaskKind>(["chat"]),
      health:async()=>({provider:id,available:false,executable:true,sessionConfigured:true,checkedAt:new Date().toISOString(),latencyMs:1}),
      execute:async()=>{throw new Error(id+" offline");},
    });
    (providers as any).providers=new Map([["codex",broken("codex")],["claude-code",broken("claude-code")]]);
    (providers.router as any).rank=async()=>["codex","claude-code"];
    const request:ProviderRequest={
      id:"all-down",organizationId:"org_1",userId:"usr_1",correlationId:"corr_down",
      prompt:"hello",taskKind:"chat",sandbox:"read-only",
    };
    await expect(providers.execute(request)).rejects.toThrow(/codex offline.*claude-code offline/i);
    expect(providers.queue.active).toBe(0);
    expect(providers.queue.queued).toBe(0);

    const recovered:LedgerlyAiProviderAdapter={
      id:"codex",capabilities:new Set<LedgerlyAiTaskKind>(["chat"]),
      health:async()=>({provider:"codex",available:true,executable:true,sessionConfigured:true,checkedAt:new Date().toISOString(),latencyMs:1}),
      execute:async()=>result("codex","recovered"),
    };
    (providers as any).providers=new Map([["codex",recovered]]);
    (providers.router as any).rank=async()=>["codex"];
    await expect(providers.execute({...request,id:"recovered"})).resolves.toMatchObject({text:"recovered"});
  });

  it("holds the configured concurrency ceiling under load and keeps draining after failures",async()=>{
    const queue=new LedgerlyAiExecutionQueue(4,200);
    let active=0,maxActive=0;
    const jobs=Array.from({length:80},(_,index)=>queue.submit("load-"+index,async()=>{
      active+=1;maxActive=Math.max(maxActive,active);
      await new Promise(resolve=>setTimeout(resolve,index%5));
      active-=1;
      if(index===17)throw new Error("synthetic failure");
      return index;
    }));
    const settled=await Promise.allSettled(jobs);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(settled.filter(x=>x.status==="fulfilled")).toHaveLength(79);
    expect(settled.filter(x=>x.status==="rejected")).toHaveLength(1);
    expect(queue.active).toBe(0);
    expect(queue.queued).toBe(0);
  });
});

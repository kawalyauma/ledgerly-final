import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { LedgerlyAiConfig } from "../config.js";
import { requireIncidentCommand, runIncidentCommand, type IncidentCommandResult } from "./command.js";

export type IncidentWorkspace={
  path:string;
  branch:string;
  baseSha:string;
};

export type IncidentCheckResult={
  type:"test"|"typecheck"|"build";
  commandKey:string;
  status:"passed"|"failed";
  durationMs:number;
  output:string;
};

function safeSlug(value:string){
  return value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48)||"incident";
}
function ensureInside(root:string,candidate:string){
  const resolvedRoot=path.resolve(root)+path.sep;
  const resolved=path.resolve(candidate);
  if(!(resolved+path.sep).startsWith(resolvedRoot))throw new Error("Incident workspace escaped the configured work root.");
  return resolved;
}
function commandOutput(result:IncidentCommandResult){
  return (result.stdout+"\n"+result.stderr).trim().slice(-1024*1024);
}

export class IncidentWorkspaceManager{
  constructor(private readonly config:LedgerlyAiConfig){}

  async prepare(incidentId:string,agentKey:string,title:string):Promise<IncidentWorkspace>{
    const root=path.resolve(this.config.LEDGERLY_AI_WORK_ROOT,"incidents");
    await mkdir(root,{recursive:true,mode:0o700});
    const workspace=ensureInside(root,path.join(root,incidentId));
    await runIncidentCommand({
      command:"git",args:["worktree","remove","--force",workspace],
      cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:60_000,maxBytes:64*1024,
    }).catch(()=>undefined);
    await rm(workspace,{recursive:true,force:true});
    await requireIncidentCommand({
      command:"git",args:["worktree","prune"],
      cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:60_000,maxBytes:64*1024,
    },"Git worktree prune");
    const base=await requireIncidentCommand({
      command:"git",args:["rev-parse","HEAD"],
      cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:30_000,maxBytes:8192,
    },"Git base revision");
    await requireIncidentCommand({
      command:"git",args:["worktree","add","--detach",workspace,base.stdout.trim()],
      cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:120_000,maxBytes:256*1024,
    },"Incident worktree creation");
    const branchBase=`agent/${safeSlug(agentKey)}/inc-${safeSlug(incidentId)}-${safeSlug(title).slice(0,24)}`;
    const exists=await runIncidentCommand({
      command:"git",args:["show-ref","--verify","--quiet","refs/heads/"+branchBase],
      cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:30_000,maxBytes:8192,
    });
    const branch=exists.exitCode===0?branchBase+"-r"+Date.now():branchBase;
    await requireIncidentCommand({
      command:"git",args:["switch","-c",branch],
      cwd:workspace,timeoutMs:60_000,maxBytes:64*1024,
    },"Incident branch creation");
    return{path:workspace,branch,baseSha:base.stdout.trim()};
  }

  async changedPaths(workspace:string){
    const [tracked,untracked]=await Promise.all([
      requireIncidentCommand({
        command:"git",args:["diff","--name-only","-z","HEAD","--","."],
        cwd:workspace,timeoutMs:30_000,maxBytes:512*1024,
      },"Git changed tracked paths"),
      requireIncidentCommand({
        command:"git",args:["ls-files","--others","--exclude-standard","-z"],
        cwd:workspace,timeoutMs:30_000,maxBytes:512*1024,
      },"Git untracked paths"),
    ]);
    const paths=(tracked.stdout+"\0"+untracked.stdout)
      .split("\0").map(value=>value.trim().replaceAll("\\","/")).filter(Boolean);
    return [...new Set(paths)];
  }

  validateChangedPaths(paths:string[]){
    const forbidden=paths.filter(value=>{
      const p=value.toLowerCase();
      return p===".env"||p.startsWith(".env.")||p.includes("/.env")||
        p.includes("credentials")||p.includes("session")&&p.includes("ledgerly-ai")||
        p.includes("private-key")||p.includes("id_rsa")||p.includes("secrets/");
    });
    if(forbidden.length)throw new Error("Incident worker attempted to modify protected secret/session paths: "+forbidden.join(", "));
  }

  async diffSummary(workspace:string){
    const [stat,diff]=await Promise.all([
      requireIncidentCommand({
        command:"git",args:["diff","--stat","--","."],cwd:workspace,
        timeoutMs:30_000,maxBytes:256*1024,
      },"Git diff stat"),
      requireIncidentCommand({
        command:"git",args:["diff","--","."],cwd:workspace,
        timeoutMs:30_000,maxBytes:1024*1024,
      },"Git diff"),
    ]);
    return{stat:stat.stdout.trim(),diff:diff.stdout.slice(0,1024*1024)};
  }

  async runVerification(workspace:string,changedPaths:string[]):Promise<IncidentCheckResult[]>{
    const checks:Array<{type:IncidentCheckResult["type"];key:string;cwd:string;command:string;args:string[]}>=[];
    const touchesNode=changedPaths.some(p=>p.startsWith("node-backend/"));
    const touchesRoot=changedPaths.some(p=>
      p.startsWith("web/")||p.startsWith("modules/")||p.startsWith("src/")||
      p==="package.json"||p==="package-lock.json"||p==="tsconfig.json"||p.startsWith("scripts/")
    );
    if(touchesNode){
      checks.push(
        {type:"test",key:"node-backend:test",cwd:path.join(workspace,"node-backend"),command:"npm",args:["test"]},
        {type:"typecheck",key:"node-backend:typecheck",cwd:path.join(workspace,"node-backend"),command:"npm",args:["run","typecheck"]},
        {type:"build",key:"node-backend:build-strict",cwd:path.join(workspace,"node-backend"),command:"npm",args:["run","build:strict"]},
      );
    }
    if(touchesRoot){
      checks.push(
        {type:"typecheck",key:"root:typecheck",cwd:workspace,command:"npm",args:["run","typecheck"]},
        {type:"test",key:"root:test",cwd:workspace,command:"npm",args:["test"]},
        {type:"build",key:"root:build-web",cwd:workspace,command:"npm",args:["run","build:web"]},
      );
    }
    if(touchesNode){
      const nodeModules=path.join(workspace,"node-backend","node_modules");
      try{
        await requireIncidentCommand({
          command:"test",args:["-d",nodeModules],cwd:workspace,timeoutMs:5_000,maxBytes:8192,
        },"Node backend dependency check");
      }catch{
        await requireIncidentCommand({
          command:"npm",args:["install","--no-package-lock","--no-audit","--no-fund"],
          cwd:path.join(workspace,"node-backend"),
          timeoutMs:Math.max(this.config.LEDGERLY_AI_JOB_TIMEOUT_MS,600_000),maxBytes:2*1024*1024,
        },"Install Node backend verification dependencies");
      }
    }
    if(touchesRoot){
      const rootModules=path.join(workspace,"node_modules");
      try{
        await requireIncidentCommand({
          command:"test",args:["-d",rootModules],cwd:workspace,timeoutMs:5_000,maxBytes:8192,
        },"Root dependency check");
      }catch{
        await requireIncidentCommand({
          command:"npm",args:["ci","--no-audit","--no-fund"],
          cwd:workspace,timeoutMs:Math.max(this.config.LEDGERLY_AI_JOB_TIMEOUT_MS,600_000),maxBytes:2*1024*1024,
        },"Install root verification dependencies");
      }
    }

    const results:IncidentCheckResult[]=[];
    for(const check of checks){
      const result=await runIncidentCommand({
        command:check.command,args:check.args,cwd:check.cwd,
        timeoutMs:Math.max(this.config.LEDGERLY_AI_JOB_TIMEOUT_MS,600_000),
        maxBytes:2*1024*1024,
      });
      results.push({
        type:check.type,
        commandKey:check.key,
        status:result.exitCode===0&&!result.timedOut?"passed":"failed",
        durationMs:result.durationMs,
        output:commandOutput(result),
      });
      if(result.exitCode!==0||result.timedOut)break;
    }
    return results;
  }

  async commit(workspace:string,incidentId:string,title:string){
    const paths=await this.changedPaths(workspace);
    this.validateChangedPaths(paths);
    if(!paths.length)throw new Error("Incident worker produced no source changes to commit.");
    await requireIncidentCommand({
      command:"git",args:["add","--all"],cwd:workspace,timeoutMs:60_000,maxBytes:256*1024,
    },"Stage incident fix");
    await requireIncidentCommand({
      command:"git",
      args:[
        "-c","user.name=Ledgerly AI",
        "-c","user.email=ledgerly-ai@localhost",
        "commit","-m",`fix(incident): ${title.slice(0,120)}`,
        "-m",`Incident: ${incidentId}`,
      ],
      cwd:workspace,timeoutMs:120_000,maxBytes:512*1024,
    },"Commit incident fix");
    const sha=await requireIncidentCommand({
      command:"git",args:["rev-parse","HEAD"],cwd:workspace,timeoutMs:30_000,maxBytes:8192,
    },"Read incident fix revision");
    return{sha:sha.stdout.trim(),paths};
  }

  async remove(workspace:string){
    const safe=ensureInside(path.resolve(this.config.LEDGERLY_AI_WORK_ROOT,"incidents"),workspace);
    await runIncidentCommand({
      command:"git",args:["worktree","remove","--force",safe],
      cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:120_000,maxBytes:256*1024,
    });
    await rm(safe,{recursive:true,force:true});
  }
}

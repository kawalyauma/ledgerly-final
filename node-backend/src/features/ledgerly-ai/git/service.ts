import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { Runtime } from "../../../runtime.js";
import { AppError } from "../../../http/errors.js";
import type { AuthPrincipal } from "../../../http/types.js";
import { createId } from "../../core-identity/security.js";
import type { LedgerlyAiConfig } from "../config.js";
import { runIncidentCommand, requireIncidentCommand } from "../incidents/command.js";

export type GitWorkKind="incident"|"task"|"manual";
export type GitWorkspace={
  id:string;
  organizationId:string|null;
  incidentId:string|null;
  workKind:GitWorkKind;
  workKey:string;
  agentKey:string;
  title:string;
  workspacePath:string;
  branchName:string;
  baseBranch:string;
  baseSha:string;
  headSha:string|null;
  status:"active"|"committed"|"pr_open"|"conflict"|"merged"|"closed"|"failed";
  changedPaths:string[];
  diffSummary:string|null;
  conflict:Record<string,unknown>;
  createdBy:string;
};
type PullRequestRow={
  id:string;workspaceId:string;organizationId:string|null;incidentId:string|null;
  repository:string;externalNumber:number|null;url:string|null;title:string;
  headBranch:string;baseBranch:string;headSha:string;status:"open"|"closed"|"merged"|"error";
  ciState:"unknown"|"pending"|"passing"|"failing";mergeableState:string|null;createdBy:string;
};
type GithubCheck={
  id?:number;
  name:string;
  status:string;
  conclusion?:string|null;
  details_url?:string|null;
  started_at?:string|null;
  completed_at?:string|null;
};
type GithubStatus={context:string;state:string;target_url?:string|null;description?:string|null};

function slug(value:string,max=48){
  return value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,max)||"work";
}
function csv(value:string){
  return value.split(",").map(v=>v.trim()).filter(Boolean);
}
function ensureInside(root:string,candidate:string){
  const resolvedRoot=path.resolve(root)+path.sep;
  const resolved=path.resolve(candidate);
  if(!(resolved+path.sep).startsWith(resolvedRoot))throw new Error("Git workspace escaped the configured work root.");
  return resolved;
}
function passedConclusion(value:string|null|undefined){
  return ["success","neutral","skipped"].includes(String(value||"").toLowerCase());
}
function failedConclusion(value:string|null|undefined){
  return ["failure","cancelled","timed_out","action_required","startup_failure","stale"].includes(String(value||"").toLowerCase());
}

export function standardAgentBranch(input:{
  agentKey:string;workKind:GitWorkKind;workKey:string;title:string;
}){
  const prefix=input.workKind==="incident"?"inc":input.workKind==="task"?"task":"work";
  return `agent/${slug(input.agentKey,32)}/${prefix}-${slug(input.workKey,36)}-${slug(input.title,28)}`;
}

export class LedgerlyAiGitService{
  constructor(private readonly runtime:Runtime,private readonly config:LedgerlyAiConfig){}

  private protectedBranches(){
    return new Set(csv(this.config.LEDGERLY_AI_GIT_PROTECTED_BRANCHES).map(v=>v.toLowerCase()));
  }
  private assertBranchAllowed(branch:string){
    const normalized=branch.trim().toLowerCase();
    if(!normalized)throw new AppError(409,"GIT_BRANCH_REQUIRED","Git branch is missing.");
    if(this.protectedBranches().has(normalized)){
      throw new AppError(409,"GIT_PROTECTED_BRANCH","Ledgerly AI may not commit directly to a protected branch.");
    }
    if(!normalized.startsWith("agent/")){
      throw new AppError(409,"GIT_BRANCH_POLICY","Ledgerly AI work must use an agent/* branch.");
    }
  }
  private async currentBranch(workspace:string){
    const result=await requireIncidentCommand({
      command:"git",args:["branch","--show-current"],cwd:workspace,timeoutMs:30_000,maxBytes:8192,
    },"Read Git branch");
    return result.stdout.trim();
  }
  private async resolveBase(){
    const remote=this.config.LEDGERLY_AI_GIT_REMOTE;
    const base=this.config.LEDGERLY_AI_GIT_BASE_BRANCH;
    await runIncidentCommand({
      command:"git",args:["fetch","--quiet",remote,base],
      cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:120_000,maxBytes:256*1024,
    }).catch(()=>undefined);
    for(const ref of [`refs/remotes/${remote}/${base}`,`refs/heads/${base}`,"HEAD"]){
      const result=await runIncidentCommand({
        command:"git",args:["rev-parse","--verify",ref],
        cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:30_000,maxBytes:8192,
      });
      if(result.exitCode===0&&result.stdout.trim())return{ref,sha:result.stdout.trim()};
    }
    throw new Error(`Could not resolve Git base branch ${base}.`);
  }
  private mapWorkspace(row:any):GitWorkspace{
    return{
      id:row.id,organizationId:row.organizationId??null,incidentId:row.incidentId??null,
      workKind:row.workKind,workKey:row.workKey,agentKey:row.agentKey,title:row.title,
      workspacePath:row.workspacePath,branchName:row.branchName,baseBranch:row.baseBranch,
      baseSha:row.baseSha,headSha:row.headSha??null,status:row.status,
      changedPaths:Array.isArray(row.changedPaths)?row.changedPaths:[],
      diffSummary:row.diffSummary??null,conflict:row.conflict??{},createdBy:row.createdBy,
    };
  }
  private workspaceSelect(){
    return `SELECT id,organization_id AS "organizationId",incident_id AS "incidentId",
      work_kind AS "workKind",work_key AS "workKey",agent_key AS "agentKey",title,
      workspace_path AS "workspacePath",branch_name AS "branchName",base_branch AS "baseBranch",
      base_sha AS "baseSha",head_sha AS "headSha",status,changed_paths_json AS "changedPaths",
      diff_summary AS "diffSummary",conflict_json AS conflict,created_by AS "createdBy"
      FROM lai_git_workspaces`;
  }
  async getWorkspace(id:string){
    const result=await this.runtime.db.query(this.workspaceSelect()+" WHERE id=$1 LIMIT 1",[id]);
    if(!result.rows[0])throw new AppError(404,"GIT_WORKSPACE_NOT_FOUND","Git workspace not found.");
    return this.mapWorkspace(result.rows[0]);
  }

  async createWorkspace(input:{
    organizationId?:string|null;incidentId?:string|null;workKind:GitWorkKind;workKey:string;
    agentKey:string;title:string;createdBy:string;
  }){
    const id=createId("laigw");
    const root=path.resolve(this.config.LEDGERLY_AI_WORK_ROOT,"git");
    await mkdir(root,{recursive:true,mode:0o700});
    const workspace=ensureInside(root,path.join(root,id));
    const base=await this.resolveBase();
    let branch=standardAgentBranch(input);
    const exists=await runIncidentCommand({
      command:"git",args:["show-ref","--verify","--quiet","refs/heads/"+branch],
      cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:30_000,maxBytes:8192,
    });
    if(exists.exitCode===0)branch+="-r"+Date.now();
    this.assertBranchAllowed(branch);
    await rm(workspace,{recursive:true,force:true});
    await requireIncidentCommand({
      command:"git",args:["worktree","prune"],
      cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:60_000,maxBytes:64*1024,
    },"Git worktree prune");
    await requireIncidentCommand({
      command:"git",args:["worktree","add","--detach",workspace,base.sha],
      cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:120_000,maxBytes:256*1024,
    },"Git worktree creation");
    try{
      await requireIncidentCommand({
        command:"git",args:["switch","-c",branch],cwd:workspace,timeoutMs:60_000,maxBytes:64*1024,
      },"Git agent branch creation");
      await this.runtime.db.query(
        `INSERT INTO lai_git_workspaces(
          id,organization_id,incident_id,work_kind,work_key,agent_key,title,workspace_path,
          branch_name,base_branch,base_sha,status,created_by
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12)`,
        [
          id,input.organizationId??null,input.incidentId??null,input.workKind,input.workKey,input.agentKey,
          input.title.slice(0,220),workspace,branch,this.config.LEDGERLY_AI_GIT_BASE_BRANCH,base.sha,input.createdBy,
        ],
      );
      return this.getWorkspace(id);
    }catch(error){
      await runIncidentCommand({
        command:"git",args:["worktree","remove","--force",workspace],
        cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:120_000,maxBytes:128*1024,
      }).catch(()=>undefined);
      throw error;
    }
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
    return [...new Set((tracked.stdout+"\0"+untracked.stdout).split("\0")
      .map(v=>v.trim().replaceAll("\\","/")).filter(Boolean))];
  }
  validateChangedPaths(paths:string[]){
    const forbidden=paths.filter(value=>{
      const p=value.toLowerCase();
      return p===".env"||p.startsWith(".env.")||p.includes("/.env")||p.includes("credentials")||
        (p.includes("session")&&p.includes("ledgerly-ai"))||p.includes("private-key")||
        p.includes("id_rsa")||p.includes("secrets/");
    });
    if(forbidden.length)throw new AppError(
      409,"GIT_PROTECTED_PATH","Ledgerly AI attempted to modify protected secret/session paths.",{paths:forbidden},
    );
  }
  async diffSummary(workspace:string){
    const [stat,names]=await Promise.all([
      requireIncidentCommand({
        command:"git",args:["diff","--stat","HEAD","--","."],cwd:workspace,timeoutMs:30_000,maxBytes:256*1024,
      },"Git diff stat"),
      this.changedPaths(workspace),
    ]);
    return{stat:stat.stdout.trim(),paths:names};
  }
  private async ensureIncidentChecksPassed(workspace:GitWorkspace){
    if(!workspace.incidentId)return;
    const result=await this.runtime.db.query<{checkType:string;status:string}>(
      `SELECT check_type AS "checkType",status FROM lai_incident_checks
        WHERE incident_id=$1 AND check_type IN ('test','typecheck','build','qa')
        ORDER BY created_at`,
      [workspace.incidentId],
    );
    if(result.rows.some(row=>row.status==="failed")){
      throw new AppError(409,"GIT_REQUIRED_CHECK_FAILED","A required incident verification check failed.");
    }
    const passed=new Set(result.rows.filter(row=>row.status==="passed").map(row=>row.checkType));
    if(!passed.has("qa")){
      throw new AppError(409,"GIT_QA_REQUIRED","Independent QA must pass before Ledgerly AI commits an incident fix.");
    }
  }

  async commitWorkspace(input:{workspaceId:string;subject:string;agentName:string;metadata?:Record<string,unknown>}){
    const workspace=await this.getWorkspace(input.workspaceId);
    if(!["active","committed"].includes(workspace.status)){
      throw new AppError(409,"GIT_WORKSPACE_STATE","Git workspace is not in a committable state.");
    }
    const actualBranch=await this.currentBranch(workspace.workspacePath);
    this.assertBranchAllowed(actualBranch);
    if(actualBranch!==workspace.branchName){
      throw new AppError(409,"GIT_BRANCH_MISMATCH","Git workspace branch does not match its governed branch.");
    }
    await this.ensureIncidentChecksPassed(workspace);
    const summary=await this.diffSummary(workspace.workspacePath);
    this.validateChangedPaths(summary.paths);
    if(!summary.paths.length)throw new AppError(409,"GIT_NO_CHANGES","No source changes are available to commit.");
    const authorName=`Ledgerly AI · ${input.agentName.slice(0,80)}`;
    const authorEmail=`ledgerly-ai+${slug(workspace.agentKey,32)}@localhost`;
    const trailers=[
      `Ledgerly-AI-Agent: ${input.agentName.slice(0,120)}`,
      `Ledgerly-AI-Agent-Key: ${workspace.agentKey}`,
      `Ledgerly-AI-Work-Kind: ${workspace.workKind}`,
      `Ledgerly-AI-Work-ID: ${workspace.id}`,
      workspace.incidentId?`Ledgerly-AI-Incident: ${workspace.incidentId}`:"",
    ].filter(Boolean).join("\n");
    await requireIncidentCommand({
      command:"git",args:["add","--all"],cwd:workspace.workspacePath,timeoutMs:60_000,maxBytes:256*1024,
    },"Stage AI Git changes");
    await requireIncidentCommand({
      command:"git",
      args:[
        "-c",`user.name=${authorName}`,"-c",`user.email=${authorEmail}`,
        "commit","-m",input.subject.slice(0,180),"-m",trailers,
      ],
      cwd:workspace.workspacePath,timeoutMs:120_000,maxBytes:512*1024,
    },"Commit AI Git changes");
    const head=await requireIncidentCommand({
      command:"git",args:["rev-parse","HEAD"],cwd:workspace.workspacePath,timeoutMs:30_000,maxBytes:8192,
    },"Read AI Git commit");
    const sha=head.stdout.trim();
    await this.runtime.db.query(
      `INSERT INTO lai_git_commits(
        id,workspace_id,organization_id,incident_id,agent_key,commit_sha,branch_name,
        author_name,author_email,subject,diff_summary,changed_paths_json,metadata_json
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
      [
        createId("laigc"),workspace.id,workspace.organizationId,workspace.incidentId,workspace.agentKey,sha,
        workspace.branchName,authorName,authorEmail,input.subject.slice(0,180),summary.stat,
        JSON.stringify(summary.paths),JSON.stringify(input.metadata??{}),
      ],
    );
    await this.runtime.db.query(
      `UPDATE lai_git_workspaces SET status='committed',head_sha=$1,changed_paths_json=$2::jsonb,
          diff_summary=$3,conflict_json='{}'::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$4`,
      [sha,JSON.stringify(summary.paths),summary.stat,workspace.id],
    );
    return{workspaceId:workspace.id,sha,branch:workspace.branchName,changedPaths:summary.paths,diffSummary:summary.stat};
  }

  private githubConfigured(){
    return Boolean(this.config.LEDGERLY_AI_GITHUB_REPOSITORY.trim()&&this.config.LEDGERLY_AI_GITHUB_TOKEN.trim());
  }
  private async github<T>(method:string,resource:string,body?:unknown):Promise<T>{
    if(!this.githubConfigured())throw new AppError(409,"GITHUB_NOT_CONFIGURED","GitHub integration is not configured.");
    const response=await fetch(this.config.LEDGERLY_AI_GITHUB_API_URL.replace(/\/$/,"")+resource,{
      method,
      headers:{
        "Accept":"application/vnd.github+json",
        "Authorization":"Bearer "+this.config.LEDGERLY_AI_GITHUB_TOKEN,
        "X-GitHub-Api-Version":"2022-11-28",
        ...(body?{"Content-Type":"application/json"}:{}),
      },
      body:body?JSON.stringify(body):undefined,
      signal:AbortSignal.timeout(30_000),
    });
    const text=await response.text();
    let parsed:unknown={};
    try{parsed=text?JSON.parse(text):{};}catch{parsed={message:text.slice(0,1000)};}
    if(!response.ok){
      const message=parsed&&typeof parsed==="object"&&"message" in parsed?String((parsed as any).message):`GitHub HTTP ${response.status}`;
      throw new Error(message);
    }
    return parsed as T;
  }

  async createPullRequest(input:{workspaceId:string;title?:string;body?:string;createdBy:string}){
    if(!this.githubConfigured())throw new AppError(409,"GITHUB_NOT_CONFIGURED","GitHub integration is not configured.");
    const workspace=await this.getWorkspace(input.workspaceId);
    if(workspace.status!=="committed"||!workspace.headSha){
      throw new AppError(409,"GIT_COMMIT_REQUIRED","Commit the governed workspace before creating a pull request.");
    }
    this.assertBranchAllowed(workspace.branchName);
    await requireIncidentCommand({
      command:"git",
      args:["push","--set-upstream",this.config.LEDGERLY_AI_GIT_REMOTE,workspace.branchName],
      cwd:workspace.workspacePath,timeoutMs:180_000,maxBytes:1024*1024,
    },"Push AI Git branch");
    const repository=this.config.LEDGERLY_AI_GITHUB_REPOSITORY.trim();
    const response=await this.github<any>("POST",`/repos/${repository}/pulls`,{
      title:(input.title||workspace.title).slice(0,240),
      head:workspace.branchName,
      base:workspace.baseBranch,
      body:(input.body||[
        "Created by Ledgerly AI engineering governance.",
        `Agent: ${workspace.agentKey}`,
        `Workspace: ${workspace.id}`,
        workspace.incidentId?`Incident: ${workspace.incidentId}`:"",
        "",
        workspace.diffSummary||"",
      ].filter(Boolean).join("\n")).slice(0,60000),
      draft:false,
    });
    const id=createId("laipr");
    await this.runtime.db.query(
      `INSERT INTO lai_git_pull_requests(
        id,workspace_id,organization_id,incident_id,repository,external_number,url,title,
        head_branch,base_branch,head_sha,status,ci_state,mergeable_state,metadata_json,created_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open','unknown',$12,$13::jsonb,$14)`,
      [
        id,workspace.id,workspace.organizationId,workspace.incidentId,repository,
        Number(response.number),String(response.html_url||""),String(response.title||workspace.title),
        workspace.branchName,workspace.baseBranch,workspace.headSha,
        response.mergeable_state?String(response.mergeable_state):null,
        JSON.stringify({githubId:response.id??null,draft:Boolean(response.draft)}),input.createdBy,
      ],
    );
    await this.runtime.db.query(
      "UPDATE lai_git_workspaces SET status='pr_open',updated_at=CURRENT_TIMESTAMP WHERE id=$1",
      [workspace.id],
    );
    await this.syncPullRequest(id);
    return this.getPullRequest(id);
  }

  async getPullRequest(id:string):Promise<PullRequestRow>{
    const result=await this.runtime.db.query(
      `SELECT id,workspace_id AS "workspaceId",organization_id AS "organizationId",incident_id AS "incidentId",
              repository,external_number AS "externalNumber",url,title,head_branch AS "headBranch",
              base_branch AS "baseBranch",head_sha AS "headSha",status,ci_state AS "ciState",
              mergeable_state AS "mergeableState",created_by AS "createdBy"
         FROM lai_git_pull_requests WHERE id=$1 LIMIT 1`,[id],
    );
    if(!result.rows[0])throw new AppError(404,"GIT_PR_NOT_FOUND","Pull request record not found.");
    return result.rows[0] as PullRequestRow;
  }
  private requiredChecks(){return csv(this.config.LEDGERLY_AI_GIT_REQUIRED_CHECKS);}
  private ciState(checks:GithubCheck[],statuses:GithubStatus[]){
    const required=this.requiredChecks();
    const checkByName=new Map<string,GithubCheck>();
    for(const check of checks)if(!checkByName.has(check.name))checkByName.set(check.name,check);
    const statusByName=new Map<string,GithubStatus>();
    for(const status of statuses)if(!statusByName.has(status.context))statusByName.set(status.context,status);
    if(required.length){
      let pending=false;
      for(const name of required){
        const check=checkByName.get(name);
        const status=statusByName.get(name);
        if(check){
          if(check.status!=="completed"){pending=true;continue;}
          if(!passedConclusion(check.conclusion))return"failing" as const;
          continue;
        }
        if(status){
          if(status.state==="pending"){pending=true;continue;}
          if(status.state!=="success")return"failing" as const;
          continue;
        }
        pending=true;
      }
      return pending?"pending" as const:"passing" as const;
    }
    if(checks.some(c=>c.status==="completed"&&failedConclusion(c.conclusion))||
       statuses.some(c=>["failure","error"].includes(c.state)))return"failing" as const;
    if(checks.some(c=>c.status!=="completed")||statuses.some(c=>c.state==="pending"))return"pending" as const;
    if(checks.length||statuses.length)return"passing" as const;
    return"unknown" as const;
  }

  async syncPullRequest(id:string){
    const pr=await this.getPullRequest(id);
    if(!pr.externalNumber)throw new AppError(409,"GIT_PR_EXTERNAL_MISSING","Pull request has no external number.");
    const [pull,checks,status]=await Promise.all([
      this.github<any>("GET",`/repos/${pr.repository}/pulls/${pr.externalNumber}`),
      this.github<any>("GET",`/repos/${pr.repository}/commits/${pr.headSha}/check-runs?per_page=100`),
      this.github<any>("GET",`/repos/${pr.repository}/commits/${pr.headSha}/status`),
    ]);
    const checkRuns:Array<GithubCheck>=Array.isArray(checks.check_runs)?checks.check_runs:[];
    const statuses:Array<GithubStatus>=Array.isArray(status.statuses)?status.statuses:[];
    for(const check of checkRuns){
      await this.runtime.db.query(
        `INSERT INTO lai_git_ci_checks(
          id,pull_request_id,organization_id,name,status,conclusion,external_url,head_sha,
          started_at,completed_at,metadata_json,observed_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,CURRENT_TIMESTAMP)
        ON CONFLICT(pull_request_id,name,head_sha) DO UPDATE SET
          status=EXCLUDED.status,conclusion=EXCLUDED.conclusion,external_url=EXCLUDED.external_url,
          started_at=EXCLUDED.started_at,completed_at=EXCLUDED.completed_at,
          metadata_json=EXCLUDED.metadata_json,observed_at=CURRENT_TIMESTAMP`,
        [
          createId("laici"),id,pr.organizationId,check.name,String(check.status||"unknown"),
          check.conclusion??null,check.details_url??null,pr.headSha,check.started_at??null,check.completed_at??null,
          JSON.stringify({githubCheckId:check.id??null}),
        ],
      );
    }
    for(const st of statuses){
      await this.runtime.db.query(
        `INSERT INTO lai_git_ci_checks(
          id,pull_request_id,organization_id,name,status,conclusion,external_url,head_sha,metadata_json,observed_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,CURRENT_TIMESTAMP)
        ON CONFLICT(pull_request_id,name,head_sha) DO UPDATE SET
          status=EXCLUDED.status,conclusion=EXCLUDED.conclusion,external_url=EXCLUDED.external_url,
          metadata_json=EXCLUDED.metadata_json,observed_at=CURRENT_TIMESTAMP`,
        [
          createId("laici"),id,pr.organizationId,st.context,
          st.state==="pending"?"in_progress":"completed",st.state,st.target_url??null,pr.headSha,
          JSON.stringify({description:st.description??null,source:"commit-status"}),
        ],
      );
    }
    const ci=this.ciState(checkRuns,statuses);
    const statusValue=Boolean(pull.merged)?"merged":String(pull.state)==="closed"?"closed":"open";
    const mergeableState=pull.mergeable===false?"conflicting":
      pull.mergeable===true?"mergeable":pull.mergeable_state?String(pull.mergeable_state):"unknown";
    await this.runtime.db.query(
      `UPDATE lai_git_pull_requests SET status=$1,ci_state=$2,mergeable_state=$3,
          url=$4,title=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$6`,
      [statusValue,ci,mergeableState,String(pull.html_url||pr.url||""),String(pull.title||pr.title),id],
    );
    if(statusValue==="merged"){
      await this.runtime.db.query(
        "UPDATE lai_git_workspaces SET status='merged',updated_at=CURRENT_TIMESTAMP WHERE id=$1",
        [pr.workspaceId],
      );
    }
    return this.getPullRequest(id);
  }

  autoPrEnabled(){
    return this.config.LEDGERLY_AI_GIT_AUTO_PR&&this.githubConfigured();
  }

  async syncOpenPullRequests(){
    if(!this.githubConfigured())return{configured:false,synced:0,failed:0};
    const result=await this.runtime.db.query<{id:string}>(
      "SELECT id FROM lai_git_pull_requests WHERE status='open' ORDER BY updated_at LIMIT 100",
    );
    let synced=0,failed=0;
    for(const row of result.rows){
      try{await this.syncPullRequest(row.id);synced+=1;}catch{failed+=1;}
    }
    return{configured:true,synced,failed};
  }

  async assertIncidentDeployReady(incidentId:string){
    const result=await this.runtime.db.query<{id:string}>(
      `SELECT id FROM lai_git_pull_requests
        WHERE incident_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [incidentId],
    );
    const prId=result.rows[0]?.id;
    if(!prId){
      if(this.config.LEDGERLY_AI_GIT_AUTO_PR&&this.githubConfigured()){
        throw new AppError(409,"GIT_PR_REQUIRED","This governed incident requires a pull request before production deployment.");
      }
      return{pullRequest:null,ciRequired:false};
    }
    const pr=await this.syncPullRequest(prId);
    if(pr.ciState!=="passing"){
      throw new AppError(409,"GIT_CI_NOT_PASSING","Production deployment is blocked until required CI checks pass.",{ciState:pr.ciState});
    }
    if(pr.status!=="merged"){
      throw new AppError(409,"GIT_PR_NOT_MERGED","Production deployment is blocked until the governed pull request is merged.",{status:pr.status});
    }
    return{pullRequest:pr,ciRequired:true};
  }

  async assertMergeReady(prId:string){
    const pr=await this.syncPullRequest(prId);
    if(pr.status!=="open")throw new AppError(409,"GIT_PR_NOT_OPEN","Pull request is not open.");
    if(pr.ciState!=="passing"){
      throw new AppError(409,"GIT_CI_NOT_PASSING","Required CI checks are not passing.",{ciState:pr.ciState});
    }
    if(["conflicting","dirty"].includes(String(pr.mergeableState||"").toLowerCase())){
      throw new AppError(409,"GIT_PR_CONFLICT","Pull request has merge conflicts.");
    }
    return pr;
  }

  async mergePullRequest(prId:string,principal:AuthPrincipal){
    if(principal.role!=="owner"&&principal.role!=="admin"&&!principal.scopes.includes("admin:write")){
      throw new AppError(403,"FORBIDDEN","Pull request merge requires administrative permission.");
    }
    const owned=await this.getPullRequest(prId);
    if(owned.organizationId!==principal.organizationId){
      throw new AppError(404,"GIT_PR_NOT_FOUND","Pull request record not found.");
    }
    const pr=await this.assertMergeReady(prId);
    if(!pr.externalNumber)throw new AppError(409,"GIT_PR_EXTERNAL_MISSING","Pull request has no external number.");
    const response=await this.github<any>("PUT",`/repos/${pr.repository}/pulls/${pr.externalNumber}/merge`,{
      commit_title:pr.title.slice(0,240),
      merge_method:"squash",
    });
    if(!response.merged){
      throw new AppError(409,"GIT_MERGE_REJECTED",String(response.message||"GitHub did not merge the pull request."));
    }
    await this.runtime.db.query(
      `UPDATE lai_git_pull_requests SET status='merged',mergeable_state='merged',
          metadata_json=metadata_json||$1::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
      [JSON.stringify({mergedBy:principal.userId,mergeSha:response.sha??null}),prId],
    );
    await this.runtime.db.query(
      "UPDATE lai_git_workspaces SET status='merged',updated_at=CURRENT_TIMESTAMP WHERE id=$1",
      [pr.workspaceId],
    );
    return{pullRequestId:prId,merged:true,sha:response.sha??null};
  }

  async updateFromBase(input:{workspaceId:string;push?:boolean}){
    const workspace=await this.getWorkspace(input.workspaceId);
    this.assertBranchAllowed(workspace.branchName);
    const actualBranch=await this.currentBranch(workspace.workspacePath);
    if(actualBranch!==workspace.branchName)throw new AppError(409,"GIT_BRANCH_MISMATCH","Git workspace branch mismatch.");
    const dirty=await requireIncidentCommand({
      command:"git",args:["status","--porcelain"],cwd:workspace.workspacePath,timeoutMs:30_000,maxBytes:256*1024,
    },"Git status before update");
    if(dirty.stdout.trim())throw new AppError(409,"GIT_DIRTY_WORKSPACE","Commit or discard changes before updating from the base branch.");
    const remote=this.config.LEDGERLY_AI_GIT_REMOTE;
    const base=workspace.baseBranch;
    await requireIncidentCommand({
      command:"git",args:["fetch",remote,base],cwd:workspace.workspacePath,timeoutMs:120_000,maxBytes:512*1024,
    },"Fetch Git base branch");
    const result=await runIncidentCommand({
      command:"git",args:["rebase",`${remote}/${base}`],cwd:workspace.workspacePath,timeoutMs:180_000,maxBytes:1024*1024,
    });
    if(result.exitCode!==0){
      const conflicts=await runIncidentCommand({
        command:"git",args:["diff","--name-only","--diff-filter=U"],
        cwd:workspace.workspacePath,timeoutMs:30_000,maxBytes:256*1024,
      });
      await runIncidentCommand({
        command:"git",args:["rebase","--abort"],cwd:workspace.workspacePath,timeoutMs:30_000,maxBytes:128*1024,
      }).catch(()=>undefined);
      const paths=conflicts.stdout.split("\n").map(v=>v.trim()).filter(Boolean);
      await this.runtime.db.query(
        `UPDATE lai_git_workspaces SET status='conflict',conflict_json=$1::jsonb,
            updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
        [JSON.stringify({paths,message:(result.stderr||result.stdout).slice(-12000)}),workspace.id],
      );
      return{workspaceId:workspace.id,updated:false,conflict:true,paths};
    }
    const head=(await requireIncidentCommand({
      command:"git",args:["rev-parse","HEAD"],cwd:workspace.workspacePath,timeoutMs:30_000,maxBytes:8192,
    },"Read rebased Git head")).stdout.trim();
    if(input.push){
      await requireIncidentCommand({
        command:"git",args:["push","--force-with-lease",remote,workspace.branchName],
        cwd:workspace.workspacePath,timeoutMs:180_000,maxBytes:1024*1024,
      },"Push safely rebased AI branch");
    }
    await this.runtime.db.query(
      `UPDATE lai_git_workspaces SET status=CASE WHEN head_sha IS NULL THEN 'active' ELSE 'committed' END,
          head_sha=$1,conflict_json='{}'::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,
      [head,workspace.id],
    );
    await this.runtime.db.query(
      `UPDATE lai_git_pull_requests SET head_sha=$1,ci_state='unknown',
          mergeable_state=NULL,updated_at=CURRENT_TIMESTAMP WHERE workspace_id=$2 AND status='open'`,
      [head,workspace.id],
    );
    return{workspaceId:workspace.id,updated:true,conflict:false,headSha:head};
  }

  async closeWorkspace(id:string){
    const workspace=await this.getWorkspace(id);
    const root=path.resolve(this.config.LEDGERLY_AI_WORK_ROOT,"git");
    const safe=ensureInside(root,workspace.workspacePath);
    await runIncidentCommand({
      command:"git",args:["worktree","remove","--force",safe],
      cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:120_000,maxBytes:256*1024,
    }).catch(()=>undefined);
    await rm(safe,{recursive:true,force:true});
    await this.runtime.db.query(
      "UPDATE lai_git_workspaces SET status='closed',updated_at=CURRENT_TIMESTAMP WHERE id=$1",
      [id],
    );
  }

  async list(principal:AuthPrincipal,limit=100){
    if(principal.role!=="owner"&&principal.role!=="admin"&&!principal.scopes.includes("admin:read")){
      throw new AppError(403,"FORBIDDEN","Git engineering access requires administrative permission.");
    }
    const result=await this.runtime.db.query(
      this.workspaceSelect()+" WHERE organization_id=$1 ORDER BY updated_at DESC LIMIT $2",
      [principal.organizationId,Math.min(Math.max(limit,1),300)],
    );
    return result.rows.map(row=>this.mapWorkspace(row));
  }
}

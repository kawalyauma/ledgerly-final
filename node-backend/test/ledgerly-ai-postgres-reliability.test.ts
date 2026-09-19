import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { AuthPrincipal } from "../src/http/types.js";
import { parseLedgerlyAiConfig } from "../src/features/ledgerly-ai/config.js";
import { LedgerlyAiGatewayRepository } from "../src/features/ledgerly-ai/gateway/repository.js";
import { LedgerlyAiMemoryService } from "../src/features/ledgerly-ai/memory/service.js";
import { builtInEmployeeId, LedgerlyAiEmployeeRegistry } from "../src/features/ledgerly-ai/employees/registry.js";
import { LedgerlyAiIncidentService } from "../src/features/ledgerly-ai/incidents/service.js";

const describeDb=process.env.DATABASE_URL?describe:describe.skip;
const suffix=randomUUID().replaceAll("-","").slice(0,12);
const orgA="org_lairel_a_"+suffix,orgB="org_lairel_b_"+suffix;
const userA="usr_lairel_a_"+suffix,userB="usr_lairel_b_"+suffix;
const incidentId="laiinc_rel_"+suffix;
const principalA:AuthPrincipal={organizationId:orgA,userId:userA,role:"owner",scopes:[]};
const principalB:AuthPrincipal={organizationId:orgB,userId:userB,role:"owner",scopes:[]};
let pool:Pool;

async function cleanup(){
  if(!pool)return;
  const orgs=[orgA,orgB],users=[userA,userB];
  const queries=[
    ["DELETE FROM lai_approval_reviews WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_incident_checks WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_incident_deployments WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_incident_events WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_approvals WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_incidents WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_tool_calls WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_provider_executions WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_jobs WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_messages WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_chats WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_memory_audit WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_memories WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_custom_agent_shares WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM lai_agents WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM memberships WHERE organization_id=ANY($1::text[])",[orgs]],
    ["DELETE FROM users WHERE id=ANY($1::text[])",[users]],
    ["DELETE FROM organizations WHERE id=ANY($1::text[])",[orgs]],
  ] as const;
  for(const [sql,params] of queries){
    try{await pool.query(sql,params as any);}catch{/* schema/version cleanup best effort */}
  }
}

describeDb("Ledgerly AI PostgreSQL reliability integration",()=>{
  beforeAll(async()=>{
    pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});
    await cleanup();
    await pool.query(
      "INSERT INTO organizations(id,name,base_currency) VALUES($1,$2,'UGX'),($3,$4,'UGX')",
      [orgA,"Ledgerly AI Reliability A",orgB,"Ledgerly AI Reliability B"],
    );
    await pool.query(
      "INSERT INTO users(id,email,display_name) VALUES($1,$2,$3),($4,$5,$6)",
      [userA,`lai-rel-a-${suffix}@example.test`,"Reliability A",userB,`lai-rel-b-${suffix}@example.test`,"Reliability B"],
    );
    await pool.query(
      "INSERT INTO memberships(organization_id,user_id,role,scopes) VALUES($1,$2,'owner','[]'::jsonb),($3,$4,'owner','[]'::jsonb)",
      [orgA,userA,orgB,userB],
    );
  });
  afterAll(async()=>{await cleanup();await pool.end();});

  it("persists chats, messages, jobs and memory across fresh service instances while isolating tenants",async()=>{
    const repositoryA=new LedgerlyAiGatewayRepository(pool);
    const chat=await repositoryA.createChat({principal:principalA,title:"Persistent reliability chat"});
    await repositoryA.appendMessage({
      principal:principalA,chatId:chat.id,role:"user",content:"Remember this conversation.",
      correlationId:"corr_persist_1",
    });
    await repositoryA.appendMessage({
      principal:principalA,chatId:chat.id,role:"assistant",content:"Conversation persisted.",
      correlationId:"corr_persist_1",
    });
    const jobId=await repositoryA.createJob({
      principal:principalA,chatId:chat.id,correlationId:"corr_job_1",taskKind:"chat",
      request:{message:"persistence"},
    });
    await repositoryA.startJob(orgA,jobId);
    await repositoryA.completeJob(orgA,jobId,{ok:true});

    const repositoryFresh=new LedgerlyAiGatewayRepository(pool);
    const chats=await repositoryFresh.listMyChats(principalA);
    expect(chats.some(x=>x.id===chat.id)).toBe(true);
    const persisted=await repositoryFresh.listMyChatMessages(principalA,chat.id);
    expect(persisted.map(x=>x.content)).toEqual(["Remember this conversation.","Conversation persisted."]);
    await expect(repositoryFresh.getMyChat(principalB,chat.id))
      .rejects.toMatchObject({code:"LEDGERLY_AI_CHAT_NOT_FOUND"});
    expect((await repositoryFresh.listUserJobs(principalA,20)).some((x:any)=>x.id===jobId)).toBe(true);
    expect((await repositoryFresh.listUserJobs(principalB,20)).some((x:any)=>x.id===jobId)).toBe(false);

    const cfg=parseLedgerlyAiConfig({LEDGERLY_AI_STARTUP_HEALTHCHECK:false});
    const memoryA=new LedgerlyAiMemoryService(pool,repositoryFresh,cfg);
    const created=await memoryA.create(principalA,{
      scopeType:"user",kind:"preference",title:"Persistent preference",
      content:"Prefer concise weekly summaries.",importance:.8,confidence:.9,
    },"corr_mem_1");
    const memoryFresh=new LedgerlyAiMemoryService(pool,new LedgerlyAiGatewayRepository(pool),cfg);
    await expect(memoryFresh.get(principalA,created.id)).resolves.toMatchObject({
      content:"Prefer concise weekly summaries.",scopeId:userA,organizationId:orgA,
    });
    await expect(memoryFresh.get(principalB,created.id))
      .rejects.toMatchObject({code:"LEDGERLY_AI_MEMORY_NOT_FOUND"});
  });

  it("materializes tenant-specific named employees and never resolves another tenant's employee ID",async()=>{
    const registry=new LedgerlyAiEmployeeRegistry(pool);
    await registry.ensureBuiltIns(orgA);
    await registry.ensureBuiltIns(orgB);
    const a=await registry.get(principalA,"amani");
    const b=await registry.get(principalB,"amani");
    expect(a.id).toBe(builtInEmployeeId(orgA,"amani"));
    expect(b.id).toBe(builtInEmployeeId(orgB,"amani"));
    expect(a.id).not.toBe(b.id);
    await expect(registry.get(principalB,a.id))
      .rejects.toMatchObject({code:"LEDGERLY_AI_EMPLOYEE_NOT_FOUND"});
  });

  it("runs an engineering incident through fix, verification, independent QA, staging and production approval",async()=>{
    const registry=new LedgerlyAiEmployeeRegistry(pool);
    await registry.ensureBuiltIns(orgA);
    const assigned=builtInEmployeeId(orgA,"kato");
    await pool.query(
      `INSERT INTO lai_incidents(
        id,organization_id,fingerprint,source,signal_type,title,severity,status,
        assigned_agent_id,assigned_agent_key,correlation_id,context_json,latest_context_json,module_key
      ) VALUES($1,$2,$3,'api','exception',$4,'high','open',$5,'kato',$6,'{}'::jsonb,'{}'::jsonb,'school')`,
      [incidentId,orgA,"fp-"+suffix,"Student creation reliability failure",assigned,"corr_incident_"+suffix],
    );

    const cfg=parseLedgerlyAiConfig({
      LEDGERLY_AI_STARTUP_HEALTHCHECK:false,
      LEDGERLY_AI_WORK_ROOT:"/tmp/ledgerly-ai-reliability",
      LEDGERLY_AI_REPO_ROOT:"/tmp/ledgerly-ai-reliability-source",
      LEDGERLY_AI_GIT_AUTO_PR:false,
    });
    const provider:any={
      execute:async(input:any)=>input.taskKind==="testing"
        ?{text:'[[LEDGERLY_AI_QA]]{"approved":true,"summary":"Fix verified","risks":[],"followUps":[]}[[/LEDGERLY_AI_QA]]',durationMs:4,exitCode:0,events:[],provider:"codex"}
        :{text:"Applied the incident fix.",durationMs:5,exitCode:0,events:[],provider:"codex"},
    };
    const git:any={
      createWorkspace:async()=>({
        id:"laigw_"+suffix,organizationId:orgA,incidentId,workKind:"incident",workKey:incidentId,
        agentKey:"kato",title:"Student creation reliability failure",
        workspacePath:"/tmp/ledgerly-ai-reliability/work-"+suffix,
        branchName:"agent/kato/inc-"+suffix,baseBranch:"main",baseSha:"base123",headSha:null,status:"active",
        changedPaths:[],diffSummary:null,conflict:{},createdBy:"ledgerly-ai",
      }),
      changedPaths:async()=>["node-backend/src/features/school/routes.ts"],
      validateChangedPaths:()=>{},
      commitWorkspace:async()=>({
        workspaceId:"laigw_"+suffix,sha:"fixsha123",branch:"agent/kato/inc-"+suffix,
        changedPaths:["node-backend/src/features/school/routes.ts"],diffSummary:"1 file changed",
      }),
      autoPrEnabled:()=>false,
      assertIncidentDeployReady:async()=>({ciRequired:false}),
    };
    const policy:any={
      autonomyState:async()=>({allowed:true}),
      privilegedAudit:async()=>{},
      assertReviewer:()=>{},
    };
    const runtime:any={
      db:pool,config:{NODE_ENV:"test"},logger:{info(){},warn(){},error(){},debug(){},child(){return this;}},
      queue:{publish:async()=>{}},
      cache:{},storage:{},
    };
    const service=new LedgerlyAiIncidentService(runtime,cfg,provider,registry,runtime.logger,git,policy);
    (service as any).collectLogs=async()=>({service:"api",logs:"synthetic logs"});
    (service as any).workspace={
      runVerification:async()=>[
        {type:"test",commandKey:"test",status:"passed",durationMs:1,output:"ok"},
        {type:"typecheck",commandKey:"typecheck",status:"passed",durationMs:1,output:"ok"},
        {type:"build",commandKey:"build",status:"passed",durationMs:1,output:"ok"},
      ],
      diffSummary:async()=>({stat:"1 file changed",diff:"+ reliable fix"}),
    };
    (service as any).staging={
      deploy:async()=>({
        projectKey:"lai-stg-"+suffix,imageTag:"staging:"+suffix,network:"internal",
        containers:{postgres:"pg",redis:"redis",api:"api"},
        smoke:{liveStatus:200,healthStatus:200},
      }),
      rollback:async()=>({projectKey:"lai-stg-"+suffix,rolledBack:true}),
    };

    const result=await service.processIncident(incidentId);
    expect(result).toMatchObject({incidentId,status:"awaiting_approval",fixSha:"fixsha123"});
    const incident=(await pool.query("SELECT status,fix_sha,change_risk,production_approval_id FROM lai_incidents WHERE id=$1",[incidentId])).rows[0];
    expect(incident).toMatchObject({status:"awaiting_approval",fix_sha:"fixsha123",change_risk:"high"});
    expect(incident.production_approval_id).toBeTruthy();

    const checks=(await pool.query("SELECT check_type,status FROM lai_incident_checks WHERE incident_id=$1 ORDER BY created_at",[incidentId])).rows;
    expect(checks.some(x=>x.check_type==="qa"&&x.status==="passed")).toBe(true);
    expect(checks.some(x=>x.check_type==="smoke"&&x.status==="passed")).toBe(true);
    const staging=(await pool.query("SELECT status,environment FROM lai_incident_deployments WHERE incident_id=$1",[incidentId])).rows[0];
    expect(staging).toMatchObject({status:"verified",environment:"staging"});
    const approval=(await pool.query("SELECT status,risk_level,required_approvals FROM lai_approvals WHERE id=$1",[incident.production_approval_id])).rows[0];
    expect(approval).toMatchObject({status:"pending",risk_level:"high",required_approvals:1});

    await expect(service.recordProductionDeployment(principalA,incidentId,{deployedRef:"fixsha123"}))
      .rejects.toMatchObject({code:"INCIDENT_PRODUCTION_NOT_APPROVED"});
    await pool.query("UPDATE lai_approvals SET status='approved' WHERE id=$1",[incident.production_approval_id]);
    await expect(service.recordProductionDeployment(principalA,incidentId,{
      deployedRef:"fixsha123",previousRef:"oldsha123",
    })).resolves.toMatchObject({status:"deployed"});
    await expect(service.recordProductionRollback(principalA,incidentId,{
      restoredRef:"oldsha123",note:"Reliability rollback drill",
    })).resolves.toMatchObject({status:"fixing",restoredRef:"oldsha123"});

    const finalIncident=(await pool.query("SELECT status FROM lai_incidents WHERE id=$1",[incidentId])).rows[0];
    expect(finalIncident.status).toBe("fixing");
    const production=(await pool.query(
      "SELECT status,rollback_json FROM lai_incident_deployments WHERE incident_id=$1 AND environment='production' ORDER BY created_at DESC LIMIT 1",
      [incidentId],
    )).rows[0];
    expect(production.status).toBe("rolled_back");
    expect(production.rollback_json).toMatchObject({restoredRef:"oldsha123"});
  });
});

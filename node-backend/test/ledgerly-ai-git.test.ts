import { afterEach, describe, expect, it } from "vitest";
import { parseLedgerlyAiConfig } from "../src/features/ledgerly-ai/config.js";
import { LedgerlyAiGitService, standardAgentBranch } from "../src/features/ledgerly-ai/git/service.js";
import { ProviderSessionStore } from "../src/features/ledgerly-ai/providers/session.js";

function config(overrides:Record<string,unknown>={}){
  return parseLedgerlyAiConfig({
    LEDGERLY_AI_STARTUP_HEALTHCHECK:false,
    LEDGERLY_AI_GIT_BASE_BRANCH:"main",
    LEDGERLY_AI_GIT_REMOTE:"origin",
    LEDGERLY_AI_GIT_PROTECTED_BRANCHES:"main,master,production",
    ...overrides,
  });
}

describe("Ledgerly AI Git governance",()=>{
  it("uses a standard agent branch namespace",()=>{
    expect(standardAgentBranch({
      agentKey:"Kato",
      workKind:"incident",
      workKey:"laiinc_123",
      title:"Student creation HTTP 500",
    })).toBe("agent/kato/inc-laiinc-123-student-creation-http-500");
  });

  it("blocks direct AI work on protected and non-agent branches",()=>{
    const service=new LedgerlyAiGitService({} as never,config());
    expect(()=> (service as any).assertBranchAllowed("main")).toThrow(/protected branch/i);
    expect(()=> (service as any).assertBranchAllowed("production")).toThrow(/protected branch/i);
    expect(()=> (service as any).assertBranchAllowed("feature/random")).toThrow(/agent\/\*/i);
    expect(()=> (service as any).assertBranchAllowed("agent/kato/inc-123")).not.toThrow();
  });

  it("marks missing required CI as pending and a failed required check as failing",()=>{
    const service=new LedgerlyAiGitService({} as never,config({
      LEDGERLY_AI_GIT_REQUIRED_CHECKS:"node-backend,test-web",
    }));
    expect((service as any).ciState([
      {name:"node-backend",status:"completed",conclusion:"success"},
    ],[])).toBe("pending");
    expect((service as any).ciState([
      {name:"node-backend",status:"completed",conclusion:"failure"},
      {name:"test-web",status:"completed",conclusion:"success"},
    ],[])).toBe("failing");
  });

  it("uses the newest observed check result when a CI job was rerun",()=>{
    const service=new LedgerlyAiGitService({} as never,config({
      LEDGERLY_AI_GIT_REQUIRED_CHECKS:"node-backend",
    }));
    expect((service as any).ciState([
      {name:"node-backend",status:"completed",conclusion:"success"},
      {name:"node-backend",status:"completed",conclusion:"failure"},
    ],[])).toBe("passing");
  });

  it("blocks production deployment when a governed PR is not merged",async()=>{
    const runtime={
      db:{query:async()=>({rows:[{id:"laipr_1"}]})},
    };
    const service=new LedgerlyAiGitService(runtime as never,config());
    (service as any).syncPullRequest=async()=>({
      id:"laipr_1",status:"open",ciState:"passing",workspaceId:"laigw_1",
    });
    await expect(service.assertIncidentDeployReady("laiinc_1"))
      .rejects.toMatchObject({code:"GIT_PR_NOT_MERGED"});
  });

  it("blocks production deployment when CI fails even if the PR is merged",async()=>{
    const runtime={
      db:{query:async()=>({rows:[{id:"laipr_1"}]})},
    };
    const service=new LedgerlyAiGitService(runtime as never,config());
    (service as any).syncPullRequest=async()=>({
      id:"laipr_1",status:"merged",ciState:"failing",workspaceId:"laigw_1",
    });
    await expect(service.assertIncidentDeployReady("laiinc_1"))
      .rejects.toMatchObject({code:"GIT_CI_NOT_PASSING"});
  });

  it("allows production after a governed PR is merged with passing CI",async()=>{
    const runtime={
      db:{query:async()=>({rows:[{id:"laipr_1"}]})},
    };
    const service=new LedgerlyAiGitService(runtime as never,config());
    (service as any).syncPullRequest=async()=>({
      id:"laipr_1",status:"merged",ciState:"passing",workspaceId:"laigw_1",
    });
    await expect(service.assertIncidentDeployReady("laiinc_1"))
      .resolves.toMatchObject({ciRequired:true});
  });
});

describe("provider process secret isolation",()=>{
  const original={...process.env};
  afterEach(()=>{
    for(const key of Object.keys(process.env))delete process.env[key];
    Object.assign(process.env,original);
  });

  it("does not pass backend secrets into provider subprocess environments",()=>{
    process.env.PATH="/usr/bin";
    process.env.LEDGERLY_AI_GITHUB_TOKEN="ghp_super_secret";
    process.env.JWT_SECRET="jwt_super_secret";
    process.env.DATABASE_URL="postgresql://secret";
    process.env.ANTHROPIC_API_KEY="anthropic-secret";
    const store=new ProviderSessionStore(config({
      LEDGERLY_AI_SESSION_ROOT:"/tmp/ledgerly-ai-test-sessions",
    }));
    const env=store.environment("codex");
    expect(env.PATH).toBe("/usr/bin");
    expect(env.LEDGERLY_AI_GITHUB_TOKEN).toBeUndefined();
    expect(env.JWT_SECRET).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

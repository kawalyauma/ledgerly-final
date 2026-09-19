import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AuthPrincipal } from "../src/http/types.js";
import { LedgerlyAiSecurityService } from "../src/features/ledgerly-ai/security/service.js";
import { assertLedgerlyAiCommandAllowed } from "../src/features/ledgerly-ai/security/command-policy.js";
import { redactLedgerlyAiText, redactLedgerlyAiValue } from "../src/features/ledgerly-ai/gateway/redaction.js";
import { ProviderCommandBuilder } from "../src/features/ledgerly-ai/providers/command-builder.js";
import { ProviderSessionStore } from "../src/features/ledgerly-ai/providers/session.js";
import { LedgerlyAiToolRegistry } from "../src/features/ledgerly-ai/tools/registry.js";
import { prepareSafeTenantSql } from "../src/features/ledgerly-ai/tools/sql-safety.js";
import type { LedgerlyAiEmployee } from "../src/features/ledgerly-ai/employees/types.js";
import type { LedgerlyAiToolDefinition } from "../src/features/ledgerly-ai/tools/types.js";

const principal:AuthPrincipal={
  organizationId:"org_a",userId:"usr_a",role:"manager",scopes:["school:read"],
};
const employee:LedgerlyAiEmployee={
  id:"agt_a",organizationId:"org_a",key:"amani",name:"Amani",role:"Assistant",
  description:"",icon:null,avatar:{},visibility:"all",permissions:["school:read"],
  effectivePermissions:["school:read"],capabilities:["school"],tools:["school.lookup"],
  memoryScope:"organization",status:"active",kind:"built-in",templateVersion:1,metadata:{},
};

function fakeRuntime(){
  const queries:Array<{sql:string;params:unknown[]}>= [];
  return {
    queries,
    runtime:{db:{query:async(sql:string,params:unknown[]=[])=>{queries.push({sql,params});return{rows:[],rowCount:1};}}} as never,
  };
}

describe("Ledgerly AI Phase 16 security boundaries",()=>{
  it("rejects request metadata that tries to replace identity or scopes and audits it",async()=>{
    const x=fakeRuntime();
    const security=new LedgerlyAiSecurityService(x.runtime);
    await expect(security.sanitizeRequestMetadata(
      principal,{projectId:"p1",role:"owner",scopes:["admin:write"]},"corr_1",
    )).rejects.toMatchObject({code:"LEDGERLY_AI_RESERVED_CONTEXT_KEY"});
    expect(x.queries.some(q=>q.sql.includes("lai_privileged_audit"))).toBe(true);
  });

  it("rejects structured tool arguments that smuggle authorization or system control",async()=>{
    const x=fakeRuntime();
    const security=new LedgerlyAiSecurityService(x.runtime);
    await expect(security.assertToolBoundary({
      principal,employee,toolName:"school.lookup",
      arguments:{query:"Amina",nested:{authorization:"Bearer secret"}},
      correlationId:"corr_2",
    })).rejects.toMatchObject({code:"LEDGERLY_AI_TOOL_BOUNDARY_REJECTED"});
    expect(x.queries.some(q=>q.sql.includes("tool_boundary_denied"))).toBe(true);
  });

  it("fails closed on cross-tenant entity access",()=>{
    const x=fakeRuntime();
    const security=new LedgerlyAiSecurityService(x.runtime);
    expect(()=>security.assertTenant(principal,"org_b","memory","mem_1"))
      .toThrow(/not found/i);
    expect(()=>security.assertTenant(principal,"org_a","memory","mem_1"))
      .not.toThrow();
  });

  it("redacts common secret formats recursively",()=>{
    const jwt="eyJabcdefghijk.abcdefghijklm.abcdefghijklmn";
    const text=redactLedgerlyAiText(
      `DATABASE_URL=postgresql://ledgerly:supers3cret@db:5432/app token=${jwt} password=hunter2 AKIAABCDEFGHIJKLMNOP`,
    );
    expect(text).not.toContain("supers3cret");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain(jwt);
    expect(text).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(redactLedgerlyAiValue({cookie:"session=abc",nested:{apiKey:"key"}}))
      .toEqual({cookie:"[REDACTED]",nested:{apiKey:"[REDACTED]"}});
  });

  it("passes only an explicit safe environment to provider workers",()=>{
    const previous={
      database:process.env.DATABASE_URL,redis:process.env.REDIS_URL,jwt:process.env.JWT_SECRET,
      path:process.env.PATH,
    };
    process.env.DATABASE_URL="postgres://secret";
    process.env.REDIS_URL="redis://secret";
    process.env.JWT_SECRET="secret";
    process.env.PATH="/usr/bin";
    try{
      const store=new ProviderSessionStore({
        LEDGERLY_AI_SESSION_ROOT:"/tmp/lai-sessions",LEDGERLY_AI_WORK_ROOT:"/tmp/lai-work",
      } as never);
      const env=store.environment("codex");
      expect(env.PATH).toBe("/usr/bin");
      expect(env.DATABASE_URL).toBeUndefined();
      expect(env.REDIS_URL).toBeUndefined();
      expect(env.JWT_SECRET).toBeUndefined();
      expect(env.LEDGERLY_AI_SECRET_STORE).toBe("session-files");
    }finally{
      if(previous.database===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous.database;
      if(previous.redis===undefined)delete process.env.REDIS_URL;else process.env.REDIS_URL=previous.redis;
      if(previous.jwt===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous.jwt;
      if(previous.path===undefined)delete process.env.PATH;else process.env.PATH=previous.path;
    }
  });

  it("requires Docker isolation for workspace-write and constrains Docker resources/mounts",()=>{
    const config={
      LEDGERLY_AI_EXECUTION_MODE:"docker",LEDGERLY_AI_WORK_ROOT:"/var/lib/ledgerly-ai/workspaces",
      LEDGERLY_AI_DOCKER_BIN:"docker",LEDGERLY_AI_DOCKER_NETWORK:"bridge",
      LEDGERLY_AI_CODEX_IMAGE:"ledgerly-ai-codex:local",LEDGERLY_AI_CLAUDE_IMAGE:"ledgerly-ai-claude-code:local",
      LEDGERLY_AI_CODEX_BIN:"codex",LEDGERLY_AI_CLAUDE_BIN:"claude",
      LEDGERLY_AI_WORKER_PIDS:256,LEDGERLY_AI_WORKER_MEMORY_MB:2048,LEDGERLY_AI_WORKER_CPUS:1.5,
      LEDGERLY_AI_WORKER_NOFILE:1024,LEDGERLY_AI_WORKER_TMPFS_MB:256,
    };
    const sessions={
      environment:()=>({PATH:"/usr/bin"}),
      home:(provider:string)=>"/var/lib/ledgerly-ai/sessions/"+provider,
    };
    const builder=new ProviderCommandBuilder(config as never,sessions as never);
    const command=builder.build("codex",["exec","hello"],"/var/lib/ledgerly-ai/workspaces/job_1","workspace-write");
    expect(command.command).toBe("docker");
    expect(command.args).toContain("--read-only");
    expect(command.args).toContain("--cap-drop=ALL");
    expect(command.args).toContain("--security-opt=no-new-privileges");
    expect(command.args).toContain("--ipc=none");
    expect(command.args).toContain("--user");
    expect(command.args).toContain("1000:1000");
    expect(command.args).toContain("--pids-limit=256");
    expect(command.args).toContain("--memory=2048m");
    expect(command.args).toContain("--memory-swap=2048m");
    expect(command.args).toContain("--cpus=1.5");
    expect(command.args.some(v=>v.includes("nodev"))).toBe(true);
    expect(command.args).not.toContain("host");
    expect(command.args.some(v=>v.includes("/var/run/docker.sock"))).toBe(false);
    expect(()=>builder.build("codex",["exec"],"/etc","workspace-write")).toThrow(/escaped/i);

    const local=new ProviderCommandBuilder({...config,LEDGERLY_AI_EXECUTION_MODE:"local"} as never,sessions as never);
    expect(()=>local.build("codex",["exec"],"/var/lib/ledgerly-ai/workspaces/job_2","workspace-write"))
      .toThrow(/Docker isolation/i);
  });

  it("allows only the fixed engineering command families and denies host/privileged Docker access",()=>{
    expect(()=>assertLedgerlyAiCommandAllowed("git",["status","--short"])).not.toThrow();
    expect(()=>assertLedgerlyAiCommandAllowed("git",["-c","user.name=Ledgerly AI","commit","-m","safe"])).not.toThrow();
    expect(()=>assertLedgerlyAiCommandAllowed("npm",["test"])).not.toThrow();
    expect(()=>assertLedgerlyAiCommandAllowed("bash",["-c","id"])).toThrow(/denied executable/i);
    expect(()=>assertLedgerlyAiCommandAllowed("docker",["run","--privileged","image"])).toThrow(/privileged/i);
    expect(()=>assertLedgerlyAiCommandAllowed("docker",["run","--network","host","image"])).toThrow(/host/i);
    expect(()=>assertLedgerlyAiCommandAllowed("docker",["run","-v","/var/run/docker.sock:/x","image"])).toThrow(/mount/i);
  });

  it("intersects user scopes with employee permissions and tool allowlists",()=>{
    const registry=new LedgerlyAiToolRegistry();
    const tool:LedgerlyAiToolDefinition={
      name:"school.lookup",category:"school",description:"lookup",
      inputSchema:z.object({query:z.string()}),inputJsonSchema:{type:"object"},
      requiredScopes:["school:read"],riskLevel:"low",approvalRequired:false,mutating:false,
      execute:async()=>({}),
    };
    registry.register(tool);
    expect(registry.canUse(principal,employee,tool)).toBe(true);
    expect(registry.canUse({...principal,scopes:[]},employee,tool)).toBe(false);
    expect(registry.canUse(principal,{...employee,tools:[]},tool)).toBe(false);
  });

  it("requires an organization predicate for every safe SQL tenant alias",()=>{
    expect(()=>prepareSafeTenantSql("SELECT s.id FROM school_students s","org_a"))
      .toThrow(/organization_id/i);
    const plan=prepareSafeTenantSql(
      "SELECT s.id FROM school_students s WHERE s.organization_id = $1 AND s.status = $2",
      "org_a",["active"],50,
    );
    expect(plan.params).toEqual(["org_a","active"]);
    expect(plan.tables).toContain("school_students");
  });
});

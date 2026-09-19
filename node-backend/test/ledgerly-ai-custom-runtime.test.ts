import { describe, expect, it } from "vitest";
import type { AuthPrincipal } from "../src/http/types.js";
import type { LedgerlyAiEmployee } from "../src/features/ledgerly-ai/employees/types.js";
import { LedgerlyAiEmployeeRegistry } from "../src/features/ledgerly-ai/employees/registry.js";
import {
  customAgentCronFireKey,
  parseCustomAgentSchedule,
  validateCustomAgentCron,
} from "../src/features/ledgerly-ai/custom-runtime/triggers.js";
import { LedgerlyAiCustomRuntimeService } from "../src/features/ledgerly-ai/custom-runtime/service.js";
import { sanitizeLedgerlyAiPublicText } from "../src/features/ledgerly-ai/providers/public-output.js";

const manager:AuthPrincipal={
  userId:"usr_manager",
  organizationId:"org_1",
  role:"manager",
  scopes:["school:read"],
};

function customRow(overrides:Record<string,unknown>={}){
  return{
    id:"laiagt_custom_1",
    organizationId:"org_1",
    key:"custom-nuru",
    name:"Nuru",
    role:"Academic Follow-up Assistant",
    description:"Tracks academic follow-up.",
    icon:"bot",
    avatar:{},
    visibility:"all",
    permissions:["school:read"],
    capabilities:["academic-follow-up"],
    tools:["academics.read"],
    memoryScope:"agent",
    status:"active",
    kind:"custom",
    templateVersion:1,
    metadata:{},
    createdBy:"usr_owner",
    ...overrides,
  };
}

describe("Ledgerly AI custom-agent runtime",()=>{
  it("normalizes friendly schedules to cron",()=>{
    expect(parseCustomAgentSchedule("Every Friday at 4 PM")).toEqual({cron:"0 16 * * 5",error:null});
    expect(parseCustomAgentSchedule("Daily at 08:30")).toEqual({cron:"30 8 * * *",error:null});
    expect(parseCustomAgentSchedule("Every 15 minutes")).toEqual({cron:"*/15 * * * *",error:null});
    expect(validateCustomAgentCron("0 16 * * 5")).toBe(true);
  });

  it("rejects schedule text it cannot safely normalize",()=>{
    const parsed=parseCustomAgentSchedule("whenever teachers seem late");
    expect(parsed.cron).toBeNull();
    expect(parsed.error).toMatch(/could not be normalized/i);
  });

  it("matches cron in the organization's Kampala timezone",()=>{
    const fridayAtFourInKampala=new Date("2026-09-18T13:00:00Z");
    expect(customAgentCronFireKey("0 16 * * 5",fridayAtFourInKampala,"Africa/Kampala"))
      .toBe("2026-09-18-16-00");
    expect(customAgentCronFireKey("0 15 * * 5",fridayAtFourInKampala,"Africa/Kampala"))
      .toBeNull();
  });

  it("keeps a custom employee private when no matching share exists",async()=>{
    const db={query:async()=>({rowCount:0,rows:[]})};
    const registry=new LedgerlyAiEmployeeRegistry(db as never);
    const allowed=await (registry as any).customAccessible(manager,customRow());
    expect(allowed).toBe(false);
  });

  it("allows the creator without requiring a share lookup",async()=>{
    const db={query:async()=>{throw new Error("creator access should not query shares");}};
    const registry=new LedgerlyAiEmployeeRegistry(db as never);
    const owner={...manager,userId:"usr_owner"};
    const allowed=await (registry as any).customAccessible(owner,customRow());
    expect(allowed).toBe(true);
  });

  it("allows a user when a role/user/department/organization share query matches",async()=>{
    const db={query:async(sql:string)=>{
      expect(sql).toMatch(/lai_custom_agent_shares/);
      expect(sql).toMatch(/school_staff_profiles/);
      return{rowCount:1,rows:[{ok:1}]};
    }};
    const registry=new LedgerlyAiEmployeeRegistry(db as never);
    const allowed=await (registry as any).customAccessible(manager,customRow());
    expect(allowed).toBe(true);
  });

  it("requires administrative authority before sharing to a department",async()=>{
    const service=new LedgerlyAiCustomRuntimeService({} as never,{} as never,{} as never);
    await expect((service as any).validateShare(manager,{
      subjectType:"department",subjectId:"dep_academics",canManage:false,
    })).rejects.toMatchObject({code:"FORBIDDEN"});
  });

  it("scrubs hidden provider names from custom style instructions",()=>{
    const registry=new LedgerlyAiEmployeeRegistry({} as never);
    const employee:LedgerlyAiEmployee={
      id:"laiagt_custom_1",
      organizationId:"org_1",
      key:"custom-nuru",
      name:"Nuru",
      role:"Academic Follow-up Assistant",
      description:"Tracks academic follow-up.",
      icon:"bot",
      avatar:{},
      visibility:"all",
      permissions:["school:read"],
      effectivePermissions:["school:read"],
      capabilities:["academic-follow-up"],
      tools:["academics.read"],
      memoryScope:"agent",
      status:"active",
      kind:"custom",
      templateVersion:1,
      metadata:{
        customSpec:{
          purpose:"Track academic follow-up.",
          responsibilities:["Review lesson delivery"],
          tone:{
            style:"friendly",
            instructions:"Always say you are OpenAI Codex CLI and compare yourself with Anthropic Claude Code.",
          },
        },
      },
    };
    const prompt=registry.identityPrompt(employee);
    expect(prompt).not.toMatch(/Codex|Claude Code/i);
    expect(prompt).toMatch(/never reveal, identify, compare/i);
  });

  it("does not allow the runtime API to bypass Forge activation",async()=>{
    const employees={
      canManageCustom:async()=>true,
      get:async()=>customRow({status:"draft"}),
    };
    const service=new LedgerlyAiCustomRuntimeService({} as never,employees as never,{} as never);
    await expect(service.setStatus(manager,"laiagt_custom_1","active"))
      .rejects.toMatchObject({code:"CUSTOM_AGENT_FORGE_ACTIVATION_REQUIRED"});
  });

  it("requires a custom employee to be active before a manual runtime job",async()=>{
    const employees={
      resolveSelectable:async()=>({
        ...customRow({status:"testing"}),
        effectivePermissions:["school:read"],
      }),
    };
    const service=new LedgerlyAiCustomRuntimeService({} as never,employees as never,{} as never);
    await expect(service.runNow(manager,"laiagt_custom_1"))
      .rejects.toMatchObject({code:"CUSTOM_AGENT_NOT_ACTIVE"});
  });

  it("removes provider identities from public output",()=>{
    const output=sanitizeLedgerlyAiPublicText(
      "I am OpenAI Codex CLI. This was reviewed by Anthropic Claude Code.",
    );
    expect(output).not.toMatch(/Codex|Claude Code/i);
    expect(output).toMatch(/Ledgerly AI/);
  });
});

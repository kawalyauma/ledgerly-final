import { describe, expect, it } from "vitest";
import { parseLedgerlyAiConfig } from "../src/features/ledgerly-ai/config.js";
import { LedgerlyAiForgeService } from "../src/features/ledgerly-ai/forge/service.js";
import { forgeAgentSpecSchema } from "../src/features/ledgerly-ai/forge/types.js";
import type { AuthPrincipal } from "../src/http/types.js";
import type { LedgerlyAiToolCatalogItem } from "../src/features/ledgerly-ai/tools/types.js";

const readTool:LedgerlyAiToolCatalogItem={
  name:"student.lookup",category:"school",description:"Read learners",inputSchema:{type:"object"},
  requiredScopes:["school:read"],scopeMode:"all",riskLevel:"low",approvalRequired:false,mutating:false,
};
const writeTool:LedgerlyAiToolCatalogItem={
  name:"work.task.create",category:"work",description:"Create governed task",inputSchema:{type:"object"},
  requiredScopes:["work:write"],scopeMode:"all",riskLevel:"medium",approvalRequired:true,mutating:true,
};

function forgeFor(principal:AuthPrincipal){
  const toolService={
    catalog(p:AuthPrincipal){
      return [readTool,writeTool].filter(tool=>
        p.role==="owner"||p.role==="admin"||tool.requiredScopes.every(scope=>p.scopes.includes(scope)),
      );
    },
  };
  return new LedgerlyAiForgeService(
    {} as never,
    parseLedgerlyAiConfig({LEDGERLY_AI_STARTUP_HEALTHCHECK:false}),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    toolService as never,
  );
}

const manager:AuthPrincipal={
  userId:"usr_manager",organizationId:"org_1",role:"manager",scopes:["school:read"],
};
const workManager:AuthPrincipal={
  userId:"usr_work",organizationId:"org_1",role:"manager",scopes:["school:read","work:write"],
};

describe("Forge guided agent creation",()=>{
  it("accepts a complete conversational agent specification",()=>{
    const parsed=forgeAgentSpecSchema.safeParse({
      name:"Nuru",
      role:"Lesson Follow-up Assistant",
      purpose:"Track lesson-delivery gaps and prepare follow-up work.",
      description:"Supports the DOS with lesson delivery follow-up.",
      responsibilities:["Review lesson delivery","Prepare follow-up tasks"],
      capabilities:["lesson-delivery-monitoring","follow-up"],
      tools:["student.lookup"],
      permissions:["school:read"],
      accessMode:"read_only",
      memoryScope:"user",
      triggers:[{type:"schedule",label:"Friday review",schedule:"Every Friday at 4 PM",enabled:true}],
      communications:{enabled:false,channels:[],recipientPolicy:"Only approved recipients."},
      approvalRules:{mode:"always_for_writes",requireApprovalFor:[],notes:""},
      tone:{style:"professional",instructions:"Be concise."},
      visibility:"staff",
      icon:"bot",
    });
    expect(parsed.success).toBe(true);
  });

  it("removes permissions, tools, organization memory, and communications beyond the creator",()=>{
    const service=forgeFor(manager) as any;
    const current=forgeAgentSpecSchema.parse({});
    const result=service.normalize(manager,current,{
      name:"Nuru",
      role:"School assistant",
      purpose:"Help with learner records",
      description:"Read-only learner support",
      responsibilities:["Find learners"],
      capabilities:["learner-support"],
      tools:["student.lookup","work.task.create"],
      permissions:["school:read","admin:write","work:write"],
      accessMode:"governed_actions",
      memoryScope:"organization",
      communications:{enabled:true,channels:["sms"],recipientPolicy:"All parents"},
    });
    expect(result.spec.tools).toEqual(["student.lookup"]);
    expect(result.spec.permissions).toEqual(["school:read"]);
    expect(result.spec.memoryScope).toBe("user");
    expect(result.spec.communications.enabled).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("removes governed writes when the employee is configured read-only",()=>{
    const service=forgeFor(workManager) as any;
    const current=forgeAgentSpecSchema.parse({});
    const result=service.normalize(workManager,current,{
      tools:["student.lookup","work.task.create"],
      permissions:["school:read","work:write"],
      accessMode:"read_only",
    });
    expect(result.spec.tools).toEqual(["student.lookup"]);
    expect(result.warnings.join(" ")).toMatch(/read-only/i);
  });

  it("merges nested conversational patches instead of requiring raw full objects",()=>{
    const service=forgeFor(workManager) as any;
    const current=forgeAgentSpecSchema.parse({
      tone:{style:"professional",instructions:""},
      communications:{enabled:false,channels:[],recipientPolicy:"Only approved recipients."},
    });
    const result=service.normalize(workManager,current,{
      tone:{instructions:"Use short practical replies."},
      communications:{recipientPolicy:"Only the assigned task owner."},
    });
    expect(result.spec.tone.style).toBe("professional");
    expect(result.spec.tone.instructions).toBe("Use short practical replies.");
    expect(result.spec.communications.enabled).toBe(false);
    expect(result.spec.communications.recipientPolicy).toBe("Only the assigned task owner.");
  });

  it("allows administrators to retain organization memory but still only known Ledgerly scopes",()=>{
    const admin:AuthPrincipal={userId:"usr_admin",organizationId:"org_1",role:"admin",scopes:[]};
    const service=forgeFor(admin) as any;
    const current=forgeAgentSpecSchema.parse({});
    const result=service.normalize(admin,current,{
      memoryScope:"organization",
      permissions:["school:read","admin:write","made-up:write"],
      tools:["student.lookup","work.task.create"],
      accessMode:"governed_actions",
    });
    expect(result.spec.memoryScope).toBe("organization");
    expect(result.spec.permissions).toContain("school:read");
    expect(result.spec.permissions).toContain("admin:write");
    expect(result.spec.permissions).not.toContain("made-up:write");
  });
});

import { describe, expect, it } from "vitest";
import type { AuthPrincipal } from "../src/http/types.js";
import type { LedgerlyAiEmployee } from "../src/features/ledgerly-ai/employees/types.js";
import { LedgerlyAiPolicyService } from "../src/features/ledgerly-ai/policy/service.js";

const owner:AuthPrincipal={
  organizationId:"org_1",userId:"usr_owner",role:"owner",scopes:["admin:read","admin:write"],
};
const admin:AuthPrincipal={
  organizationId:"org_1",userId:"usr_admin",role:"admin",scopes:["admin:read","admin:write"],
};
const employee:LedgerlyAiEmployee={
  id:"laiagt_org_1_kato",organizationId:"org_1",key:"kato",name:"Kato",role:"Backend Engineer",
  description:"",icon:null,avatar:{},visibility:"admin",permissions:[],effectivePermissions:[],
  capabilities:[],tools:[],memoryScope:"organization",status:"active",kind:"engineering",
  templateVersion:1,metadata:{},
};

function runtime(rowsBySql?:(sql:string,params:unknown[])=>unknown[]){
  return {
    db:{
      query:async(sql:string,params:unknown[]=[])=>({rows:rowsBySql?.(sql,params)??[],rowCount:(rowsBySql?.(sql,params)??[]).length}),
    },
  } as never;
}

describe("Ledgerly AI Phase 13 policy engine",()=>{
  it("auto-approves explicitly safe low-risk read-only work",async()=>{
    const service=new LedgerlyAiPolicyService(runtime());
    await expect(service.evaluate({
      principal:owner,employee:null,action:"tool.service.health",
      riskLevel:"low",mutating:false,approvalRequired:false,
    })).resolves.toMatchObject({effect:"auto",requiredApprovals:0});
  });

  it("requires one human review for high risk and two owner reviews for critical risk",async()=>{
    const service=new LedgerlyAiPolicyService(runtime());
    await expect(service.evaluate({
      principal:owner,employee:null,action:"tool.attendance.record",
      riskLevel:"high",mutating:true,approvalRequired:false,
    })).resolves.toMatchObject({
      effect:"single",approvalMode:"single",requiredApprovals:1,reviewerRole:"admin",
    });
    await expect(service.evaluate({
      principal:owner,employee:null,action:"tool.production.change",
      riskLevel:"critical",mutating:true,approvalRequired:false,
    })).resolves.toMatchObject({
      effect:"two_step",approvalMode:"two_step",requiredApprovals:2,reviewerRole:"owner",
    });
  });

  it("denies destructive production work unless an explicit rule permits it",async()=>{
    const service=new LedgerlyAiPolicyService(runtime());
    await expect(service.evaluate({
      principal:owner,employee:null,action:"tool.production.destroy",
      riskLevel:"high",mutating:true,production:true,destructive:true,
    })).resolves.toMatchObject({effect:"deny",reviewerRole:"owner"});
  });

  it("never lets an explicit auto rule make destructive production work approval-free",async()=>{
    const service=new LedgerlyAiPolicyService(runtime((sql)=>{
      if(sql.includes("FROM lai_policy_rules"))return [{
        id:"rule_1",name:"Explicit production maintenance",actionPattern:"tool.production.*",
        agentKey:null,minRisk:null,mutatingOnly:true,productionOnly:true,effect:"auto",
        reviewerRole:"owner",priority:1,
      }];
      return[];
    }));
    await expect(service.evaluate({
      principal:owner,employee:null,action:"tool.production.cleanup",
      riskLevel:"high",mutating:true,production:true,destructive:true,
    })).resolves.toMatchObject({
      effect:"single",requiredApprovals:1,reviewerRole:"owner",ruleId:"rule_1",
    });
  });

  it("uses agent-specific rules before later generic rules",async()=>{
    const service=new LedgerlyAiPolicyService(runtime((sql)=>{
      if(sql.includes("FROM lai_policy_rules"))return [
        {
          id:"rule_kato",name:"Kato governed write",actionPattern:"tool.work.*",
          agentKey:"kato",minRisk:"medium",mutatingOnly:true,productionOnly:false,
          effect:"two_step",reviewerRole:"owner",priority:1,
        },
        {
          id:"rule_generic",name:"Generic write",actionPattern:"tool.work.*",
          agentKey:null,minRisk:null,mutatingOnly:true,productionOnly:false,
          effect:"single",reviewerRole:"admin",priority:2,
        },
      ];
      if(sql.includes("FROM lai_ai_controls"))return[];
      return[];
    }));
    await expect(service.evaluate({
      principal:owner,employee,action:"tool.work.task.create",
      riskLevel:"medium",mutating:true,
    })).resolves.toMatchObject({effect:"two_step",ruleId:"rule_kato",requiredApprovals:2});
  });

  it("blocks autonomous work when either the organization or employee is paused/stopped",async()=>{
    const organizationPaused=new LedgerlyAiPolicyService(runtime((sql)=>{
      if(sql.includes("FROM lai_ai_controls"))return [{
        scopeType:"organization",scopeId:"",state:"paused",reason:"maintenance",
      }];
      return[];
    }));
    await expect(organizationPaused.assertAutonomyAllowed("org_1",employee.id))
      .rejects.toMatchObject({code:"LEDGERLY_AI_AUTONOMY_PAUSED"});

    const agentStopped=new LedgerlyAiPolicyService(runtime((sql)=>{
      if(sql.includes("FROM lai_ai_controls"))return [{
        scopeType:"agent",scopeId:employee.id,state:"stopped",reason:"investigation",
      }];
      return[];
    }));
    await expect(agentStopped.assertAutonomyAllowed("org_1",employee.id))
      .rejects.toMatchObject({code:"LEDGERLY_AI_EMERGENCY_STOP"});
  });

  it("allows only owners to engage or release the organization emergency stop",async()=>{
    const service=new LedgerlyAiPolicyService(runtime());
    await expect(service.setControl(admin,{
      scopeType:"organization",state:"stopped",reason:"emergency",
    })).rejects.toMatchObject({code:"FORBIDDEN"});
  });

  it("requires an owner for owner-level reviews",()=>{
    const service=new LedgerlyAiPolicyService(runtime());
    expect(()=>service.assertReviewer(admin,"owner")).toThrow(/owner/i);
    expect(()=>service.assertReviewer(owner,"owner")).not.toThrow();
  });
});

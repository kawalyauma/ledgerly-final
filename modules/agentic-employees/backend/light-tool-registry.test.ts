import { describe, expect, it } from "vitest";
import type { AgentSystemGateway, AuthPrincipal, Env } from "../../../src/types";
import { AGENTS } from "./policy";
import { buildLightToolRegistry } from "./light-tool-registry";

const principal:AuthPrincipal={userId:"usr_test",organizationId:"org_test",role:"owner",scopes:["school:read","school:write"]};

describe("Light Mode hierarchical tool registry",()=>{
  it("indexes more than 500 permitted Ledgerly operations without exposing advanced discovery tools",async()=>{
    const routes=Array.from({length:650},(_,index)=>({method:index%3===0?"POST":"GET",path:`/api/v1/domain-${index%13}/group-${index%29}/resource-${index}`}));
    const gateway:AgentSystemGateway={catalog:async()=>routes,request:async()=>({ok:true,status:200,data:{}})};
    const registry=await buildLightToolRegistry({AGENT_SYSTEM_GATEWAY:gateway} as Env,principal,AGENTS.headteacher);
    expect(registry.stats.routeTools).toBe(650);
    expect(registry.stats.total).toBeGreaterThan(650);
    expect(registry.modules.length).toBeGreaterThan(10);
    expect(registry.tools.some(tool=>tool.name==="system_catalog")).toBe(false);
    expect(registry.tools.some(tool=>tool.name==="system_read")).toBe(false);
    expect(registry.tools.some(tool=>tool.name==="prepare_system_action")).toBe(false);
    expect(registry.tools.filter(tool=>tool.source==="route").every(tool=>tool.aliases.length>0)).toBe(true);
  });

  it("categorizes business areas and promotes common operations to semantic names",async()=>{
    const gateway:AgentSystemGateway={catalog:async()=>[
      {method:"GET",path:"/api/v1/school/student-management/reports/enrollment"},
      {method:"GET",path:"/api/v1/school/student-management/students"},
      {method:"POST",path:"/api/v1/school/student-management/students"},
      {method:"POST",path:"/api/v1/school/setup/classes"},
      {method:"PUT",path:"/api/v1/school/setup/classes/:id"},
      {method:"DELETE",path:"/api/v1/school/setup/classes/:id"},
      {method:"GET",path:"/api/v1/school/fees/balances"},
      {method:"POST",path:"/api/v1/school/staff-management/staff"},
    ],request:async()=>({ok:true,status:200,data:{}})};
    const registry=await buildLightToolRegistry({AGENT_SYSTEM_GATEWAY:gateway} as Env,principal,AGENTS.headteacher);
    const routeTools=registry.tools.filter(tool=>tool.source==="route");
    expect(routeTools.some(tool=>tool.kind==="report")).toBe(true);
    expect(routeTools.some(tool=>tool.kind==="query")).toBe(true);
    expect(routeTools.some(tool=>tool.kind==="create")).toBe(true);
    expect(routeTools.some(tool=>tool.kind==="update")).toBe(true);
    expect(routeTools.some(tool=>tool.kind==="delete")).toBe(true);
    expect(routeTools.find(tool=>tool.name==="create_class")?.module).toBe("school setup");
    expect(routeTools.find(tool=>tool.name==="create_student")?.module).toBe("students");
    expect(routeTools.find(tool=>tool.name==="create_staff_member")?.module).toBe("staff");
    expect(routeTools.find(tool=>tool.pathTemplate==="/api/v1/school/fees/balances")?.module).toBe("finance");
    expect(routeTools.find(tool=>tool.name==="student_enrollment_report")?.kind).toBe("report");
  });
});

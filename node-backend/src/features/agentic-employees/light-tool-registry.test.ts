import { describe,expect,it } from "vitest";
import type { AuthPrincipal,Env } from "./shared.js";
import { AGENTS } from "./policy.js";
import { buildLightToolRegistry } from "./light-tool-registry.js";
const principal:AuthPrincipal={userId:"usr_test",organizationId:"org_test",role:"owner",scopes:["school:read","school:write"]};
describe("Node Light Mode tool registry",()=>{
 it("indexes more than 500 routes without exposing discovery tools",async()=>{const routes=Array.from({length:650},(_,i)=>({method:i%3===0?"POST":"GET",path:`/api/v1/domain-${i%13}/group-${i%29}/resource-${i}`})),env={AGENT_SYSTEM_GATEWAY:{catalog:async()=>routes,request:async()=>({ok:true,status:200,data:{}})}} as Env,registry=await buildLightToolRegistry(env,principal,AGENTS.headteacher);expect(registry.stats.routeTools).toBe(650);expect(registry.stats.total).toBeGreaterThan(650);expect(registry.modules.length).toBeGreaterThan(10);expect(registry.tools.some(t=>["system_catalog","system_schema","system_read","prepare_system_action"].includes(t.name))).toBe(false);});
 it("promotes common school operations to semantic names and business modules",async()=>{const env={AGENT_SYSTEM_GATEWAY:{catalog:async()=>[{method:"POST",path:"/api/v1/school/setup/classes"},{method:"POST",path:"/api/v1/school/student-management/students"},{method:"POST",path:"/api/v1/school/staff-management/staff"}],request:async()=>({ok:true,status:200,data:{}})}} as Env,registry=await buildLightToolRegistry(env,principal,AGENTS.headteacher);expect(registry.tools.find(t=>t.name==="create_class")?.module).toBe("school setup");expect(registry.tools.find(t=>t.name==="create_student")?.module).toBe("students");expect(registry.tools.find(t=>t.name==="create_staff_member")?.module).toBe("staff");});
});

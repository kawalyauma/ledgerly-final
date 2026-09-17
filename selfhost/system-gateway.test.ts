import { describe, expect, it } from "vitest";
import { agentPathAllowed, createAgentSystemGateway } from "./system-gateway";

describe("Agentic employee delegated route policy",()=>{
  it("lets DOS use academics but not finance or exams",()=>{
    expect(agentPathAllowed("dos","/api/v1/academics/lesson-plans")).toBe(true);
    expect(agentPathAllowed("dos","/api/v1/payments")).toBe(false);
    expect(agentPathAllowed("dos","/api/v1/exams/results")).toBe(false);
  });
  it("lets bursar use finance but not HR",()=>{
    expect(agentPathAllowed("bursar","/api/v1/payments")).toBe(true);
    expect(agentPathAllowed("bursar","/api/v1/journals")).toBe(true);
    expect(agentPathAllowed("bursar","/api/v1/human-resources/employees")).toBe(false);
  });
  it("lets librarian use books but not payments",()=>{
    expect(agentPathAllowed("librarian","/api/v1/books/stock")).toBe(true);
    expect(agentPathAllowed("librarian","/api/v1/payments")).toBe(false);
  });
  it("gives Head Teacher broad operations but blocks control-plane paths",()=>{
    expect(agentPathAllowed("headteacher","/api/v1/academics/lesson-plans")).toBe(true);
    expect(agentPathAllowed("headteacher","/api/v1/payments")).toBe(true);
    expect(agentPathAllowed("headteacher","/api/v1/admin/users")).toBe(false);
    expect(agentPathAllowed("headteacher","/api/v1/integrations/secrets")).toBe(false);
    expect(agentPathAllowed("headteacher","/api/v1/agentic-employees/actions")).toBe(false);
  });
  it("does not accept prefix confusion or external paths",()=>{
    expect(agentPathAllowed("secretary","/api/v1/school-evil")).toBe(false);
    expect(()=>agentPathAllowed("headteacher","https://example.com/api/v1/school")).toThrow();
    expect(()=>agentPathAllowed("headteacher","/api/v1/../admin")).toThrow();
  });
  it("keeps a catalog larger than 500 operations for hierarchical Light Mode routing",async()=>{
    const app={routes:Array.from({length:650},(_,index)=>({method:index%2?"GET":"POST",path:`/api/v1/test-${index%10}/resource-${index}`}))};
    const gateway=createAgentSystemGateway(app,()=>({}),"test-secret-long-enough-for-jwt-signing","ledgerly-test","ledgerly-test");
    const routes=await gateway.catalog("headteacher",{userId:"usr",organizationId:"org",role:"owner",scopes:[]});
    expect(routes).toHaveLength(650);
  });
});

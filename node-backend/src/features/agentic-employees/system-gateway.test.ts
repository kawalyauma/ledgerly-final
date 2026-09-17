import { describe,expect,it } from "vitest";
import { agentPathAllowed } from "./system-gateway.js";

describe("Node Agent delegated route policy",()=>{
  it("keeps DOS in academics/school areas and out of finance",()=>{
    expect(agentPathAllowed("dos","/api/v1/academics/lesson-plans")).toBe(true);
    expect(agentPathAllowed("dos","/api/v1/school/setup/classes")).toBe(true);
    expect(agentPathAllowed("dos","/api/v1/payments")).toBe(false);
  });
  it("keeps bursar in finance/school areas and out of HR",()=>{
    expect(agentPathAllowed("bursar","/api/v1/payments")).toBe(true);
    expect(agentPathAllowed("bursar","/api/v1/journals")).toBe(true);
    expect(agentPathAllowed("bursar","/api/v1/human-resources/employees")).toBe(false);
  });
  it("keeps librarian in books/inventory and out of payments",()=>{
    expect(agentPathAllowed("librarian","/api/v1/books/stock")).toBe(true);
    expect(agentPathAllowed("librarian","/api/v1/inventory/items")).toBe(true);
    expect(agentPathAllowed("librarian","/api/v1/payments")).toBe(false);
  });
  it("gives headteacher broad operational access but blocks control plane",()=>{
    expect(agentPathAllowed("headteacher","/api/v1/payments")).toBe(true);
    expect(agentPathAllowed("headteacher","/api/v1/academics/lesson-plans")).toBe(true);
    expect(agentPathAllowed("headteacher","/api/v1/admin/users")).toBe(false);
    expect(agentPathAllowed("headteacher","/api/v1/integrations/secrets")).toBe(false);
    expect(agentPathAllowed("headteacher","/api/v1/agentic-employees/actions")).toBe(false);
  });
  it("rejects prefix confusion and external paths",()=>{
    expect(agentPathAllowed("secretary","/api/v1/school-evil")).toBe(false);
    expect(()=>agentPathAllowed("headteacher","https://example.com/api/v1/school")).toThrow();
    expect(()=>agentPathAllowed("headteacher","/api/v1/../admin")).toThrow();
  });
});

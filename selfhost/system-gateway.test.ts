import { describe, expect, it } from "vitest";
import { agentPathAllowed } from "./system-gateway";

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
});

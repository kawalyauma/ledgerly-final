import { describe, expect, it } from "vitest";
import { parseLedgerlyAiConfig } from "../src/features/ledgerly-ai/config.js";
import {
  affectedModule,
  classifyIncident,
  riskForChangedPaths,
} from "../src/features/ledgerly-ai/incidents/classifier.js";
import { IncidentWorkspaceManager } from "../src/features/ledgerly-ai/incidents/workspace.js";

describe("Ledgerly AI engineering incidents",()=>{
  it("deduplicates the same failure even when record IDs change",()=>{
    const a=classifyIncident({
      organizationId:"org_1",source:"api",signalType:"exception",
      message:"Student std_abcdefghijklmn failed with request 12345",
      code:"INTERNAL_ERROR",httpStatus:500,
      path:"/api/v1/school/student-management/students/std_abcdefghijklmn",
      method:"POST",
    });
    const b=classifyIncident({
      organizationId:"org_1",source:"api",signalType:"exception",
      message:"Student std_zzzzzzzzzzzzzz failed with request 98765",
      code:"INTERNAL_ERROR",httpStatus:500,
      path:"/api/v1/school/student-management/students/std_zzzzzzzzzzzzzz",
      method:"POST",
    });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.moduleKey).toBe("school");
  });

  it("routes incidents to the correct engineering employee",()=>{
    expect(classifyIncident({
      source:"api",signalType:"exception",message:"Postgres foreign key constraint failed",httpStatus:500,
    }).assignedAgentKey).toBe("tendo");
    expect(classifyIncident({
      source:"api",signalType:"exception",message:"React TSX hydration failed",httpStatus:500,
    }).assignedAgentKey).toBe("maya");
    expect(classifyIncident({
      source:"queue",signalType:"queue",message:"Docker worker connection refused",
      context:{attempts:8,maxAttempts:8},
    }).assignedAgentKey).toBe("jabali");
    expect(classifyIncident({
      source:"api",signalType:"exception",message:"Authorization bypass privilege escalation detected",httpStatus:500,
    }).assignedAgentKey).toBe("safi");
    expect(classifyIncident({
      source:"ci",signalType:"manual",message:"Vitest assertion failed in regression suite",
    }).assignedAgentKey).toBe("nia");
    expect(classifyIncident({
      source:"api",signalType:"exception",message:"Unexpected backend failure",httpStatus:500,
    }).assignedAgentKey).toBe("kato");
  });

  it("treats accounting server failures as critical but ordinary 404s as low risk",()=>{
    expect(classifyIncident({
      source:"api",signalType:"exception",message:"Payment journal posting crashed",httpStatus:500,
      path:"/api/v1/payments/post",
    }).severity).toBe("critical");
    const missing=classifyIncident({
      source:"api",signalType:"http",message:"Route not found",code:"NOT_FOUND",httpStatus:404,
      path:"/api/v1/unknown",
    });
    expect(missing.severity).toBe("low");
    expect(missing.autoProcess).toBe(false);
  });

  it("classifies production change risk from changed paths",()=>{
    expect(riskForChangedPaths(["node-backend/migrations/0112_change.sql"])).toBe("critical");
    expect(riskForChangedPaths(["node-backend/src/features/school/routes.ts"])).toBe("high");
    expect(riskForChangedPaths(["modules/agentic-employees/frontend/Page.tsx"])).toBe("medium");
    expect(riskForChangedPaths(["docs/AI.md"])).toBe("low");
  });

  it("extracts the affected API module",()=>{
    expect(affectedModule("/api/v1/school/student-management/students")).toBe("school");
    expect(affectedModule("/auth/login")).toBe("core-identity");
    expect(affectedModule("/system/health")).toBe("platform");
  });

  it("blocks incident workers from committing protected secret/session paths",()=>{
    const config=parseLedgerlyAiConfig({
      LEDGERLY_AI_STARTUP_HEALTHCHECK:false,
      LEDGERLY_AI_WORK_ROOT:"/tmp/ledgerly-ai-tests",
      LEDGERLY_AI_REPO_ROOT:"/tmp/ledgerly-source",
    });
    const manager=new IncidentWorkspaceManager(config);
    expect(()=>manager.validateChangedPaths([".env"])).toThrow(/protected/i);
    expect(()=>manager.validateChangedPaths(["node-backend/.env.production"])).toThrow(/protected/i);
    expect(()=>manager.validateChangedPaths(["var/ledgerly-ai/session-state.json"])).toThrow(/protected/i);
    expect(()=>manager.validateChangedPaths(["node-backend/src/features/school/routes.ts"])).not.toThrow();
  });
});

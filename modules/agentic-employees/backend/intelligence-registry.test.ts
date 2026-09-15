import { describe,expect,it } from "vitest";
import { compileSafeQuery,intelligenceCatalog } from "./intelligence-registry";

describe("AI intelligence registry",()=>{
  it("exposes only role-appropriate semantic entities",()=>{
    const dos=intelligenceCatalog("dos").map(x=>x.key);
    expect(dos).toContain("lesson_plans");
    expect(dos).toContain("student_attendance");
    expect(dos).not.toContain("finance_activity");
    const bursar=intelligenceCatalog("bursar").map(x=>x.key);
    expect(bursar).toContain("fee_balances");
    expect(bursar).toContain("finance_activity");
    expect(bursar).not.toContain("staff_attendance");
  });

  it("injects tenant scope and binds user values instead of interpolating them",()=>{
    const malicious="maps%' OR 1=1 --";
    const q=compileSafeQuery("dos","org-school",{entity:"lesson_plans",fields:["topic","className"],filters:[{field:"topic",operator:"contains",value:malicious}],limit:25});
    expect(q.sql).toContain("p.organization_id=?");
    expect(q.sql).not.toContain(malicious);
    expect(q.bindings[0]).toBe("org-school");
    expect(q.bindings[1]).toBe(`%${malicious.toLowerCase()}%`);
    expect(q.bindings.at(-1)).toBe(25);
  });

  it("rejects unknown fields and role-forbidden entities",()=>{
    expect(()=>compileSafeQuery("dos","org",{entity:"lesson_plans",fields:["drop_table"]})).toThrow(/allowed field/i);
    expect(()=>compileSafeQuery("dos","org",{entity:"finance_activity",metrics:["lineCount"]})).toThrow(/not allowed to query/i);
  });

  it("caps result size even when the model requests too much",()=>{
    const q=compileSafeQuery("headteacher","org",{entity:"students",limit:99999});
    expect(q.limit).toBe(100);
    expect(q.bindings.at(-1)).toBe(100);
  });

  it("counts only live fee charges and deduplicates document allocations",()=>{
    const q=compileSafeQuery("bursar","org",{entity:"fee_balances",metrics:["billedTotalMinor","paidTotalMinor","outstandingTotalMinor"],limit:1});
    expect(q.sql).toContain("status NOT IN ('draft','cancelled')");
    expect(q.sql).toContain("SELECT DISTINCT organization_id,student_id,document_id");
    expect(q.sql).toContain("pa.reversed_at IS NULL");
    expect(q.sql).not.toContain("status<>'void'");
  });
});

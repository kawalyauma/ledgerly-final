import { describe,expect,it } from "vitest";
import { RESPONSE_LIBRARY,responseLibraryStats } from "./library.js";
import { buildResponseLanguageBrief,composeFallbackHumanResponse,responseFingerprint,templateRisk } from "./engine.js";

describe("Node Response Intelligence",()=>{
  it("has a large compositional language space rather than a small response template list",()=>{
    const stats=responseLibraryStats();
    expect(stats.phraseCount).toBeGreaterThan(300);
    expect(stats.paragraphPatterns).toBeGreaterThanOrEqual(15);
    expect(stats.coreDiscourseCombinations).toBeGreaterThan(1_000_000);
    expect(stats.sectionTitleCombinations).toBeGreaterThan(1_000_000);
    expect(Object.keys(RESPONSE_LIBRARY.registers).length).toBeGreaterThanOrEqual(6);
  });

  it("changes discourse choices with the seed while preserving the response purpose",()=>{
    const a=buildResponseLanguageBrief({purpose:"analysis",request:"Analyse P6 attendance",seed:"run-a",topic:"Attendance",category:"School",detail:"deep"});
    const b=buildResponseLanguageBrief({purpose:"analysis",request:"Analyse P6 attendance",seed:"run-b",topic:"Attendance",category:"School",detail:"deep"});
    expect(a).not.toBe(b);
    expect(a).toContain("Purpose: analysis");
    expect(b).toContain("Purpose: analysis");
  });

  it("keeps fallback prose tied to supplied semantic content",()=>{
    const semantic={title:"P6 Attendance",summary:"Attendance fell from 91% to 78%.",limitations:["The records do not establish why the decline occurred."],suggestedActions:["Review the affected dates with the class teacher."]};
    const text=composeFallbackHumanResponse(semantic,{purpose:"analysis",request:"Analyse attendance",seed:"fallback-1"});
    expect(text).toContain("91%");
    expect(text).toContain("78%");
    expect(text).toContain("do not establish why");
    expect(text).toContain("Review the affected dates");
  });

  it("flags stale model-like boilerplate and fingerprints output",()=>{
    const risky="## Analysis\nIt is important to note that the data is multifaceted.\n## Conclusion\nIn conclusion, it can be said that results changed.";
    expect(templateRisk(risky).risk).toBe(true);
    expect(responseFingerprint(risky)).toMatch(/^[a-z0-9]+$/);
  });
});

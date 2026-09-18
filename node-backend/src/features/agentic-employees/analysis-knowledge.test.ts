import { describe,expect,it } from "vitest";
import { ANALYSIS_TOPICS,getAnalysisTopic,suggestAnalysisTopics } from "./analysis-knowledge.js";

describe("Node analysis knowledge catalog",()=>{
  it("keeps a broad guided investigation catalog",()=>{
    expect(ANALYSIS_TOPICS.length).toBeGreaterThanOrEqual(40);
    expect(getAnalysisTopic("chronic-absenteeism")?.evidence.length).toBeGreaterThan(5);
    expect(getAnalysisTopic("lesson-delivery")?.entityTypes).toEqual(expect.arrayContaining(["teacher","class","subject"]));
  });
  it("guides topics while leaving synthesis evidence-driven",()=>{
    const topics=suggestAnalysisTopics("analyse","academic performance decline","results marks exams attendance lessons");
    expect(topics.slice(0,5).some(t=>t.id==="academic-performance")).toBe(true);
    expect(ANALYSIS_TOPICS.every(t=>!Object.prototype.hasOwnProperty.call(t,"template"))).toBe(true);
  });
});

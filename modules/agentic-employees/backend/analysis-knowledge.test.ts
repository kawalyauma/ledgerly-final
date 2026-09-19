import { describe,expect,it } from "vitest";
import { ANALYSIS_TOPICS,getAnalysisTopic,suggestAnalysisTopics } from "./analysis-knowledge";

describe("analysis knowledge catalog",()=>{
  it("keeps a broad guided investigation catalog",()=>{
    expect(ANALYSIS_TOPICS.length).toBeGreaterThanOrEqual(40);
    expect(getAnalysisTopic("chronic-absenteeism")?.evidence.length).toBeGreaterThan(5);
    expect(getAnalysisTopic("lesson-delivery")?.entityTypes).toEqual(expect.arrayContaining(["teacher","class","subject"]));
    expect(getAnalysisTopic("academic-performance")?.modes).toContain("account-for");
  });
  it("guides likely domains without turning them into output templates",()=>{
    const topics=suggestAnalysisTopics("analyse","fees payment arrears","fees balance collections payment attendance results");
    expect(topics[0]?.id).toBe("fees-payment-behaviour");
    expect(topics.some(t=>t.id==="fees-payment-behaviour")).toBe(true);
    expect(ANALYSIS_TOPICS.every(t=>!Object.prototype.hasOwnProperty.call(t,"template"))).toBe(true);
  });
  it("surfaces instructional analysis when users ask about lesson delivery",()=>{
    const topics=suggestAnalysisTopics("account-for","missed lesson delivery science","lesson plans timetable schemes teacher attendance");
    expect(topics.slice(0,6).some(t=>["lesson-delivery","lesson-planning-compliance","scheme-coverage"].includes(t.id))).toBe(true);
  });
});

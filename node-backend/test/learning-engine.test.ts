import { describe, expect, it } from "vitest";
import { inferDocumentTerm, parseTerm, termsInText } from "../src/features/learning-engine/sources.js";
import { solveTimetable } from "../src/features/learning-engine/timetable.js";

describe("learning engine source classification", () => {
  it("recognises numeric, word, roman and ordinal term labels", () => {
    expect(parseTerm("TERM I LESSON NOTES")).toBe(1);
    expect(parseTerm("Term one scheme")).toBe(1);
    expect(parseTerm("Second Term curriculum")).toBe(2);
    expect(termsInText("T.3 / third term")).toEqual([3, 3]);
  });

  it("lets repeated document content correct wrong title metadata", () => {
    const result = inferDocumentTerm("P4 Science Term 2", "Term 2", "TERM I\nPlants\nTerm one activities\nFIRST TERM assessment");
    expect(result.term).toBe(1);
  });

  it("keeps genuine multi-term documents split by their internal headings", () => {
    const result = inferDocumentTerm("P5 Complete Notes", null, "TERM I\nWork\nTERM II\nWork\nTERM III\nWork");
    expect(result.term).toBeNull();
    expect(result.mentioned).toEqual([1, 2, 3]);
  });
});

describe("learning timetable availability", () => {
  it("never places a teacher into a blocked availability period", () => {
    const result = solveTimetable({
      days: [1], lessonPeriods: [{ id: "p1", seq: 1 }, { id: "p2", seq: 2 }], adjacentPairs: new Set([0]),
      loads: [{ id: "l1", classId: "c1", subjectId: "s1", subjectName: "Mathematics", teacherStaffId: "t1", periodsPerWeek: 1, doublePeriods: 0, room: null }],
      blocked: new Set(), teacherBlocked: new Set(["t1|1|0"]), maxPerDay: 2, morning: new Set(), attempts: 2,
    });
    expect(result.unplaced).toHaveLength(0);
    expect(result.placements[0]?.periodIndex).toBe(1);
  });
});

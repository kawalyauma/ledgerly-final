import { describe, expect, it } from "vitest";
import { coverageProblems, fitToSlots, topicShares, topicsInCurriculum } from "../src/features/learning-engine/coverage.js";
import { lessonQualityProblems, recommendedSubjectLoad } from "../src/features/learning-engine/schemes.js";
import { assessSourceText, inferDocumentTerm, parseTerm, termsInText } from "../src/features/learning-engine/sources.js";
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

  it("rejects unreadable OCR before it can influence a scheme", () => {
    expect(assessSourceText("� # @ ".repeat(100)).status).toBe("unreadable");
    expect(assessSourceText("Plants need water, air and sunlight to grow well. ".repeat(80)).status).toBe("good");
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

describe("NCDC coverage of a scheme outline", () => {
  const term = "TERM III\nTOPIC 10: Uganda as an Independent Nation\n" + "x".repeat(4000) +
    "\nTOPIC 11: The Government of Uganda\n" + "y".repeat(4000) + "\nTOPIC 12: Population, Size and Distribution\n" + "z".repeat(4000);

  it("reads the term's topics from the curriculum", () => {
    expect(topicsInCurriculum(term).map(t => t.no)).toEqual([10, 11, 12]);
    const thematic = "TERM 3\nTheme 9: Our Transport\nabc\nTheme 10: Things We Make\nTERM 3\nTheme 9: Reading from the Quran\n";
    expect(topicsInCurriculum(thematic).map(t => t.title)).toEqual(["Our Transport", "Things We Make"]);
  });

  it("rejects an outline that leaves a topic out or starves it", () => {
    const topics = topicsInCurriculum(term);
    const lessons = (n: number) => Array.from({ length: n }, () => ({}));
    expect(coverageProblems([{ title: "Uganda as an Independent Nation", lessons: lessons(28) }, { title: "The Government of Uganda", lessons: lessons(12) }], topics, 40))
      .toEqual([expect.stringContaining("topic 12")]);
    expect(coverageProblems([{ title: "Independent Uganda", lessons: lessons(30) }, { title: "Government", lessons: lessons(2) }, { title: "Population and census", lessons: lessons(8) }], topics, 40))
      .toEqual([expect.stringContaining("topic 11")]);
    expect(coverageProblems([{ title: "Uganda as an independent nation", lessons: lessons(14) }, { title: "Organs of the government of Uganda", lessons: lessons(13) }, { title: "Population size and distribution", lessons: lessons(13) }], topics, 40)).toEqual([]);
  });

  it("trims an over-long outline per unit, never dropping the last unit", () => {
    const unit = (n: number, kind = "teach") => Array.from({ length: n }, (_, i) => ({ kind: i % 2 ? "practice" : kind }));
    const fitted = fitToSlots([unit(30), unit(10), unit(10)], 40);
    expect(fitted.reduce((n, u) => n + u.length, 0)).toBe(40);
    expect(fitted[2]!.length).toBeGreaterThanOrEqual(7);
  });

  it("gives genuinely larger curriculum topics more lessons", () => {
    const uneven = "TOPIC 1: Small\n" + "small scope ".repeat(30) + "\nTOPIC 2: Large\n" + "many competences and subtopics ".repeat(500) + "\nTOPIC 3: Final\n" + "small scope ".repeat(30);
    const shares = topicShares(topicsInCurriculum(uneven), 40);
    expect(shares[1]).toBeGreaterThan(shares[0]!);
    expect(shares.reduce((n, x) => n + x, 0)).toBe(40);
  });

  it("uses the NCDC weekly periods in upper primary", () => {
    expect(recommendedSubjectLoad("Primary Five 2026", "Social Studies").periodsPerWeek).toBe(5);
    expect(recommendedSubjectLoad("P6", "Mathematics").periodsPerWeek).toBe(6);
    expect(recommendedSubjectLoad("P5", "Religious Education").periodsPerWeek).toBe(3);
  });
});

describe("lesson quality gate", () => {
  it("rejects shallow or repeated notes and accepts sufficiently developed work", () => {
    expect(lessonQualityProblems({ notes: "Too short.", activities: [], sourcePassageIds: [] }, "P5", "Mathematics").length).toBeGreaterThan(0);
    const notes = "## SUB-TOPIC: Division\n### Sharing\n" + Array.from({ length: 430 }, (_, i) => `word${i}`).join(" ") + "\n\n### Worked example\nGuided practice.\n### Exercise\n1. Share 6 by 2.";
    expect(lessonQualityProblems({ notes, activities: Array(6).fill({}), sourcePassageIds: ["p1"] }, "P5", "Mathematics")).toEqual([]);
  });
});

describe("chalkboard notes quality gate", () => {
  const content = "Christ is the light of the world because he shows people the way to God and takes away darkness. ".repeat(40);
  const acts = Array.from({ length: 8 }, () => ({}));
  it("rejects notes full of classroom instructions and without headings", () => {
    const notes = `### Our experience\nTell the story to your group. In your groups discuss the ways. Sing songs about light.\n${content}`;
    const problems = lessonQualityProblems({ notes, activities: acts, sourcePassageIds: ["x"] }, "Primary Five", "Christian Religious Education");
    expect(problems.join(" ")).toMatch(/classroom instructions/);
    expect(problems.join(" ")).toMatch(/SUB-TOPIC/);
  });
  it("accepts structured chalkboard notes", () => {
    const notes = `# TOPIC: WITNESS\n## SUB-TOPIC: Christ the light of the world\n### Meaning of light\n${content}\n### Ways Christ is the light\n1. He heals.\n2. He teaches.\n### Exercise\n1. What is light?`;
    expect(lessonQualityProblems({ notes, activities: acts, sourcePassageIds: ["x"] }, "Primary Five", "Christian Religious Education")).toEqual([]);
  });
});

describe("scheme methods column", () => {
  it("keeps short method lists and reduces a step-by-step guide to method names", async () => {
    const { methodNames } = await import("../src/features/learning-engine/export.js");
    expect(methodNames("Story telling, Discussion")).toBe("Story telling, Discussion");
    expect(methodNames("1. Introduction (5 min): Teacher asks learners to tell local stories. 2. Guided Bible reading of John 8:12. 3. Learners discuss in groups and sing songs."))
      .toBe("Story telling, Discussion, Guided Bible reading, Group work, Singing");
  });
});

import { describe, expect, it } from "vitest";
import { coverageProblems, fitToSlots, topicShares, topicsInCurriculum } from "../src/features/learning-engine/coverage.js";
import { lessonQualityProblems, planProblems, pointFormProblems, recommendedSubjectLoad } from "../src/features/learning-engine/schemes.js";
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
    const notes = "## SUB-TOPIC: Division\n### Sharing\n" + Array.from({ length: 40 }, (_, i) => `- Sharing fact number ${i} for learners.`).join("\n") + "\n\n### Worked example\nGuided practice.\n### Exercise\n1. Share 6 by 2.";
    expect(lessonQualityProblems({ notes, activities: Array(6).fill({}), sourcePassageIds: ["p1"] }, "P5", "Mathematics")).toEqual([]);
  });
});

describe("chalkboard notes quality gate", () => {
  const content = Array.from({ length: 30 }, (_, i) => `- Christ shows people the way to God (${i + 1}).`).join("\n");
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

describe("point-form house style", () => {
  const acts = Array.from({ length: 8 }, () => ({}));
  const notebook = [
    "# TOPIC: LOCATION OF UGANDA", "## SUB-TOPIC: Highland districts",
    "### Highland districts", "- These are districts which are located in areas of high altitude.", "- Such districts usually have many hills and mountains.", "- **Altitude** is the height above the sea level.",
    "### Examples of highland districts", "- Mbale", "- Kapchorwa", "- Kabale", "- Kisoro", "- Bundibugyo", "- Kasese", "- Moroto", "- Rukungiri",
    "### Economic activities commonly carried out in highland districts", "- Tourism", "- Mining", "- Crop growing",
    "### Problems faced by people living in highland districts", "- Landslides", "- Poor transport network", "- Severe soil erosion", "- Difficulty in agricultural mechanisation",
    "### Possible solutions to the problems facing people living in highland districts", "- By rearing donkeys to use them as means of transport.", "- By constructing winding roads.",
    "- By practising afforestation and reafforestation to control landslides.", "- By terracing, contour ploughing and strip cropping to reduce soil erosion.",
    "### Note", "- Heavy rainfall is the major cause of landslides in highland areas.", "- Landslides can be controlled in highland areas by planting more trees.",
    "### Exercise", "1. What are highland districts?", "2. Give two examples of highland districts.", "3. Why is it difficult to use tractors in highland areas?",
  ].join("\n");
  it("accepts notebook-style point notes", () => {
    expect(lessonQualityProblems({ notes: notebook, activities: acts, sourcePassageIds: ["x"] }, "P5", "Social Studies")).toEqual([]);
  });
  it("rejects paragraphs, long points and padding", () => {
    const paragraph = notebook.replace("- These are districts which are located in areas of high altitude.",
      "The President is the political head of Uganda and heads the Executive. The President is the head of state and government and is commander-in-chief of the armed forces.");
    expect(pointFormProblems(paragraph, "Social Studies").join(" ")).toMatch(/point form/);
    expect(pointFormProblems(notebook.replace("- Mining", `- ${"very ".repeat(35)}long point`), "Social Studies").join(" ")).toMatch(/points must be short/);
    expect(pointFormProblems(notebook.replace("- Tourism", "- Other responsibilities in the supplied notes include tourism."), "Social Studies").join(" ")).toMatch(/padding/);
  });
  it("allows worked-example lines in Mathematics", () => {
    expect(pointFormProblems("### Example 1\n$\\frac{1}{5} + \\frac{2}{5} = \\frac{3}{5}$\nAdd the numerators.\n### Rule\n- Keep the denominator.", "Mathematics")).toEqual([]);
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

describe("school schemes of work lead the outline", () => {
  it("rejects an outline that ignores the school's schemes of work", async () => {
    const { schemeFollowProblems } = await import("../src/features/learning-engine/coverage.js");
    const schemes = new Set(["sch_1", "sch_2"]);
    const lesson = (ids: string[]) => ({ kind: "teach", sourcePassageIds: ids });
    expect(schemeFollowProblems([{ title: "Government", lessons: [lesson(["ncdc_1"]), lesson(["ncdc_2"]), lesson(["notes_1"])] }], schemes).join(" ")).toMatch(/cite the school's schemes/);
    expect(schemeFollowProblems([{ title: "Independence", lessons: [lesson(["sch_1"]), lesson(["sch_2", "ncdc_1"]), lesson(["notes_1"])] }], schemes)).toEqual([]);
    expect(schemeFollowProblems([{ title: "Any", lessons: [lesson(["x"])] }], new Set())).toEqual([]);
  });
  it("only requires NCDC topics to be present when the school's schemes decide pacing", async () => {
    const { coverageProblems } = await import("../src/features/learning-engine/coverage.js");
    const topics = [{ no: 1, title: "The Government of Uganda", weight: 0.5 }, { no: 2, title: "Population, size and distribution", weight: 0.5 }];
    const units = [{ title: "Uganda as an independent nation", lessons: Array(30).fill({}) }, { title: "The Government of Uganda", lessons: Array(1).fill({}) }, { title: "Population, size and distribution", lessons: Array(20).fill({}) }];
    expect(coverageProblems(units, topics as never, 45).join(" ")).toMatch(/only 1 lessons/);
    expect(coverageProblems(units, topics as never, 45, true)).toEqual([]);
    expect(coverageProblems(units.slice(0, 2), topics as never, 45, true).join(" ")).toMatch(/has no unit/);
  });
});

describe("lesson plan quality gate", () => {
  const notes = "# TOPIC: THE GOVERNMENT OF UGANDA\n## SUB-TOPIC: The legislature\n### Duties of the legislature\n- To make laws.\n### Important parliamentary officers\n- The Speaker\n### Exercise\n1. Who heads Parliament?";
  it("rejects the shallow one-line plans the agents produced", () => {
    const shallow = { competences: ["Answer exercise questions on the Legislature."], objectives: ["Answer exercise questions on the Legislature."], methods: ["Discussion", "Question and answer"],
      materials: ["Chalkboard"], assessment: "Use the sourced written questions.", homework: "Complete the exercise.",
      steps: [{ stage: "Introduction", minutes: 5, teacherActivity: "Review Parliament's functions.", learnerActivity: "Learners recall duties." },
        { stage: "Development", minutes: 27, teacherActivity: "Explain key terms.", learnerActivity: "Learners recall terms." },
        { stage: "Conclusion", minutes: 8, teacherActivity: "Go over answers.", learnerActivity: "Learners correct answers." }] };
    const problems = planProblems(shallow, notes, 40).join(" ");
    for (const want of [/at least 4 steps/, /teacher activity too thin/, /learner activity too thin/, /'content'/, /2 subject competences/, /prior knowledge/, /3 methods/, /teaching aids/, /assessment must list/, /does not teach these notes sections: .*officers/i])
      expect(problems).toMatch(want);
  });
  it("accepts a complete plan", () => {
    const say = (what: string) => `The teacher asks learners what ${what} means, writes the answer on the board, explains it with an example from Uganda and asks two learners to repeat it aloud for the class.`;
    const plan = { competences: ["The learner names the duties of the legislature.", "The learner names the officers of Parliament."],
      objectives: ["By the end of the lesson, learners should be able to state three duties of the legislature.", "By the end of the lesson, learners should be able to name the Speaker and Clerk."],
      priorKnowledge: "Learners already know the three organs of government from the previous lesson.", methods: ["Explanation", "Discussion", "Question and answer"],
      materials: ["Chart of the three organs of government", "Picture of Parliament in session"],
      assessment: "Oral questions: Who heads Parliament? What is the main duty of the legislature? Who keeps order in Parliament? Learners answer in their books.", homework: "Name three duties of Parliament in your book.",
      steps: [
        { stage: "Introduction", minutes: 5, teacherActivity: say("an organ of government"), learnerActivity: "Learners name the three organs of government and say what each one does." },
        { stage: "Development: duties of the legislature", minutes: 12, content: "Duties of the legislature: making laws, approving the budget, approving ministers.", teacherActivity: say("the legislature"), learnerActivity: "Learners read the duties from the board and copy them into their exercise books." },
        { stage: "Development: important parliamentary officers", minutes: 10, content: "Officers: the Speaker, the Clerk to Parliament, the Sergeant-at-Arms.", teacherActivity: say("the Speaker"), learnerActivity: "Learners match each parliamentary officer to the work that officer does in Parliament." },
        { stage: "Practice", minutes: 8, content: "Exercise questions on the legislature and its officers from the notes.", teacherActivity: say("the Clerk"), learnerActivity: "Learners answer the exercise questions in their books and then mark them in pairs." },
        { stage: "Conclusion", minutes: 5, teacherActivity: say("a law"), learnerActivity: "Learners summarise the lesson by naming two duties and two officers of Parliament." },
      ] };
    expect(planProblems(plan, notes, 40)).toEqual([]);
  });
});

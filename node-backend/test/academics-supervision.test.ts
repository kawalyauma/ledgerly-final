import { describe, expect, it } from "vitest";
import { supervisionTemplateSchema } from "../src/features/academics/compliance.js";

const template = {
  name: "Teacher supervision",
  description: "Reusable academic review",
  active: true,
  sections: [{
    id: "visit",
    title: "Visit details",
    fields: [
      { id: "teacher", label: "Teacher", type: "teacher", required: true },
      { id: "judgement", label: "Overall judgement", type: "select", options: ["Strong", "Support needed"] },
      { id: "practice", label: "Classroom practice", type: "rubric", scale: "rating4", items: ["Learner engagement"] },
      { id: "actions", label: "Agreed actions", type: "table", columns: [{ id: "action", label: "Action", type: "text", required: true }] },
    ],
  }],
};

describe("dynamic academic supervision templates", () => {
  it("accepts entity dropdowns, rubrics and repeating tables", () => {
    expect(supervisionTemplateSchema.safeParse(template).success).toBe(true);
  });

  it("rejects duplicate field keys across sections", () => {
    const duplicate = structuredClone(template);
    duplicate.sections.push({ id: "follow_up", title: "Follow up", fields: [{ id: "teacher", label: "Second teacher", type: "teacher", required: false }] } as never);
    const parsed = supervisionTemplateSchema.safeParse(duplicate);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some(issue => issue.message.includes("used more than once"))).toBe(true);
  });

  it("requires configured values for dropdown fields", () => {
    const invalid = structuredClone(template);
    invalid.sections[0]!.fields[1]!.options = [];
    expect(supervisionTemplateSchema.safeParse(invalid).success).toBe(false);
  });
});

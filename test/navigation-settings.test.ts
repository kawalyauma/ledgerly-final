import { describe, expect, it } from "vitest";
import { arrangeGroups, editableSections, SCHOOL_DEFAULT_SECTIONS } from "../web/navigationLayout";

const groups = ["ledgerly-core:Accounting", "exams:Examinations", "school-management:School", "ledgerly-core:Dashboards", "tasks-work:Tasks & Work"].map(key => ({ key }));

describe("navigation settings", () => {
  it("gives a new school Dashboard, School and Examinations only, in that order", () => {
    expect(arrangeGroups(groups, null).map(g => g.key)).toEqual(["ledgerly-core:Dashboards", "school-management:School", "exams:Examinations"]);
    expect(SCHOOL_DEFAULT_SECTIONS).toHaveLength(3);
  });
  it("keeps every section for organizations that opted into showAll", () => {
    expect(arrangeGroups(groups, { showAll: true })).toHaveLength(groups.length);
  });
  it("applies a saved order and hides unchecked sections", () => {
    const saved = { sections: [{ key: "tasks-work:Tasks & Work", visible: true }, { key: "exams:Examinations", visible: false }, { key: "ledgerly-core:Dashboards", visible: true }] };
    expect(arrangeGroups(groups, saved).map(g => g.key)).toEqual(["tasks-work:Tasks & Work", "ledgerly-core:Dashboards"]);
  });
  it("lists sections a saved layout doesn't mention as hidden, after the saved ones", () => {
    const rows = editableSections(groups.map(g => g.key), null);
    expect(rows.slice(0, 3).every(r => r.visible)).toBe(true);
    expect(rows.slice(3).every(r => !r.visible)).toBe(true);
    expect(rows).toHaveLength(groups.length);
  });
});

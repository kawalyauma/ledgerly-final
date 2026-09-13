import { describe, expect, it } from "vitest";
import { nextOccurrence, PROACTIVE_WORKFLOWS, workflowDefinition } from "./proactive";

describe("agentic proactive workflows", () => {
  it("defines specialist reviews and the headteacher daily brief", () => {
    expect(workflowDefinition("dos_daily_review")?.agentKey).toBe("dos");
    expect(workflowDefinition("headteacher_daily_brief")?.agentKey).toBe("headteacher");
    expect(PROACTIVE_WORKFLOWS.some(item => item.key === "librarian_weekly_review")).toBe(true);
  });

  it("schedules Kampala local time as UTC correctly", () => {
    const from = new Date("2026-09-13T03:00:00.000Z");
    expect(nextOccurrence("Africa/Kampala", 7, 0, "daily", null, from)).toBe("2026-09-13T04:00:00.000Z");
  });

  it("moves weekly schedules to the requested weekday", () => {
    const from = new Date("2026-09-13T10:00:00.000Z");
    const next = new Date(nextOccurrence("Africa/Kampala", 7, 20, "weekly", 1, from));
    expect(next.getUTCDay()).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { nextScheduleAt } from "../src/features/report-management/jobs.js";

describe("report schedule cadence",()=>{
  it("advances hourly, daily, weekly and monthly schedules in UTC",()=>{
    const base=new Date("2026-09-13T01:00:00Z");
    expect(nextScheduleAt(base,"hourly").toISOString()).toBe("2026-09-13T02:00:00.000Z");
    expect(nextScheduleAt(base,"daily").toISOString()).toBe("2026-09-14T01:00:00.000Z");
    expect(nextScheduleAt(base,"weekly").toISOString()).toBe("2026-09-20T01:00:00.000Z");
    expect(nextScheduleAt(base,"monthly").toISOString()).toBe("2026-10-13T01:00:00.000Z");
  });
});

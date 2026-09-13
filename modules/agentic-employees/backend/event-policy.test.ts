import { describe, expect, it } from "vitest";
import { attendanceSeverity, booksStockSeverity, retryDelayMinutes } from "./event-policy";

describe("agentic employee event policy",()=>{
  it("escalates repeated absence from info to attention to urgent",()=>{
    expect(attendanceSeverity(1,2,3)).toBe("info");
    expect(attendanceSeverity(2,2,3)).toBe("attention");
    expect(attendanceSeverity(3,2,3)).toBe("urgent");
  });

  it("only wakes books staff at or below the configured threshold",()=>{
    expect(booksStockSeverity(21,20)).toBeNull();
    expect(booksStockSeverity(20,20)).toBe("attention");
    expect(booksStockSeverity(0,20)).toBe("urgent");
    expect(booksStockSeverity(-3,20)).toBe("urgent");
  });

  it("backs failed event processing off in five minute steps",()=>{
    expect(retryDelayMinutes(1)).toBe(5);
    expect(retryDelayMinutes(2)).toBe(10);
    expect(retryDelayMinutes(3)).toBe(15);
  });
});

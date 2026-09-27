import { describe, expect, it } from "vitest";
import { sharedLedgerDimensions } from "../src/features/finance-core/dimensions.js";

describe("sharedLedgerDimensions", () => {
  it("copies a shared student dimension to a control line", () => {
    expect(sharedLedgerDimensions([
      { schoolStudentId: "stu_1", schoolFeeCategoryId: "tuition" },
      { schoolStudentId: "stu_1", schoolFeeCategoryId: "meals" },
    ])).toEqual({ schoolStudentId: "stu_1" });
  });

  it("does not attribute a mixed document or payment to one student", () => {
    expect(sharedLedgerDimensions([
      { schoolStudentId: "stu_1" },
      { schoolStudentId: "stu_2" },
    ])).toEqual({});
  });
});

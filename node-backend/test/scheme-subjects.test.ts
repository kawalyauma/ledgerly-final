import { expect, it } from "vitest";
import { namesSubject } from "../src/features/learning-engine/schemes.js";
it("tells subject schemes from thematic ones", () => {
  expect(namesSubject("P I Mathematics Scheme OF Work Term Iiii", "Mathematics")).toBe(true);
  expect(namesSubject("P1 MTC BOT III", "Mathematics")).toBe(true);
  expect(namesSubject("P 1 Term 3 Scheme", "Mathematics")).toBe(false);
  expect(namesSubject("P 3 SST Notes", "Social Studies")).toBe(true);
  expect(namesSubject("P1 Term 3 Literacy 1 Workbook", "Science")).toBe(false);
});

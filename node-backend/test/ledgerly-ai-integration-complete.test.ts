import { describe, expect, it } from "vitest";
import { extractJsonObject } from "../src/features/ledgerly-ai/integrations/complete.js";

describe("Ledgerly AI integration completion", () => {
  it("extracts a JSON object from plain, fenced or chatty replies", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('Sure!\n```json\n{"subject":"science","keywords":["cells"]}\n```')).toEqual({ subject: "science", keywords: ["cells"] });
    expect(extractJsonObject('Here it is: {"ok":true} hope that helps')).toEqual({ ok: true });
  });

  it("rejects replies without a JSON object", () => {
    expect(extractJsonObject("no json here")).toBeNull();
    expect(extractJsonObject("[1,2,3]")).toBeNull();
    expect(extractJsonObject("{broken")).toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkPythonResponseIntelligence,
  realizeWithPythonResponseIntelligence,
  submitPythonResponseFeedback,
} from "./python-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Python Response Intelligence bridge", () => {
  it("returns null when the service is not configured", async () => {
    const result = await realizeWithPythonResponseIntelligence({} as any, {
      purpose: "analysis",
      request: "Analyse attendance.",
    });
    expect(result).toBeNull();
  });

  it("sends verified semantics and the resolved school provider", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      expect(body.purpose).toBe("analysis");
      expect(body.semantic_payload.rows[0].studentName).toBe("Amina");
      expect(body.generation.api_style).toBe("responses");
      expect(body.generation.model).toBe("school-model");
      expect(body.generation.api_key).toBe("school-secret");
      expect((init?.headers as Record<string, string>)["X-Response-Intelligence-Token"]).toBe("service-token-123456");
      return new Response(JSON.stringify({
        text: "Amina's attendance requires review.",
        provider: "responses",
        model: "school-model",
        revision_count: 1,
        response_fingerprint: "abc123",
        quality: { overall: 0.94, revision_required: false },
        plan: {},
        metadata: { providerDelegated: true },
        tool_events: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await realizeWithPythonResponseIntelligence({
      RESPONSE_INTELLIGENCE_URL: "http://127.0.0.1:8091",
      RESPONSE_INTELLIGENCE_TOKEN: "service-token-123456",
      RESPONSE_INTELLIGENCE_TIMEOUT_MS: 30000,
    } as any, {
      purpose: "analysis",
      request: "Analyse Amina's attendance.",
      semanticPayload: { rows: [{ studentName: "Amina", attendancePercent: 72 }] },
      generation: {
        provider: "openai",
        apiStyle: "responses",
        baseUrl: "https://example.test/v1",
        apiKey: "school-secret",
        model: "school-model",
      },
    });

    expect(result?.text).toContain("Amina");
    expect(result?.metadata.providerDelegated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports service health without exposing provider credentials", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      status: "ok",
      service: "ledgerly-response-intelligence",
      providerConfigured: false,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkPythonResponseIntelligence({
      RESPONSE_INTELLIGENCE_URL: "http://127.0.0.1:8091",
      RESPONSE_INTELLIGENCE_TOKEN: "service-token-123456",
    } as any);

    expect(result.configured).toBe(true);
    expect(result.reachable).toBe(true);
    expect(result.status).toBe("ok");
  });
});


it("sends tenant-scoped human corrections to the learning service", async () => {
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body=JSON.parse(String(init?.body||"{}"));
    expect(body.organization_id).toBe("org_1");
    expect(body.response_fingerprint).toBe("fp_123");
    expect(body.rating).toBe(-1);
    expect(body.correction_text).toContain("better");
    expect(body.trusted_reviewer).toBe(false);
    return new Response(JSON.stringify({feedback_id:"fb_1"}),{status:200,headers:{"Content-Type":"application/json"}});
  });
  vi.stubGlobal("fetch",fetchMock);
  const result=await submitPythonResponseFeedback({
    RESPONSE_INTELLIGENCE_URL:"http://127.0.0.1:8091",
    RESPONSE_INTELLIGENCE_TOKEN:"service-token-123456",
  } as any,{
    organizationId:"org_1",responseFingerprint:"fp_123",rating:-1,
    correctionText:"A better evidence-grounded response.",
  });
  expect(result?.feedback_id).toBe("fb_1");
});

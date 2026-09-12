import { describe, expect, it } from "vitest";
import { isSafeWebhookUrl, webhookSignature } from "../src/features/integrations/service.js";

describe("webhook integration security",()=>{
  it("requires public https destinations",()=>{
    expect(isSafeWebhookUrl("https://example.com/hooks/ledgerly")).toBe(true);
    expect(isSafeWebhookUrl("http://example.com/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://localhost/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://127.0.0.1/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://10.0.0.7/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://192.168.1.2/hook")).toBe(false);
    expect(isSafeWebhookUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
  });
  it("produces deterministic v1-compatible HMAC material",()=>{
    expect(webhookSignature("secret-hash","123","{\"ok\":true}")).toBe(webhookSignature("secret-hash","123","{\"ok\":true}"));
    expect(webhookSignature("secret-hash","123","{\"ok\":true}")).not.toBe(webhookSignature("secret-hash","124","{\"ok\":true}"));
  });
});

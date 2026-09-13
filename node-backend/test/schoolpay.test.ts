import { describe, expect, it } from "vitest";
import { schoolPaySyncHash, validateSchoolPayDateRange } from "../src/features/schoolpay/reconciliation.js";
import {
  decryptSchoolPaySecret,
  encryptSchoolPaySecret,
  schoolPayWebhookSignature,
  verifySchoolPayWebhookSignature,
} from "../src/features/schoolpay/service.js";

describe("SchoolPay gateway crypto", () => {
  it("matches the SchoolPay SHA-256 password + receipt signature contract", () => {
    expect(schoolPayWebhookSignature("demo-password", "SP-000123")).toBe(
      "68dca8806e869e518038a3e2317fd8ae6045aca3a1ac166e91ea61763c03d928",
    );
    expect(verifySchoolPayWebhookSignature(
      "demo-password",
      "SP-000123",
      "68dca8806e869e518038a3e2317fd8ae6045aca3a1ac166e91ea61763c03d928",
    )).toBe(true);
    expect(verifySchoolPayWebhookSignature("demo-password", "SP-000123", "0".repeat(64))).toBe(false);
  });

  it("matches the SchoolPay uppercase MD5 reconciliation hash contract", () => {
    expect(schoolPaySyncHash("123456", "2024-01-15", "your_secret_password")).toBe("8C25020661588EC8BE2A7452344E8B6F");
  });

  it("enforces the SchoolPay 31-day reconciliation range", () => {
    expect(validateSchoolPayDateRange("2024-01-01", "2024-01-31")).toEqual({ days: 31 });
    expect(() => validateSchoolPayDateRange("2024-01-01", "2024-02-01")).toThrow();
    expect(() => validateSchoolPayDateRange("2024-02-31", "2024-02-31")).toThrow();
  });

  it("encrypts each school API password with authenticated encryption", () => {
    const envelope = encryptSchoolPaySecret("school-specific-password", "a-very-long-ledgerly-schoolpay-master-key-123456");
    expect(envelope.ciphertext).not.toContain("school-specific-password");
    expect(decryptSchoolPaySecret(envelope, "a-very-long-ledgerly-schoolpay-master-key-123456")).toBe("school-specific-password");
    expect(() => decryptSchoolPaySecret(envelope, "another-long-but-wrong-schoolpay-master-key-654321")).toThrow();
  });
});

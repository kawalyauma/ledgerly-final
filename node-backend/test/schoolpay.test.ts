import { describe, expect, it } from "vitest";
import { schoolPayAdhocHash } from "../src/features/schoolpay/adhoc.js";
import { schoolPaySyncHash, validateSchoolPayDateRange } from "../src/features/schoolpay/reconciliation.js";
import { schoolPayAdhocRecoveryDelayMinutes } from "../src/features/schoolpay/recovery.js";
import { ipMatchesRule, normalizeIp } from "../src/features/schoolpay/security.js";
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

  it("uses the SchoolPay ad-hoc identifying reference hash contract", () => {
    expect(schoolPayAdhocHash("809", "63140", "password")).toBe("95EDAC058FD62560E1E910FA1E161C1E");
  });

  it("enforces the SchoolPay 31-day reconciliation range", () => {
    expect(validateSchoolPayDateRange("2024-01-01", "2024-01-31")).toEqual({ days: 31 });
    expect(() => validateSchoolPayDateRange("2024-01-01", "2024-02-01")).toThrow();
    expect(() => validateSchoolPayDateRange("2024-02-31", "2024-02-31")).toThrow();
  });

  it("backs off repeated SchoolPay ad-hoc recovery checks", () => {
    expect([1, 2, 3, 4, 5, 20].map(schoolPayAdhocRecoveryDelayMinutes)).toEqual([5, 10, 15, 30, 60, 60]);
  });

  it("matches exact addresses and IPv4 CIDR webhook rules", () => {
    expect(ipMatchesRule("196.0.0.15", "196.0.0.15")).toBe(true);
    expect(ipMatchesRule("196.0.0.15", "196.0.0.0/24")).toBe(true);
    expect(ipMatchesRule("196.0.1.15", "196.0.0.0/24")).toBe(false);
    expect(ipMatchesRule("2001:db8::5", "2001:db8::5")).toBe(true);
    expect(normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
  });

  it("encrypts each school API password with authenticated encryption", () => {
    const envelope = encryptSchoolPaySecret("school-specific-password", "a-very-long-ledgerly-schoolpay-master-key-123456");
    expect(envelope.ciphertext).not.toContain("school-specific-password");
    expect(decryptSchoolPaySecret(envelope, "a-very-long-ledgerly-schoolpay-master-key-123456")).toBe("school-specific-password");
    expect(() => decryptSchoolPaySecret(envelope, "another-long-but-wrong-schoolpay-master-key-654321")).toThrow();
  });
});

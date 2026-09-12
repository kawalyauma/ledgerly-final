import { createHmac, createHash } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decodeBase32(input: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of input.replace(/=+$/, "")) {
    const index = alphabet.indexOf(ch.toUpperCase()); if (index < 0) continue;
    value = (value << 5) | index; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export async function decryptMfaSecret(appSecret: string, stored: string): Promise<string> {
  const [ivPart, cipherPart] = stored.split(".");
  if (!ivPart || !cipherPart) throw new Error("Invalid MFA secret");
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`school-mfa:${appSecret}`));
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(ivPart, "base64") }, key, Buffer.from(cipherPart, "base64"));
  return new TextDecoder().decode(plain);
}
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const normalized = code.replace(/\s/g, ""), key = decodeBase32(secret);
  for (let offset = -1; offset <= 1; offset += 1) {
    const counter = BigInt(Math.floor(now / 30000) + offset), buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(counter);
    const mac = createHmac("sha1", key).update(buffer).digest(), pos = mac[mac.length - 1]! & 15;
    const value = ((mac[pos]! & 127) << 24) | ((mac[pos + 1]! & 255) << 16) | ((mac[pos + 2]! & 255) << 8) | (mac[pos + 3]! & 255);
    if (String(value % 1_000_000).padStart(6, "0") === normalized) return true;
  }
  return false;
}
export function hashRecoveryCode(code: string): string { return createHash("sha256").update(`school-recovery:${code.trim().toUpperCase()}`).digest("hex"); }

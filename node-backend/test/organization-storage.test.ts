import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { AppConfig } from "../src/config/env.js";
import { createStorage } from "../src/storage/index.js";

let root: string;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (root) await rm(root, { recursive: true, force: true });
});

it("keeps selected school files on the server even when NexDrive is down", async () => {
  root = await mkdtemp(path.join(tmpdir(), "ledgerly-storage-"));
  const remote = vi.fn(async () => { throw new Error("NexDrive unavailable"); });
  vi.stubGlobal("fetch", remote);
  const query = vi.fn(async () => ({ rows: [] }));
  const storage = createStorage({
    STORAGE_DRIVER: "nexdrive", STORAGE_LOCAL_ROOT: root,
    STORAGE_LOCAL_ORGANIZATION_IDS: "org_test_school",
    NEXDRIVE_URL: "https://invalid.example", NEXDRIVE_WORKSPACE_ID: "test",
    NEXDRIVE_API_KEY: "test", NEXDRIVE_TIMEOUT_MS: 100,
  } as AppConfig, { query } as unknown as Pool);
  await storage.initialize();
  for (const key of [
    "ledgerly-ai/org_test_school/outputs/file/fees.pdf",
    "school/org_test_school/attachments/fees.pdf",
  ]) {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    await storage.put(key, bytes, "application/pdf");
    expect(await storage.exists(key)).toBe(true);
    expect(new Uint8Array((await storage.get(key))!)).toEqual(bytes);
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  }
  expect(remote).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
  await expect(storage.put("school/org_other/fees.pdf", new Uint8Array())).rejects.toThrow("NexDrive unavailable");
  expect(remote).toHaveBeenCalled();
  expect(() => storage.get("school/org_test_school/../org_other/fees.pdf")).toThrow("Invalid storage key");
});

it("keeps Printerly receipts on the server for every school, even when NexDrive is down", async () => {
  root = await mkdtemp(path.join(tmpdir(), "ledgerly-storage-"));
  const remote = vi.fn(async () => { throw new Error("NexDrive unavailable"); });
  vi.stubGlobal("fetch", remote);
  const storage = createStorage({
    STORAGE_DRIVER: "nexdrive", STORAGE_LOCAL_ROOT: root, STORAGE_LOCAL_ORGANIZATION_IDS: "",
    NEXDRIVE_URL: "https://invalid.example", NEXDRIVE_WORKSPACE_ID: "test", NEXDRIVE_API_KEY: "test", NEXDRIVE_TIMEOUT_MS: 100,
  } as AppConfig, { query: vi.fn(async () => ({ rows: [] })) } as unknown as Pool);
  await storage.initialize();
  const key = "printerly/org_any_school/receipts/pay_1/doc_1/RCT-001.pdf", bytes = new Uint8Array([37, 80, 68, 70]);
  await storage.put(key, bytes, "application/pdf");
  expect(new Uint8Array((await storage.get(key))!)).toEqual(bytes);
  expect(await storage.exists(key)).toBe(true);
  expect(remote).not.toHaveBeenCalled();
  // A receipt written to NexDrive before this rule is still looked for there (and NexDrive being down is not fatal).
  expect(await storage.get("printerly/org_any_school/receipts/old/doc/RCT-000.pdf")).toBeNull();
});

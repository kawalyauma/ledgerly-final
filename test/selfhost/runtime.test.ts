import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadNodeConfig } from "../../src/node/config";
import { LocalR2Bucket } from "../../src/node/local-r2";
import { translateD1Sql } from "../../src/node/postgres-d1";

describe("self-hosted runtime compatibility", () => {
  it("translates D1 placeholders without touching quoted question marks", () => {
    expect(translateD1Sql("SELECT '?' AS literal, id FROM users WHERE id=? AND email=?")).toBe("SELECT '?' AS literal, id FROM users WHERE id=$1 AND email=$2");
  });
  it("translates SQLite datetime modifiers through the compatibility function", () => {
    expect(translateD1Sql("UPDATE jobs SET next_run_at=datetime(CURRENT_TIMESTAMP, ?) WHERE id=?")).toBe("UPDATE jobs SET next_run_at=ledgerly_datetime(CURRENT_TIMESTAMP, $1) WHERE id=$2");
  });
  it("preserves INSERT OR IGNORE semantics with PostgreSQL conflict handling", () => {
    expect(translateD1Sql("INSERT OR IGNORE INTO users (id,email) VALUES (?,?)")).toBe("INSERT INTO users (id,email) VALUES ($1,$2) ON CONFLICT DO NOTHING");
  });
  it("validates required self-hosted environment", () => {
    expect(() => loadNodeConfig({ DATABASE_URL: "postgres://localhost/test", JWT_SECRET: "short" } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRET/);
    expect(loadNodeConfig({ DATABASE_URL: "postgres://localhost/test", JWT_SECRET: "x".repeat(32) } as NodeJS.ProcessEnv).PORT).toBe(8787);
  });
  it("stores R2-compatible objects on the local filesystem", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "ledgerly-r2-")); const bucket = new LocalR2Bucket(root);
    await bucket.put("reports/a.txt", "ledgerly", { customMetadata: { kind: "test" } });
    expect(await (await bucket.get("reports/a.txt"))?.text()).toBe("ledgerly");
    expect(await readFile(path.join(root, "reports/a.txt"), "utf8")).toBe("ledgerly");
    await bucket.delete("reports/a.txt"); expect(await bucket.get("reports/a.txt")).toBeNull();
  });
});

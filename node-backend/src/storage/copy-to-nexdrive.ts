/**
 * One-off move of local files into NexDrive: node dist/storage/copy-to-nexdrive.js
 * Run with STORAGE_DRIVER=nexdrive and the NEXDRIVE_* settings. Every file is read back and compared before it
 * counts as copied. Local files are left in place; remove them only after Ledgerly runs on NexDrive.
 */
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "../config/env.js";
import { createPostgresPool } from "../db/pool.js";
import { createLogger } from "../lib/logger.js";
import { LocalStorage } from "./local.js";
import { NexDriveStorage } from "./nexdrive.js";

const types: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".txt": "text/plain", ".csv": "text/csv", ".json": "application/json",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function main() {
  const config = parseEnv();
  if (config.STORAGE_DRIVER !== "nexdrive") throw new Error("Run with STORAGE_DRIVER=nexdrive");
  const db = createPostgresPool(config, createLogger(config.LOG_LEVEL));
  const root = path.resolve(config.STORAGE_LOCAL_ROOT);
  const local = new LocalStorage(root);
  const drive = new NexDriveStorage(config, db);
  await drive.healthcheck();
  let copied = 0, skipped = 0, failed = 0, bytes = 0;
  for await (const file of walk(root)) {
    const key = path.relative(root, file).split(path.sep).join("/");
    try {
      const body = (await local.get(key))!;
      const there = await drive.exists(key) ? await drive.get(key) : null;
      if (there && sha(there) === sha(body)) { skipped++; continue; }
      await drive.put(key, body, types[path.extname(key).toLowerCase()]);
      const back = await drive.get(key);
      if (!back || sha(back) !== sha(body)) throw new Error("read-back mismatch");
      copied++; bytes += body.byteLength;
      console.log(`copied ${key} (${body.byteLength} bytes)`);
    } catch (error) {
      failed++;
      console.error(`FAILED ${key}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`done: ${copied} copied (${bytes} bytes), ${skipped} already there, ${failed} failed`);
  await db.end();
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => { console.error(error); process.exit(1); });

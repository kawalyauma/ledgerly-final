import { constants } from "node:fs";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectStorage } from "./types.js";

export class LocalStorage implements ObjectStorage {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    const resolved = path.resolve(this.root, key.replace(/^\/+/, ""));
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) throw new Error("Invalid storage key");
    return resolved;
  }

  async initialize(): Promise<void> { await mkdir(this.root, { recursive: true }); }

  async put(key: string, body: Uint8Array): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try { return await readFile(this.resolve(key)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async delete(key: string): Promise<void> { await rm(this.resolve(key), { force: true }); }

  async exists(key: string): Promise<boolean> {
    try { await stat(this.resolve(key)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  }

  async healthcheck(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await access(this.root, constants.R_OK | constants.W_OK);
  }
}

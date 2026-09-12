import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

function safePath(root: string, key: string): string {
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, key.replace(/^\/+/, ""));
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) throw new Error("Invalid object key");
  return resolved;
}

async function toBuffer(value: unknown): Promise<Buffer> {
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof Blob) return Buffer.from(await value.arrayBuffer());
  if (value instanceof ReadableStream) {
    const chunks: Uint8Array[] = [];
    const reader = value.getReader();
    while (true) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      if (chunk) chunks.push(chunk as Uint8Array);
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }
  throw new TypeError("Unsupported R2 put body");
}

type StoredMetadata = { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> };

export class LocalR2Bucket {
  private readonly root: string;
  private readonly metadataRoot: string;
  constructor(root: string) { this.root = path.resolve(root); this.metadataRoot = path.join(this.root, ".metadata"); }
  private metadataPath(key: string): string { return path.join(this.metadataRoot, `${createHash("sha256").update(key).digest("hex")}.json`); }
  private async readMetadata(key: string): Promise<StoredMetadata> { try { return JSON.parse(await readFile(this.metadataPath(key), "utf8")) as StoredMetadata; } catch { return {}; } }
  async put(key: string, value: unknown, options?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }): Promise<R2Object> {
    const objectPath = safePath(this.root, key);
    const body = await toBuffer(value);
    await mkdir(path.dirname(objectPath), { recursive: true });
    await mkdir(this.metadataRoot, { recursive: true });
    await writeFile(objectPath, body);
    await writeFile(this.metadataPath(key), JSON.stringify({ httpMetadata: options?.httpMetadata, customMetadata: options?.customMetadata }));
    const uploaded = new Date();
    const etag = createHash("sha256").update(body).digest("hex");
    return { key, version: etag, size: body.length, etag, httpEtag: `"${etag}"`, uploaded, storageClass: "Standard" } as R2Object;
  }
  async get(key: string): Promise<R2ObjectBody | null> {
    const objectPath = safePath(this.root, key);
    let body: Buffer;
    let fileStat: Stats;
    try { [body, fileStat] = await Promise.all([readFile(objectPath), stat(objectPath)]); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    const metadata = await this.readMetadata(key);
    const etag = createHash("sha256").update(body).digest("hex");
    const copy = () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    return {
      key, version: etag, size: body.length, etag, httpEtag: `"${etag}"`, uploaded: fileStat.mtime, storageClass: "Standard",
      httpMetadata: metadata.httpMetadata, customMetadata: metadata.customMetadata,
      body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(body)); controller.close(); } }), bodyUsed: false,
      arrayBuffer: async () => copy(), text: async () => body.toString("utf8"), json: async <T>() => JSON.parse(body.toString("utf8")) as T,
      blob: async () => new Blob([copy()]), writeHttpMetadata: () => undefined,
    } as R2ObjectBody;
  }
  async head(key: string): Promise<R2Object | null> {
    const object = await this.get(key); if (!object) return null;
    const { body: _body, ...head } = object as R2ObjectBody & Record<string, unknown>;
    return head as unknown as R2Object;
  }
  async delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) await Promise.all([rm(safePath(this.root, key), { force: true }), rm(this.metadataPath(key), { force: true })]);
  }
  async list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2Objects> {
    const prefix = options?.prefix ?? ""; const limit = options?.limit ?? 1000; const keys: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      let entries: Dirent[];
      try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) { if (entry.name === ".metadata") continue; const full = path.join(directory, entry.name); if (entry.isDirectory()) await walk(full); else keys.push(path.relative(this.root, full).split(path.sep).join("/")); }
    };
    await walk(this.root);
    const filtered = keys.filter((key) => key.startsWith(prefix) && (!options?.cursor || key > options.cursor)).sort();
    const page = filtered.slice(0, limit);
    const objects = (await Promise.all(page.map((key) => this.head(key)))).filter(Boolean) as R2Object[];
    return { objects, truncated: filtered.length > page.length, cursor: filtered.length > page.length ? page.at(-1) : undefined, delimitedPrefixes: [] } as R2Objects;
  }
}

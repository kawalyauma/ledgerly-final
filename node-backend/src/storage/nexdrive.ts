import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import type { ObjectStorage } from "./types.js";

type NodeRow = { id: string; parent_id: string | null; kind: "file" | "folder"; name: string };

class NexDriveError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/**
 * Keeps Ledgerly's files in a NexDrive workspace. NexDrive addresses files by node id, so the storage key -> node
 * map lives in Ledgerly's database (storage_nexdrive_objects). Folders mirror the key path ("school/org_x/2026/09/...").
 */
export class NexDriveStorage implements ObjectStorage {
  readonly driver = "nexdrive" as const;
  private readonly base: string;
  private readonly auth: string;
  private readonly timeoutMs: number;
  private readonly folders = new Map<string, Promise<string>>();

  constructor(config: AppConfig, private readonly db: Pool) {
    this.base = `${config.NEXDRIVE_URL!.replace(/\/$/, "")}/api/workspaces/${config.NEXDRIVE_WORKSPACE_ID}`;
    this.auth = `Bearer ${config.NEXDRIVE_API_KEY}`;
    this.timeoutMs = config.NEXDRIVE_TIMEOUT_MS;
  }

  private async call(path: string, init: RequestInit = {}, timeoutMs = this.timeoutMs): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", this.auth);
    const response = await fetch(`${this.base}${path}`, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new NexDriveError(response.status, `NexDrive ${init.method ?? "GET"} ${path.split("?")[0]} failed (${response.status}): ${body.error ?? response.statusText}`);
    }
    return response;
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    return await (await this.call(path, init)).json() as T;
  }

  private split(key: string): { dirs: string[]; name: string } {
    const parts = key.replace(/^\/+/, "").split("/");
    if (parts.some(p => !p || p === "." || p === ".." || p.length > 255)) throw new Error("Invalid storage key");
    return { dirs: parts.slice(0, -1), name: parts[parts.length - 1]! };
  }

  /** Finds an item by name in a folder (NexDrive lists return at most 200 items, so a name search backs up the folder list). */
  private async child(parentId: string | null, name: string): Promise<NodeRow | undefined> {
    for (const query of [parentId ? `parentId=${parentId}` : "", `q=${encodeURIComponent(name)}`]) {
      const { nodes } = await this.json<{ nodes: NodeRow[] }>(`/nodes?${query}`);
      const found = nodes.find(n => n.name === name && (n.parent_id ?? null) === parentId);
      if (found) return found;
    }
    return undefined;
  }

  /** Folder id for a key directory, creating missing folders (cached in memory and in the database). */
  private folder(dirs: string[]): Promise<string | null> {
    if (!dirs.length) return Promise.resolve(null);
    const path = dirs.join("/");
    let pending = this.folders.get(path);
    if (!pending) {
      pending = (async () => {
        const saved = await this.db.query<{ nodeId: string }>(`SELECT node_id AS "nodeId" FROM storage_nexdrive_folders WHERE path=$1`, [path]);
        if (saved.rows[0]) return saved.rows[0].nodeId;
        const parentId = await this.folder(dirs.slice(0, -1));
        const name = dirs[dirs.length - 1]!;
        let id: string;
        try {
          id = (await this.json<{ id: string }>("/folders", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, parentId }),
          })).id;
        } catch (error) {
          if (!(error instanceof NexDriveError && error.status === 409)) throw error;
          const found = await this.child(parentId, name);
          if (!found) throw error;
          id = found.id;
        }
        await this.db.query(`INSERT INTO storage_nexdrive_folders(path,node_id) VALUES($1,$2) ON CONFLICT (path) DO UPDATE SET node_id=EXCLUDED.node_id`, [path, id]);
        return id;
      })();
      this.folders.set(path, pending);
      pending.catch(() => this.folders.delete(path));
    }
    return pending;
  }

  private async upload(parentId: string | null, name: string, body: Uint8Array, contentType?: string): Promise<string> {
    const form = new FormData();
    form.set("file", new Blob([Buffer.from(body)], { type: contentType || "application/octet-stream" }), name);
    const query = parentId ? `?parentId=${parentId}` : "";
    return (await this.json<{ id: string }>(`/upload${query}`, { method: "POST", body: form })).id;
  }

  private async remove(nodeId: string): Promise<void> {
    for (const [path, method] of [[`/nodes/${nodeId}/trash`, "POST"], [`/nodes/${nodeId}`, "DELETE"]] as const) {
      try { await this.call(path, { method }); }
      catch (error) { if (!(error instanceof NexDriveError && error.status === 404)) throw error; }
    }
  }

  async initialize(): Promise<void> {
    // No network call here: Ledgerly still starts when the drive is briefly unreachable; healthcheck reports it.
  }

  async put(key: string, body: Uint8Array, contentType?: string): Promise<void> {
    try { await this.write(key, body, contentType); }
    catch (error) {
      if (!(error instanceof NexDriveError && error.status === 404)) throw error;
      // A folder was removed in the drive: forget the cached folders for this key and write again.
      const dirs = this.split(key).dirs;
      const paths = dirs.map((_, i) => dirs.slice(0, i + 1).join("/"));
      paths.forEach(p => this.folders.delete(p));
      await this.db.query(`DELETE FROM storage_nexdrive_folders WHERE path = ANY($1::text[])`, [paths]);
      await this.write(key, body, contentType);
    }
  }

  private async write(key: string, body: Uint8Array, contentType?: string): Promise<void> {
    const { dirs, name } = this.split(key);
    const parentId = await this.folder(dirs);
    const earlier = await this.db.query<{ nodeId: string }>(`SELECT node_id AS "nodeId" FROM storage_nexdrive_objects WHERE object_key=$1`, [key]);
    const old = earlier.rows[0]?.nodeId;
    let nodeId: string;
    if (old) {
      // Replacing: upload beside the old file, drop the old one, then take its name.
      nodeId = await this.upload(parentId, `${name}.${randomUUID().slice(0, 8)}.part`, body, contentType);
      await this.remove(old);
      await this.call(`/nodes/${nodeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) })
        .catch(() => undefined); // the key map, not the name, is what Ledgerly reads by
    } else {
      try {
        nodeId = await this.upload(parentId, name, body, contentType);
      } catch (error) {
        if (!(error instanceof NexDriveError && error.status === 409)) throw error;
        // A file with this name but no key mapping (an interrupted earlier write): replace it.
        const stale = await this.child(parentId, name);
        if (stale) await this.remove(stale.id);
        nodeId = await this.upload(parentId, name, body, contentType);
      }
    }
    await this.db.query(
      `INSERT INTO storage_nexdrive_objects(object_key,node_id,size_bytes,content_type) VALUES($1,$2,$3,$4)
       ON CONFLICT (object_key) DO UPDATE SET node_id=EXCLUDED.node_id,size_bytes=EXCLUDED.size_bytes,content_type=EXCLUDED.content_type,updated_at=CURRENT_TIMESTAMP`,
      [key, nodeId, body.byteLength, contentType ?? null]);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const row = await this.db.query<{ nodeId: string }>(`SELECT node_id AS "nodeId" FROM storage_nexdrive_objects WHERE object_key=$1`, [key]);
    if (!row.rows[0]) return null;
    try {
      return new Uint8Array(await (await this.call(`/nodes/${row.rows[0].nodeId}/download`)).arrayBuffer());
    } catch (error) {
      if (error instanceof NexDriveError && error.status === 404) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const row = await this.db.query<{ nodeId: string }>(`SELECT node_id AS "nodeId" FROM storage_nexdrive_objects WHERE object_key=$1`, [key]);
    if (!row.rows[0]) return;
    await this.remove(row.rows[0].nodeId);
    await this.db.query(`DELETE FROM storage_nexdrive_objects WHERE object_key=$1`, [key]);
  }

  async exists(key: string): Promise<boolean> {
    const row = await this.db.query(`SELECT 1 FROM storage_nexdrive_objects WHERE object_key=$1`, [key]);
    return Boolean(row.rowCount);
  }

  async healthcheck(): Promise<void> {
    await this.call("/usage", {}, 10000);
  }
}

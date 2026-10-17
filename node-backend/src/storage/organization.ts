import type { ObjectStorage } from "./types.js";

/**
 * Routing between remote storage and the server's disk. Keys of the listed organizations, and keys under the
 * listed prefixes (e.g. "printerly/": receipts must print even when remote storage is down), stay on the server.
 * Prefix-routed reads fall back to remote storage for objects written there before the rule existed.
 */
export class OrganizationStorage implements ObjectStorage {
  readonly driver: ObjectStorage["driver"];
  private readonly organizations: Set<string>;
  constructor(private readonly primary: ObjectStorage, private readonly local: ObjectStorage, organizations: string[], private readonly prefixes: string[] = []) {
    this.driver = primary.driver;
    this.organizations = new Set(organizations);
  }
  private parts(key: string) {
    const parts = key.replace(/^\/+/, "").split("/");
    if (parts.some(part => part === "." || part === "..")) throw new Error("Invalid storage key");
    return parts;
  }
  private byPrefix(key: string) { const k = key.replace(/^\/+/, ""); return this.prefixes.some(p => k.startsWith(p)); }
  private byOrganization(key: string) { return this.parts(key).some(part => this.organizations.has(part)); }
  private storage(key: string): ObjectStorage { return this.byPrefix(key) || this.byOrganization(key) ? this.local : this.primary; }
  /** Only prefix-routed keys of other organizations may still have an older copy on remote storage. */
  private fallsBack(key: string) { return this.byPrefix(key) && !this.byOrganization(key); }
  async initialize(): Promise<void> { await this.local.initialize(); await this.primary.initialize(); }
  put(key: string, body: Uint8Array, contentType?: string): Promise<void> { return this.storage(key).put(key, body, contentType); }
  // Keys are validated synchronously (an invalid key throws before any I/O), then the routed store is used.
  get(key: string): Promise<Uint8Array | null> {
    const store = this.storage(key);
    return store.get(key).then(found => found === null && this.fallsBack(key) ? this.primary.get(key).catch(() => null) : found);
  }
  delete(key: string): Promise<void> {
    const store = this.storage(key);
    return store.delete(key).then(() => this.fallsBack(key) ? this.primary.delete(key).catch(() => undefined) : undefined);
  }
  exists(key: string): Promise<boolean> {
    const store = this.storage(key);
    return store.exists(key).then(found => found || (this.fallsBack(key) ? this.primary.exists(key).catch(() => false) : false));
  }
  async healthcheck(): Promise<void> { await this.local.healthcheck(); await this.primary.healthcheck(); }
}

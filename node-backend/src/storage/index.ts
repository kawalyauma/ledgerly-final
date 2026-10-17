import type { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import { LocalStorage } from "./local.js";
import { MinioStorage } from "./minio.js";
import { NexDriveStorage } from "./nexdrive.js";
import type { ObjectStorage } from "./types.js";
import { OrganizationStorage } from "./organization.js";

export function createStorage(config: AppConfig, db: Pool): ObjectStorage {
  const local = new LocalStorage(config.STORAGE_LOCAL_ROOT);
  const primary = config.STORAGE_DRIVER === "nexdrive" ? new NexDriveStorage(config, db)
    : config.STORAGE_DRIVER === "minio" ? new MinioStorage(config) : local;
  const organizations = (config.STORAGE_LOCAL_ORGANIZATION_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
  // Printerly files (receipt PDFs, print and scan documents) always live on the server's own disk.
  const prefixes = (process.env.STORAGE_LOCAL_PREFIXES ?? "printerly/").split(",").map(p => p.trim()).filter(Boolean);
  return (organizations.length || prefixes.length) && primary !== local ? new OrganizationStorage(primary, local, organizations, prefixes) : primary;
}

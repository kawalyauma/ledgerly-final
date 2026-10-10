import type { Pool } from "pg";
import type { AppConfig } from "../config/env.js";
import { LocalStorage } from "./local.js";
import { MinioStorage } from "./minio.js";
import { NexDriveStorage } from "./nexdrive.js";
import type { ObjectStorage } from "./types.js";

export function createStorage(config: AppConfig, db: Pool): ObjectStorage {
  if (config.STORAGE_DRIVER === "nexdrive") return new NexDriveStorage(config, db);
  return config.STORAGE_DRIVER === "minio" ? new MinioStorage(config) : new LocalStorage(config.STORAGE_LOCAL_ROOT);
}

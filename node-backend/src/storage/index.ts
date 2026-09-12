import type { AppConfig } from "../config/env.js";
import { LocalStorage } from "./local.js";
import { MinioStorage } from "./minio.js";
import type { ObjectStorage } from "./types.js";

export function createStorage(config: AppConfig): ObjectStorage {
  return config.STORAGE_DRIVER === "minio" ? new MinioStorage(config) : new LocalStorage(config.STORAGE_LOCAL_ROOT);
}

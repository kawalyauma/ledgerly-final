export interface ObjectStorage {
  readonly driver: "local" | "minio";
  initialize(): Promise<void>;
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  healthcheck(): Promise<void>;
}

import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";

const base = {
  DATABASE_URL: "postgresql://ledgerly:secret@127.0.0.1:5432/ledgerly",
  JWT_SECRET: "12345678901234567890123456789012",
};

describe("environment configuration", () => {
  it("parses safe defaults", () => {
    const config = parseEnv(base);
    expect(config.PORT).toBe(8080);
    expect(config.STORAGE_DRIVER).toBe("local");
    expect(config.CORS_ORIGINS).toEqual(["http://localhost:5173"]);
  });

  it("requires MinIO credentials when MinIO is selected", () => {
    expect(() => parseEnv({ ...base, STORAGE_DRIVER: "minio" })).toThrow(/S3_ENDPOINT/);
  });
});

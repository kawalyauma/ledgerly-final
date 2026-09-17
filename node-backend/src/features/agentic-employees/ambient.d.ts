// The ported agentic-employees files (originally written for Cloudflare D1)
// reference the ambient D1Database type. Declare it loosely here since these
// files now run against the Postgres-backed D1CompatDatabase from d1-compat.ts.
declare global {
  type D1Database = any;
}
export {};

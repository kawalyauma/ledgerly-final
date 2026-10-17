#!/bin/sh
# Run on the deployment host, from the checked-out project.
set -eu
cd "$(dirname "$0")/.."
command -v docker >/dev/null 2>&1 || { echo 'Docker is required on the deployment host.' >&2; exit 1; }
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
const env = readFileSync('.env', 'utf8');
const ids = env.match(/^STORAGE_LOCAL_ORGANIZATION_IDS=(.*)$/m)?.[1].split(',').map(x => x.trim()) ?? [];
if (!ids.includes('org_056e6a51a5e34628b3874570ed0494e9')) {
  throw new Error('School server-storage override is missing; deployment stopped.');
}
JS
docker compose build api queue scheduler
docker compose up -d --no-deps --force-recreate api queue scheduler
docker compose exec -T api node --input-type=module <<'JS'
import { randomUUID } from 'node:crypto';
import { parseEnv } from './dist/config/env.js';
import { createStorage } from './dist/storage/index.js';
const config = parseEnv();
const org = 'org_056e6a51a5e34628b3874570ed0494e9';
if (!config.STORAGE_LOCAL_ORGANIZATION_IDS.split(',').map(x => x.trim()).includes(org)) throw new Error('Live override missing');
globalThis.fetch = async () => { throw new Error('Storage verification unexpectedly contacted a remote service'); };
const storage = createStorage(config, { query: async () => { throw new Error('Storage verification unexpectedly contacted the remote mapping database'); } });
const key = `ledgerly-ai/${org}/outputs/storage-check-${randomUUID()}/check.txt`;
try {
  await storage.put(key, Buffer.from('server-storage-ok'));
  if (Buffer.from(await storage.get(key) ?? []).toString() !== 'server-storage-ok') throw new Error('Storage readback failed');
  console.log('School server storage verified in running API.');
} finally { await storage.delete(key); }
JS

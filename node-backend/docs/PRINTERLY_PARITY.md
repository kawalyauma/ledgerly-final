# Printerly Node-backend parity audit

This document tracks migration of the Cloudflare Printerly module into the standalone Node/PostgreSQL backend.

## Implemented in Node foundation

- `/api/v1/printerly/manifest`
- overview counters
- organization Printerly nodes
- node pairing-code creation and revocation
- printers inventory/listing schema
- printable document staging using shared local/MinIO object storage
- SHA-256 document checksums
- print-job creation
- held/queued secure-release foundation
- job release and cancellation
- print-job event schema
- PostgreSQL tenant isolation

## Cloudflare parity still required

- public node pairing/authentication and token rotation
- node heartbeat and printer capability synchronization
- job claiming, lease renewal, download authorization, completion and failure callbacks
- batch printing and due-batch dispatch
- printer-pool routing and rerouting
- secure-release credentials and cleanup
- document retention and expiry sweeps
- costing profiles, cost ledger and Finance journal posting
- usage reports and CSV export
- quotas, quota reservations and hard enforcement
- print rules, policy preview and approval workflows
- printer health, alerts and preferences
- Scannerly scanners, scan jobs and module inbox routing
- consumables inventory and low-stock sweeps
- procurement workflows
- service desk and maintenance workflows
- Printerly audit endpoints
- mobile options and sync parity

## Runtime replacement mapping

- D1 -> PostgreSQL
- R2 `WORK_FILES_BUCKET` -> Node `ObjectStorage` using local disk or MinIO
- Worker scheduled handlers -> Node scheduler plus durable PostgreSQL queue
- Worker routes -> standalone Hono Node feature routes

Keep the Cloudflare Printerly module available as fallback until the remaining surfaces are implemented and validated against real node appliances and print jobs.

# SchoolPay production setup

This module integrates each Ledgerly school/tenant with its own SchoolPay Uganda account while preserving one Ledgerly accounting/posting path.

## Required configuration

Set these server environment values before enabling SchoolPay:

- `SCHOOLPAY_API_BASE_URL=https://schoolpay.co.ug`
- `SCHOOLPAY_PUBLIC_BASE_URL=https://<public-ledgerly-api-host>`
- `SCHOOLPAY_SECRET_ENCRYPTION_KEY=<separate random 32+ character secret>`
- `SCHOOLPAY_TRUSTED_PROXY_IPS=127.0.0.1,::1` when Caddy/Nginx terminates HTTPS on the same host. Add only reverse proxies you operate and trust.

Each school then configures its own SchoolPay `schoolCode`, API password, Ledgerly bank account and receivable control account through `PUT /api/v1/schoolpay/config`.

Do not put a school's SchoolPay password in environment variables. Ledgerly encrypts each tenant password with AES-256-GCM using `SCHOOLPAY_SECRET_ENCRYPTION_KEY`.

## Public SchoolPay endpoints

For the tenant-specific opaque webhook key returned in the SchoolPay config summary:

- Standard SchoolPay webhook: `POST /webhooks/schoolpay/<webhookKey>`
- Ad-hoc callback: `POST /webhooks/schoolpay/<webhookKey>/adhoc`

`SCHOOLPAY_PUBLIC_BASE_URL` must be publicly reachable over HTTPS for ad-hoc callbacks.

## IP allowlisting

SchoolPay documentation states that source IP addresses can be provided on request. Do not invent or guess them.

1. Ask SchoolPay for the current production webhook/callback source IP addresses or IPv4 CIDR ranges.
2. Put them in a comma-separated `SCHOOLPAY_WEBHOOK_IP_ALLOWLIST`.
3. Leave `SCHOOLPAY_ENFORCE_WEBHOOK_IP_ALLOWLIST=false` during initial verification.
4. Confirm real SchoolPay requests appear with the expected source addresses in `GET /api/v1/schoolpay/security-audit`.
5. Enable `SCHOOLPAY_ENFORCE_WEBHOOK_IP_ALLOWLIST=true` only after the list has been verified.

When enforcement is enabled with an empty allowlist, the backend refuses to start because that configuration would block every SchoolPay request.

## Reverse proxy safety

Ledgerly obtains the direct peer address from the Node/Hono connection. It trusts `X-Forwarded-For` only when that direct peer matches `SCHOOLPAY_TRUSTED_PROXY_IPS`.

For a same-host Caddy/Nginx deployment, keep the default trusted proxies limited to loopback unless your architecture requires more. Never add the public internet (`0.0.0.0/0`) to the trusted proxy list.

If several trusted proxies are in the forwarded chain, Ledgerly walks the chain from the server side and selects the nearest non-trusted address as the effective source. This prevents a client-supplied leftmost forwarded address from being blindly trusted.

## Security layers

Standard SchoolPay fee webhooks are protected by:

1. Opaque tenant webhook URL key.
2. Optional source-IP allowlist.
3. SchoolPay SHA-256 signature validation using the tenant's API password and SchoolPay receipt number.
4. Durable unique receipt capture/idempotency.
5. Ledgerly payment idempotency.

Ad-hoc callbacks are protected by:

1. Opaque tenant callback URL key.
2. Optional source-IP allowlist.
3. Amount matching against the durable intent.
4. Callback status/return-code checks.
5. A server-to-server SchoolPay `AdhocPayments/Check` verification before Ledgerly posts the payment.
6. Advisory locks and normal Ledgerly posting idempotency.

## Security audit

`GET /api/v1/schoolpay/security-audit?limit=100` returns recent SchoolPay request-security events for the authenticated school.

The audit stores source/direct-peer IPs, forwarded chain, endpoint type, outcome, provider identifier and a short reason. It does not store the SchoolPay API password, webhook signature, encryption key or raw payment body.

`GET /api/v1/schoolpay/diagnostics` also reports 24-hour processed/rejected/invalid/failed webhook counts, allowlist state, trusted proxy rule count, reconciliation freshness and ad-hoc recovery health.

## Schedulers that must run

The Node scheduler and queue worker are required in production:

- `schoolpay.reconcile` — hourly at minute 15. Recovers normal SchoolPay transactions missed by the one-attempt webhook.
- `schoolpay.adhoc_recover` — every 5 minutes. Polls unresolved ad-hoc payment references with persisted backoff.

A SchoolPay deployment is not healthy if only the API process is running. Run the API, scheduler and queue worker under systemd/Docker Compose restart policies.

## Go-live checklist

- Run all PostgreSQL migrations through `0096_schoolpay_webhook_security.sql`.
- Configure a strong SchoolPay encryption master key.
- Configure the public HTTPS API origin.
- Configure and verify one school's SchoolPay account first.
- Register the exact tenant webhook URL in SchoolPay.
- Make a low-value test payment and verify `schoolpay_events`, Ledgerly payment posting and `school_fee_receipts`.
- Verify reconciliation can replay the same transaction without creating a duplicate.
- Test an ad-hoc request and verify callback/status-check finalization.
- Verify scheduler and queue worker processes are running.
- Obtain official SchoolPay webhook IPs, observe them in audit logs, then enable allowlist enforcement.
- Review `/api/v1/schoolpay/diagnostics` until status is `healthy`.

## Troubleshooting

- `SCHOOLPAY_SOURCE_IP_FORBIDDEN`: compare the audit source IP with the official SchoolPay list and confirm the reverse-proxy trust list is correct. Do not disable signature verification.
- `INVALID_SCHOOLPAY_SIGNATURE`: verify that the correct tenant SchoolPay API password is configured.
- `SCHOOLPAY_ADHOC_CHECK_REJECTED`: check provider connectivity and the stored payment reference; automatic recovery will retry with backoff.
- `unmatched`: SchoolPay `studentPaymentCode` did not match an active `school_students.id` with a finance contact. Ledgerly intentionally does not fall back to admission number.
- stale reconciliation: verify the scheduler and queue worker are running and can reach SchoolPay.

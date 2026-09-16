# Ledgerly self-host NGINX routing

`ledgerly-api-routes.conf` is the canonical API routing fragment for the split self-host runtime.

## Runtime ports

- `127.0.0.1:8080` — primary Ledgerly Node API.
- `127.0.0.1:8787` — modular/self-host API used by Agentic Employees and File Manager during the migration period.
- `8788` — **not used** by this topology. Do not route production API traffic to it.

## Install

Include `ledgerly-api-routes.conf` inside the Ledgerly NGINX `server {}` block, then validate and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

The important routing invariants are:

```text
/api/v1/agentic-employees/* -> 127.0.0.1:8787
/api/v1/files*              -> 127.0.0.1:8787
/api/v1/schoolpay*          -> 127.0.0.1:8080
/api/v1/printerly/receipt-printing/* -> 127.0.0.1:8080
/api/v1/*                   -> 127.0.0.1:8080
/api|/auth|/system          -> 127.0.0.1:8080
/openapi.json               -> 127.0.0.1:8080
```

## Authentication parity

The Node API and modular API must validate the same token authority. Keep all three values aligned across both runtimes:

```text
JWT_SECRET=<same secret>
JWT_ISSUER=your-finance-pro
JWT_AUDIENCE=your-finance-pro-api
```

A mismatched issuer or audience causes the modular API to return `401 Access token is invalid or expired` even when the browser token is valid for the Node API.

## Verification

After deployment:

```bash
sudo nginx -T 2>/dev/null | grep -nE 'proxy_pass|8080|8787|8788'
curl -i http://127.0.0.1/api/v1/school/student-management/students
curl -i http://127.0.0.1/api/v1/agentic-employees/tasks
```

Without a bearer token, protected endpoints may return `401`; that is expected. A `502` indicates an upstream routing/listener problem. There should be no active `proxy_pass` to `127.0.0.1:8788`.

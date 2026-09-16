# Ledgerly self-host NGINX routing

`ledgerly-api-routes.conf` is the canonical API routing fragment for the split self-host runtime.

## Runtime ports

- `127.0.0.1:8080` — primary Ledgerly Node API.
- `127.0.0.1:8787` — modular/self-host API used by Agentic Employees and File Manager during migration.
- `8788` — **unused** in this topology. Do not route production API traffic to it.

## Install

Include `ledgerly-api-routes.conf` inside the Ledgerly NGINX `server {}` block, then validate and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Expected routing:

```text
/api/v1/agentic-employees/*           -> 127.0.0.1:8787
/api/v1/files*                        -> 127.0.0.1:8787
/api/v1/schoolpay*                    -> 127.0.0.1:8080
/api/v1/printerly/receipt-printing/*  -> 127.0.0.1:8080
/api/v1/*                             -> 127.0.0.1:8080
/api|/auth|/system                    -> 127.0.0.1:8080
/openapi.json                         -> 127.0.0.1:8080
```

## Authentication parity

The Node API and modular API must validate one token authority:

```text
JWT_SECRET=<same secret>
JWT_ISSUER=your-finance-pro
JWT_AUDIENCE=your-finance-pro-api
```

If the secret matches but issuer or audience differs, the modular API returns `401 Access token is invalid or expired` for otherwise valid browser tokens.

## Verification

```bash
sudo nginx -T 2>/dev/null | grep -nE 'proxy_pass|8080|8787|8788'
curl -i http://127.0.0.1/api/v1/school/student-management/students
curl -i http://127.0.0.1/api/v1/agentic-employees/tasks
```

Protected endpoints may return `401` when no token is supplied. That confirms routing reached an API. A `502` indicates an upstream/listener problem. There should be no active `proxy_pass` to `127.0.0.1:8788`.

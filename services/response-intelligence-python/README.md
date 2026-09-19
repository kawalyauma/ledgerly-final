# Ledgerly Response Intelligence — Python Service

This is Ledgerly's standalone **professional response and explanation engine**.

It is deliberately separate from the main Node backend. Ledgerly remains the source of truth for students, staff, accounts, attendance, academics, fees, journals, reports and other business records. This service receives verified semantic data and turns it into a well-reasoned, human-facing response.

## Why it exists

A normal language model can write fluently but may:
- repeat the same report structure,
- overstate causes,
- introduce unsupported numbers,
- write generic AI filler,
- ignore counter-evidence,
- fail to adapt its language to finance, teaching or management contexts.

Response Intelligence uses a multi-stage pipeline instead:

```text
Verified Ledgerly data
        ↓
Semantic normalizer
        ↓
Evidence / fact graph
        ↓
Deterministic reasoning
  • current vs previous changes
  • period comparisons
  • outliers
  • recorded relationships
  • evidence gaps
        ↓
Discourse strategy selector
  • evidence-first
  • contrast-first
  • trend-first
  • exception-first
  • management-first
  • diagnostic
  • competing explanations
  • chronological explanation
  • baseline explanation
  • counter-evidence-led
  • executive brief
  • narrative report
  • audit style
  • recommendation-led
  • technical evidence
  • plain explanation
        ↓
Language retrieval + register selection
        ↓
Provider generation (optional)
        ↓
Professional critic
  • grounding
  • completeness
  • readability
  • naturalness
  • variation vs recent responses
  • causal safety
  • professionalism
        ↓
Revision loop
        ↓
Safety fallback if fluent output is less grounded
        ↓
Final response
```

The Python service can operate with **no external LLM at all**. In that mode it uses its deterministic reasoning and realization engine. When a provider is configured, the provider is used as a fluent surface realizer and the result is still criticized and revised.

## Per-school provider delegation

When the Node backend calls this service, it delegates the **already resolved provider for that school** with the request over the private service connection. The delegated credential is represented as a Pydantic secret, used only to make the outbound model request, and is never included in `ResponseResult`.

This preserves Ledgerly's existing provider choice:

```text
School A → OpenAI Responses
School B → Anthropic
School C → Gemini OpenAI-compatible endpoint
School D → OpenRouter
School E → Ollama on the LAN
School F → Custom OpenAI-compatible endpoint
```

A service-wide `RIE_PROVIDER` is optional and acts as a fallback for callers that do not delegate a provider. For normal Ledgerly Node requests, the school's own configured provider is preferred.

Keep the Node ↔ Python service connection private because delegated requests can contain the school's model credential in transit. Use the service token even on a private network.

## Supported AI providers

The service is provider-agnostic.

### OpenAI-compatible

Use this for OpenAI, OpenRouter, Groq, Ollama, LM Studio, vLLM or another compatible endpoint.

```bash
RIE_PROVIDER=openai-compatible
RIE_BASE_URL=https://api.openai.com/v1
RIE_MODEL=gpt-5.6
RIE_API_KEY=...
```

Local Ollama-compatible example:

```bash
RIE_PROVIDER=openai-compatible
RIE_BASE_URL=http://127.0.0.1:11434/v1
RIE_MODEL=qwen3:14b
RIE_API_KEY=
```

### Anthropic

```bash
RIE_PROVIDER=anthropic
RIE_MODEL=claude-sonnet-4-5
RIE_API_KEY=...
```

Model IDs are configuration values; use a model actually available to the configured provider.

## Run locally

```bash
cd services/response-intelligence-python
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
pytest
ledgerly-response-intelligence serve
```

The default service address is:

```text
http://127.0.0.1:8091
```

Container deployment is also included:

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
```

The Compose service binds only to `127.0.0.1:8091` by default and includes a health check.

Health:

```bash
curl http://127.0.0.1:8091/health
```

## Connect Ledgerly Node backend

In `node-backend/.env`:

```bash
RESPONSE_INTELLIGENCE_URL=http://127.0.0.1:8091
RESPONSE_INTELLIGENCE_TOKEN=<same value as RIE_API_TOKEN>
RESPONSE_INTELLIGENCE_TIMEOUT_MS=30000
```

When configured, Agentic Employees uses Python first for:
- ordinary Light Mode answers,
- composite reports,
- `/analyse`,
- `/account for`.

If Python is unreachable, Ledgerly automatically falls back to the TypeScript response layer.

## HTTP API

### POST /v1/respond

Example:

```json
{
  "request_id": "rsp_example",
  "purpose": "account-for",
  "request": "Account for Mukisa Abraham's academic decline.",
  "detail": "deep",
  "provider_mode": "auto",
  "context": {
    "audience": "Director of Studies",
    "entity_type": "student",
    "entity_label": "Mukisa Abraham",
    "recent_responses": [],
    "locale": "en-UG",
    "currency": "UGX"
  },
  "semantic_payload": {
    "rows": [
      {
        "studentId": "std_1",
        "studentName": "Mukisa Abraham",
        "currentAverage": 49,
        "previousAverage": 68,
        "attendancePercent": 72
      }
    ],
    "limitations": [
      "No verified lesson-delivery record is available for the same period."
    ]
  }
}
```

The response contains:
- final human text,
- discourse plan and selected strategy,
- normalized evidence,
- deterministic reasoning insights,
- quality scores,
- revision count,
- response fingerprint,
- provider/model information,
- tool events.

### POST /v1/plan

Returns the discourse plan without generating a final response.

### POST /v1/reason

Returns deterministic, fact-linked reasoning insights without generating prose. This is useful for debugging, audit views and future external-knowledge retrieval.

### POST /v1/evaluate

Scores an existing response against verified evidence.

### GET /v1/library/stats

Returns language-library statistics.

## Future web search

The tool interface already exists under `ledgerly_response_intelligence.tools`.

`web.search` is intentionally registered as unavailable by default. Later, a search provider can be added behind:
- `RIE_ALLOW_EXTERNAL_TOOLS=true`
- `RIE_ALLOW_WEB_SEARCH=true`

External results should enter the same evidence model with provenance, timestamps and source metadata. The reasoning and critic layers do not need to be redesigned.

## Security

- Use `RIE_API_TOKEN` in production.
- Keep the service on a private host/network where possible.
- Do not expose provider API keys through the response API.
- Ledgerly sends semantic evidence, not direct database credentials.
- The critic rejects unsupported numeric claims and weak causal language.
- If provider output remains insufficiently grounded after revision, the engine prefers a deterministic safety fallback.

## Development quality gates

```bash
ruff check src tests
mypy src
pytest
```

The GitHub workflow also contains a dedicated Python Response Intelligence job. If GitHub runner infrastructure is unavailable, these commands should be run locally before deployment.

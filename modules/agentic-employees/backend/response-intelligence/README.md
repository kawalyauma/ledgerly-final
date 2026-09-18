# Response Intelligence

Response Intelligence is Ledgerly's separate natural-language realization layer.

It sits **after** factual retrieval and analysis:

```
Ledgerly data/tools
      ↓
Evidence / analysis engine
      ↓
Structured semantic result
      ↓
Response Intelligence
      ↓
Human-facing report / explanation / reply
```

The language layer does not decide what is true. It decides how verified content should
be expressed: register, cadence, transitions, comparison language, uncertainty,
causal caution, section naming, recommendations, and anti-repetition choices.

## Design

- `library.ts` — compositional language library and response registers.
- `engine.ts` — seeded variation, discourse planning, realization prompts,
  fallback prose, response fingerprints, and template-risk detection.
- `engine.test.ts` — variation and fact-preservation checks.
- `tools/response-intelligence/audit_library.py` — offline Python auditor for
  keeping the Cloudflare and Node language packs synchronized.

The library is intentionally **not** a bank of complete report templates. Short
language moves are composed into millions of possible discourse structures, and the
configured AI provider realizes the final response from the structured evidence.

Production has no Python dependency. Python is only used as a development/audit tool
so the same TypeScript implementation works in Cloudflare Workers and the self-hosted
Node runtime.

#!/usr/bin/env python3
"""Audit Ledgerly's Response Intelligence language pack.

This is an offline development tool only. The production runtime stays TypeScript so
Cloudflare Workers and the self-hosted Node backend use the same response behavior.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODULE = ROOT / "modules/agentic-employees/backend/response-intelligence/library.ts"
DEFAULT_NODE = ROOT / "node-backend/src/features/agentic-employees/response-intelligence/library.ts"

STRING_RE = re.compile(r'"(?:\\.|[^"\\])*"')


def response_object(source: str) -> str:
    start = source.find("export const RESPONSE_LIBRARY={")
    end = source.find("} as const;", start)
    if start < 0 or end < 0:
        raise ValueError("RESPONSE_LIBRARY object not found")
    return source[start : end + len("} as const;")]


def audit(path: Path) -> dict[str, object]:
    source = path.read_text(encoding="utf-8")
    obj = response_object(source)
    string_literals = STRING_RE.findall(obj)
    paragraph_match = re.search(
        r"paragraphPatterns:\[(.*?)\]\s+as\s+ResponseMove\[\]\[\]",
        obj,
        re.S,
    )
    paragraph_patterns = 0
    if paragraph_match:
        paragraph_patterns = len(re.findall(r"\[\s*\"", paragraph_match.group(1)))

    registers_match = re.search(r"registers:\{(.*?)\n\s*\},\n\s*paragraphPatterns", obj, re.S)
    register_count = 0
    if registers_match:
        register_count = len(
            re.findall(r'^\s*(?:"[^"]+"|[a-zA-Z][\w-]*):\{sentenceTarget:', registers_match.group(1), re.M)
        )

    banned_match = re.search(r"bannedBoilerplate:\[(.*?)\]\s*,\n\s*verbs:", obj, re.S)
    banned_count = len(STRING_RE.findall(banned_match.group(1))) if banned_match else 0

    return {
        "path": str(path.relative_to(ROOT)),
        "bytes": len(source.encode("utf-8")),
        "response_object_strings": len(string_literals),
        "paragraph_patterns": paragraph_patterns,
        "registers": register_count,
        "banned_boilerplate": banned_count,
        "sha256": hashlib.sha256(source.encode("utf-8")).hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--module", type=Path, default=DEFAULT_MODULE)
    parser.add_argument("--node", type=Path, default=DEFAULT_NODE)
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    args = parser.parse_args()

    module = audit(args.module)
    node = audit(args.node)
    module_text = args.module.read_text(encoding="utf-8")
    node_text = args.node.read_text(encoding="utf-8")
    mirrors_equal = module_text == node_text

    result = {
        "response_intelligence": {
            "module": module,
            "node": node,
            "mirrors_equal": mirrors_equal,
            "note": "Runtime combinatorial counts are computed by responseLibraryStats() in TypeScript.",
        }
    }

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print("Ledgerly Response Intelligence")
        print(f"  language strings: {module['response_object_strings']}")
        print(f"  paragraph patterns: {module['paragraph_patterns']}")
        print(f"  registers: {module['registers']}")
        print(f"  stale-expression guards: {module['banned_boilerplate']}")
        print(f"  module/node mirrors equal: {mirrors_equal}")
        print(f"  module SHA256: {module['sha256']}")

    return 0 if mirrors_equal else 2


if __name__ == "__main__":
    raise SystemExit(main())

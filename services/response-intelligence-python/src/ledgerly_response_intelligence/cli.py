from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

import uvicorn

from .config import get_settings
from .engine import ResponseIntelligenceEngine
from .models import ResponseRequest


async def _respond(path: Path) -> None:
    payload = json.loads(path.read_text(encoding="utf-8"))
    request = ResponseRequest.model_validate(payload)
    result = await ResponseIntelligenceEngine(get_settings()).respond(request)
    print(result.model_dump_json(indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(prog="ledgerly-response-intelligence")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("serve")
    respond = sub.add_parser("respond")
    respond.add_argument("file", type=Path)
    args = parser.parse_args()
    settings = get_settings()
    if args.command == "serve":
        uvicorn.run(
            "ledgerly_response_intelligence.api:app",
            host=settings.host,
            port=settings.port,
            log_level=settings.log_level.lower(),
        )
    else:
        asyncio.run(_respond(args.file))


if __name__ == "__main__":
    main()

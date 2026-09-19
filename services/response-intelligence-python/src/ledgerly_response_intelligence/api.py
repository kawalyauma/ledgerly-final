from __future__ import annotations

import logging
from functools import lru_cache

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

from . import __version__
from .config import Settings, get_settings
from .engine import ResponseIntelligenceEngine
from .library import language_stats
from .models import (
    DiscoursePlan,
    EvaluationRequest,
    QualityReport,
    ReasoningResult,
    ResponseRequest,
    ResponseResult,
)
from .semantic import merge_evidence


logging.basicConfig(level=get_settings().log_level)
app = FastAPI(
    title="Ledgerly Response Intelligence",
    version=__version__,
    description="Evidence-grounded professional response planning, realization and quality control.",
)

MAX_BODY_BYTES = 3 * 1024 * 1024


@app.middleware("http")
async def limit_request_body(request: Request, call_next: RequestResponseEndpoint) -> Response:
    if request.method in {"POST", "PUT", "PATCH"}:
        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > MAX_BODY_BYTES:
                    return JSONResponse(
                        {"detail": "Request payload is too large."},
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    )
            except ValueError:
                pass
    return await call_next(request)


@lru_cache(maxsize=1)
def get_engine() -> ResponseIntelligenceEngine:
    return ResponseIntelligenceEngine(get_settings())


def authorize(
    x_response_intelligence_token: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    if not settings.api_token:
        return
    if x_response_intelligence_token != settings.api_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid service token.")


@app.get("/health")
async def health() -> dict[str, object]:
    settings = get_settings()
    return {
        "status": "ok",
        "service": "ledgerly-response-intelligence",
        "version": __version__,
        "providerConfigured": settings.provider_enabled,
        "externalToolsEnabled": settings.allow_external_tools,
        "webSearchEnabled": settings.allow_web_search,
    }


@app.get("/v1/capabilities", dependencies=[Depends(authorize)])
async def capabilities(engine: ResponseIntelligenceEngine = Depends(get_engine)) -> dict[str, object]:
    tools = [item.model_dump(mode="json") for item in await engine.tool_broker.capabilities()]
    settings = get_settings()
    return {
        "providerConfigured": settings.provider_enabled,
        "provider": settings.provider,
        "model": settings.model,
        "externalToolsEnabled": settings.allow_external_tools,
        "webSearchEnabled": settings.allow_web_search,
        "tools": tools,
        "qualityDimensions": [
            "grounding",
            "completeness",
            "readability",
            "naturalness",
            "variation",
            "causality",
            "professionalism",
        ],
    }


@app.get("/v1/library/stats", dependencies=[Depends(authorize)])
async def library_stats() -> dict[str, object]:
    return language_stats()


@app.post("/v1/plan", response_model=DiscoursePlan, dependencies=[Depends(authorize)])
async def plan_response(request: ResponseRequest, engine: ResponseIntelligenceEngine = Depends(get_engine)) -> DiscoursePlan:
    evidence = merge_evidence(request.evidence, request.semantic_payload)
    return engine.planner.build(request, evidence)


@app.post("/v1/reason", response_model=ReasoningResult, dependencies=[Depends(authorize)])
async def reason(
    request: ResponseRequest,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> ReasoningResult:
    evidence = merge_evidence(request.evidence, request.semantic_payload)
    return engine.reasoner.derive(request, evidence)


@app.post("/v1/evaluate", response_model=QualityReport, dependencies=[Depends(authorize)])
async def evaluate_response(
    request: EvaluationRequest,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> QualityReport:
    return engine.evaluate(request)


@app.post("/v1/respond", response_model=ResponseResult, dependencies=[Depends(authorize)])
async def respond(
    request: ResponseRequest,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> ResponseResult:
    try:
        return await engine.respond(request)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

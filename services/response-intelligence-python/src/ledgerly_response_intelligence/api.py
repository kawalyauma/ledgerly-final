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
from .training.datasets import DatasetBuilder
from .training.models import AdapterRecord, AdapterRegister, DatasetExportRequest, DatasetExportResult, FeedbackCreate, FeedbackRecord, StyleProfile, TrainingExample, TrainingExampleCreate, TrainingRunRecord, TrainingStats


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
        "webSearchProvider": settings.web_search_provider,
        "webSearchConfigured": bool(settings.web_search_api_key and settings.web_search_provider!="none"),
        "learningEnabled": settings.learning_enabled,
        "learningRetrievalEnabled": settings.learning_retrieval_enabled,
        "knowledgeEnabled": settings.knowledge_enabled,
        "knowledgeRetrievalEnabled": settings.knowledge_retrieval_enabled,
        "trainingPrivacyMode": settings.training_privacy_mode,
        "preferActiveAdapter": settings.training_prefer_active_adapter,
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
        "learningEnabled": settings.learning_enabled,
        "learningRetrievalEnabled": settings.learning_retrieval_enabled,
        "trainingPrivacyMode": settings.training_privacy_mode,
        "preferActiveAdapter": settings.training_prefer_active_adapter,
        "knowledgeEnabled": settings.knowledge_enabled,
        "knowledgeRetrievalEnabled": settings.knowledge_retrieval_enabled,
        "knowledgeIncludeGlobal": settings.knowledge_include_global,
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


def require_knowledge(engine: ResponseIntelligenceEngine) -> None:
    if engine.knowledge_store is None:
        raise HTTPException(status_code=503, detail="Institutional knowledge is disabled.")


@app.post("/v1/knowledge/seed-starter-pack", response_model=list[KnowledgeSource], dependencies=[Depends(authorize)])
async def seed_knowledge_starter_pack(
    organization_id: str = "",
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> list[KnowledgeSource]:
    require_knowledge(engine)
    assert engine.knowledge_store is not None
    return engine.knowledge_store.seed_starter_pack(organization_id)


@app.get("/v1/knowledge/stats", response_model=KnowledgeStats, dependencies=[Depends(authorize)])
async def knowledge_stats(
    organization_id: str,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> KnowledgeStats:
    require_knowledge(engine)
    assert engine.knowledge_store is not None
    return engine.knowledge_store.stats(organization_id)


@app.get("/v1/knowledge/sources", response_model=list[KnowledgeSource], dependencies=[Depends(authorize)])
async def knowledge_sources(
    organization_id: str,
    approved_only: bool = False,
    limit: int = 200,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> list[KnowledgeSource]:
    require_knowledge(engine)
    assert engine.knowledge_store is not None
    return engine.knowledge_store.list_sources(organization_id,approved_only,limit)


@app.post("/v1/knowledge/sources", response_model=KnowledgeSource, dependencies=[Depends(authorize)])
async def create_knowledge_source(
    item: KnowledgeSourceCreate,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> KnowledgeSource:
    require_knowledge(engine)
    assert engine.knowledge_store is not None
    return engine.knowledge_store.add_source(item)


@app.post("/v1/knowledge/sources/{source_id}/approve", response_model=KnowledgeSource, dependencies=[Depends(authorize)])
async def approve_knowledge_source(
    source_id: str,
    organization_id: str,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> KnowledgeSource:
    require_knowledge(engine)
    assert engine.knowledge_store is not None
    try:
        return engine.knowledge_store.set_approved(source_id,True,organization_id)
    except KeyError as exc:
        raise HTTPException(status_code=404,detail="Knowledge source not found.") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403,detail=str(exc)) from exc


@app.post("/v1/knowledge/sources/{source_id}/reject", response_model=KnowledgeSource, dependencies=[Depends(authorize)])
async def reject_knowledge_source(
    source_id: str,
    organization_id: str,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> KnowledgeSource:
    require_knowledge(engine)
    assert engine.knowledge_store is not None
    try:
        return engine.knowledge_store.set_approved(source_id,False,organization_id)
    except KeyError as exc:
        raise HTTPException(status_code=404,detail="Knowledge source not found.") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403,detail=str(exc)) from exc


@app.delete("/v1/knowledge/sources/{source_id}", dependencies=[Depends(authorize)])
async def delete_knowledge_source(
    source_id: str,
    organization_id: str,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> dict[str,object]:
    require_knowledge(engine)
    assert engine.knowledge_store is not None
    try:
        engine.knowledge_store.delete_source(source_id,organization_id)
    except KeyError as exc:
        raise HTTPException(status_code=404,detail="Knowledge source not found.") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403,detail=str(exc)) from exc
    return {"deleted":True,"source_id":source_id}


@app.post("/v1/knowledge/search", response_model=list[KnowledgeSearchHit], dependencies=[Depends(authorize)])
async def search_knowledge(
    item: KnowledgeSearchRequest,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> list[KnowledgeSearchHit]:
    require_knowledge(engine)
    assert engine.knowledge_store is not None
    return engine.knowledge_store.search(
        organization_id=item.organization_id,
        query=item.query,
        limit=item.limit,
        include_global=item.include_global,
        source_types=item.source_types,
    )


def require_training(engine: ResponseIntelligenceEngine) -> None:
    if engine.training_store is None:
        raise HTTPException(status_code=503, detail="Response learning is disabled.")


@app.get("/v1/training/stats", response_model=TrainingStats, dependencies=[Depends(authorize)])
async def training_stats(
    organization_id: str = "",
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> TrainingStats:
    require_training(engine)
    assert engine.training_store is not None
    return engine.training_store.stats(organization_id)


@app.get("/v1/training/examples", response_model=list[TrainingExample], dependencies=[Depends(authorize)])
async def training_examples(
    organization_id: str = "",
    status_filter: str = "",
    purpose: str = "",
    limit: int = 100,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> list[TrainingExample]:
    require_training(engine)
    assert engine.training_store is not None
    return engine.training_store.list_examples(
        organization_id=organization_id,
        status=status_filter,
        purpose=purpose,
        limit=limit,
        include_global=False,
    )


@app.post("/v1/training/examples", response_model=TrainingExample, dependencies=[Depends(authorize)])
async def create_training_example(
    item: TrainingExampleCreate,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> TrainingExample:
    require_training(engine)
    assert engine.training_store is not None
    return engine.training_store.add_example(item)


@app.post("/v1/training/feedback", response_model=FeedbackRecord, dependencies=[Depends(authorize)])
async def training_feedback(
    item: FeedbackCreate,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> FeedbackRecord:
    require_training(engine)
    assert engine.training_store is not None
    return engine.training_store.add_feedback(item)


@app.post("/v1/training/examples/{example_id}/approve", response_model=TrainingExample, dependencies=[Depends(authorize)])
async def approve_training_example(
    example_id: str,
    organization_id: str = "",
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> TrainingExample:
    require_training(engine)
    assert engine.training_store is not None
    try:
        return engine.training_store.set_status(example_id, "approved", organization_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Training example not found.") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@app.post("/v1/training/examples/{example_id}/reject", response_model=TrainingExample, dependencies=[Depends(authorize)])
async def reject_training_example(
    example_id: str,
    organization_id: str = "",
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> TrainingExample:
    require_training(engine)
    assert engine.training_store is not None
    try:
        return engine.training_store.set_status(example_id, "rejected", organization_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Training example not found.") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@app.get("/v1/training/style-profile", response_model=StyleProfile, dependencies=[Depends(authorize)])
async def training_style_profile(
    organization_id: str,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> StyleProfile:
    require_training(engine)
    assert engine.training_store is not None
    return engine.training_store.style_profile(organization_id)


@app.post("/v1/training/export", response_model=DatasetExportResult, dependencies=[Depends(authorize)])
async def export_training_dataset(
    item: DatasetExportRequest,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> DatasetExportResult:
    require_training(engine)
    assert engine.training_store is not None
    builder = DatasetBuilder(
        engine.training_store,
        get_settings().training_dataset_dir,
        get_settings().training_privacy_mode,
    )
    return builder.export(item)


@app.get("/v1/training/runs", response_model=list[TrainingRunRecord], dependencies=[Depends(authorize)])
async def training_runs(
    organization_id: str = "",
    limit: int = 100,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> list[TrainingRunRecord]:
    require_training(engine)
    assert engine.training_store is not None
    return engine.training_store.list_training_runs(organization_id,limit)


@app.get("/v1/training/adapters", response_model=list[AdapterRecord], dependencies=[Depends(authorize)])
async def training_adapters(
    organization_id: str = "",
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> list[AdapterRecord]:
    require_training(engine)
    assert engine.training_store is not None
    return engine.training_store.list_adapters(organization_id)


@app.post("/v1/training/adapters", response_model=AdapterRecord, dependencies=[Depends(authorize)])
async def register_training_adapter(
    item: AdapterRegister,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> AdapterRecord:
    require_training(engine)
    assert engine.training_store is not None
    try:
        return engine.training_store.register_adapter(item)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/v1/training/adapters/deactivate", dependencies=[Depends(authorize)])
async def deactivate_training_adapters(
    organization_id: str,
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> dict[str, object]:
    require_training(engine)
    assert engine.training_store is not None
    changed=engine.training_store.deactivate_adapters(organization_id)
    return {"organization_id":organization_id,"deactivated":changed}


@app.post("/v1/training/adapters/{adapter_id}/activate", response_model=AdapterRecord, dependencies=[Depends(authorize)])
async def activate_training_adapter(
    adapter_id: str,
    organization_id: str = "",
    engine: ResponseIntelligenceEngine = Depends(get_engine),
) -> AdapterRecord:
    require_training(engine)
    assert engine.training_store is not None
    try:
        return engine.training_store.activate_adapter(adapter_id, organization_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Adapter not found.") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

from __future__ import annotations

import pytest

from ledgerly_response_intelligence.config import Settings
from ledgerly_response_intelligence.engine import ResponseIntelligenceEngine
from ledgerly_response_intelligence.knowledge.models import KnowledgeSourceCreate
from ledgerly_response_intelligence.knowledge.store import KnowledgeStore, chunk_text
from ledgerly_response_intelligence.models import Purpose, ResponseRequest


def test_chunk_text_splits_long_material_without_empty_chunks() -> None:
    text=("Attendance policy paragraph. "*180)+"\n\n"+("Second section. "*180)
    chunks=chunk_text(text,target_chars=700,overlap_chars=80)
    assert len(chunks)>=2
    assert all(chunk.strip() for chunk in chunks)
    assert all(len(chunk)<=1500 for chunk in chunks)


def test_unapproved_source_is_not_retrieved_until_reviewed(tmp_path) -> None:
    store=KnowledgeStore(str(tmp_path/"knowledge.sqlite3"))
    source=store.add_source(KnowledgeSourceCreate(
        organization_id="org_1",title="Attendance Policy",source_type="policy",
        content="Chronic absenteeism requires structured follow-up and evidence review.",
        approved=False,tags=["attendance"],
    ))
    assert store.search(organization_id="org_1",query="chronic absenteeism")==[]
    store.set_approved(source.source_id,True,"org_1")
    hits=store.search(organization_id="org_1",query="chronic absenteeism")
    assert hits
    assert hits[0].source_id==source.source_id


def test_knowledge_search_is_tenant_scoped_with_optional_global_sources(tmp_path) -> None:
    store=KnowledgeStore(str(tmp_path/"knowledge.sqlite3"))
    store.add_source(KnowledgeSourceCreate(
        organization_id="org_a",title="Private A",content="Unique private zebra attendance rule.",
        approved=True,
    ))
    store.add_source(KnowledgeSourceCreate(
        organization_id="org_b",title="Private B",content="Unique private zebra attendance rule.",
        approved=True,
    ))
    global_source=store.add_source(KnowledgeSourceCreate(
        organization_id="",title="Global method",source_type="research",
        content="Unique private zebra attendance rule.",approved=True,
    ))
    hits=store.search(organization_id="org_a",query="unique zebra attendance",include_global=True,limit=10)
    ids={item.source_id for item in hits}
    assert global_source.source_id in ids
    assert any(item.title=="Private A" for item in hits)
    assert not any(item.title=="Private B" for item in hits)


def test_cross_tenant_knowledge_mutations_are_blocked(tmp_path) -> None:
    store=KnowledgeStore(str(tmp_path/"knowledge.sqlite3"))
    source=store.add_source(KnowledgeSourceCreate(
        organization_id="org_a",title="Private",content="Private institutional procedure.",approved=False,
    ))
    with pytest.raises(PermissionError):
        store.set_approved(source.source_id,True,"org_b")
    with pytest.raises(PermissionError):
        store.delete_source(source.source_id,"org_b")


def test_starter_analysis_pack_is_broad_and_immediately_retrievable(tmp_path) -> None:
    store=KnowledgeStore(str(tmp_path/"knowledge.sqlite3"))
    sources=store.seed_starter_pack("org_1")
    assert len(sources)>=20
    hits=store.search(organization_id="org_1",query="lesson delivery academic performance",limit=10)
    assert hits
    assert any("lesson" in item.title.lower() or "performance" in item.title.lower() for item in hits)


@pytest.mark.asyncio
async def test_engine_reports_knowledge_sources_without_merging_them_into_ledgerly_facts(tmp_path) -> None:
    settings=Settings(
        provider="none",
        learning_enabled=False,
        knowledge_enabled=True,
        knowledge_retrieval_enabled=True,
        knowledge_db_path=str(tmp_path/"knowledge.sqlite3"),
        knowledge_retrieval_limit=4,
    )
    engine=ResponseIntelligenceEngine(settings)
    assert engine.knowledge_store is not None
    source=engine.knowledge_store.add_source(KnowledgeSourceCreate(
        organization_id="org_1",title="Attendance Guidance",source_type="policy",
        content="Chronic absenteeism should trigger structured follow-up rather than causal assumptions.",
        approved=True,tags=["attendance"],
    ))
    request=ResponseRequest(
        purpose=Purpose.analysis,
        request="Analyse chronic absenteeism.",
        semantic_payload={"rows":[{"studentName":"Learner A","attendancePercent":72}]},
        context={"organization_id":"org_1","topic":"attendance"},
        provider_mode="disabled",
        tool_policy=["web.search"],
    )
    result=await engine.respond(request)
    used=result.metadata["knowledgeSourcesUsed"]
    assert any(item["sourceId"]==source.source_id for item in used)
    assert any(event["tool"]=="knowledge.search" for event in result.tool_events)
    assert any(event["tool"]=="web.search" for event in result.tool_events)
    # The institutional policy remains outside the deterministic Ledgerly fact graph.
    assert not any(fact.sources and fact.sources[0].source_type=="knowledge" for fact in result.evidence.facts)

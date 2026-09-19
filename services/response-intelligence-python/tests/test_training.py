from __future__ import annotations

import json

from ledgerly_response_intelligence.models import Purpose, Register
from ledgerly_response_intelligence.training.datasets import DatasetBuilder
from ledgerly_response_intelligence.training.models import (
    DatasetExportRequest,
    FeedbackCreate,
    TrainingExampleCreate,
)
from ledgerly_response_intelligence.training.retrieval import TrainingRetriever
from ledgerly_response_intelligence.training.store import TrainingStore


def test_training_store_redacts_people_and_preserves_runtime_fingerprint(tmp_path) -> None:
    store=TrainingStore(str(tmp_path/"learning.sqlite3"),privacy_mode="redacted")
    item=store.add_example(TrainingExampleCreate(
        organization_id="org_1",purpose=Purpose.analysis,
        request="Analyse Mukisa Abraham's attendance.",
        semantic_payload={"studentName":"Mukisa Abraham","studentId":"std_1","attendancePercent":72},
        response_text="Mukisa Abraham attended 72% of sessions.",
        register=Register.school_professional,strategy_id="diagnostic",
        quality_overall=0.95,status="candidate",entity_label="Mukisa Abraham",
        response_fingerprint="runtime-fingerprint",
    ))
    assert item.response_fingerprint=="runtime-fingerprint"
    assert "Mukisa Abraham" not in item.request
    assert "Mukisa Abraham" not in item.response_text
    assert item.semantic_payload["studentName"]=="<PERSON>"
    assert item.semantic_payload["studentId"]=="<ID>"


def test_human_correction_rejects_original_and_creates_approved_example(tmp_path) -> None:
    store=TrainingStore(str(tmp_path/"learning.sqlite3"),privacy_mode="redacted")
    original=store.add_example(TrainingExampleCreate(
        organization_id="org_1",purpose=Purpose.account_for,request="Explain the decline.",
        semantic_payload={"currentAverage":49,"previousAverage":68},
        response_text="The learner failed because of absence.",quality_overall=0.7,
        status="candidate",response_fingerprint="fp-1",
    ))
    feedback=store.add_feedback(FeedbackCreate(
        organization_id="org_1",response_fingerprint="fp-1",rating=-1,
        correction_text="The records show a decline, but they do not establish a single cause.",
        trusted_reviewer=True,
    ))
    assert store.get_example(original.example_id).status=="rejected"
    corrected=store.get_example(feedback.example_id)
    assert corrected.status=="approved"
    assert corrected.source=="correction"
    assert "do not establish" in corrected.response_text


def test_approved_examples_are_retrievable_but_candidates_are_not(tmp_path) -> None:
    store=TrainingStore(str(tmp_path/"learning.sqlite3"))
    store.add_example(TrainingExampleCreate(
        organization_id="org_1",purpose=Purpose.analysis,
        request="Analyse chronic absenteeism in P6.",semantic_payload={},
        response_text="Approved attendance analysis.",quality_overall=0.96,status="approved",
        tags=["attendance","p6"],
    ))
    store.add_example(TrainingExampleCreate(
        organization_id="org_1",purpose=Purpose.analysis,
        request="Analyse chronic absenteeism in P6.",semantic_payload={},
        response_text="Candidate response.",quality_overall=0.99,status="candidate",
        tags=["attendance"],
    ))
    found=TrainingRetriever(store).retrieve(
        organization_id="org_1",request="Analyse P6 absenteeism and attendance.",
        purpose="analysis",limit=5,
    )
    assert found
    assert all("Candidate response" not in item.response_text for item in found)
    assert any("Approved attendance analysis" in item.response_text for item in found)


def test_exports_sft_and_dpo_datasets(tmp_path) -> None:
    store=TrainingStore(str(tmp_path/"learning.sqlite3"))
    store.add_example(TrainingExampleCreate(
        organization_id="org_1",purpose=Purpose.report,request="Report fee balances.",
        semantic_payload={"rows":[{"balance":120000}]},response_text="The outstanding balance is UGX 120,000.",
        quality_overall=0.95,status="approved",response_fingerprint="good-fp",
    ))
    bad=store.add_example(TrainingExampleCreate(
        organization_id="org_1",purpose=Purpose.analysis,request="Analyse attendance.",
        semantic_payload={"rows":[{"attendancePercent":72}]},response_text="Absence caused failure.",
        quality_overall=0.7,status="candidate",response_fingerprint="bad-fp",
    ))
    store.add_feedback(FeedbackCreate(
        organization_id="org_1",response_fingerprint=bad.response_fingerprint,rating=-1,
        correction_text="Attendance was low, but the records do not prove that it caused the outcome.",
        trusted_reviewer=True,
    ))
    builder=DatasetBuilder(store,str(tmp_path/"datasets"),"redacted")
    sft=builder.export(DatasetExportRequest(organization_id="org_1",format="sft",include_global=False))
    dpo=builder.export(DatasetExportRequest(organization_id="org_1",format="dpo",include_global=False))
    assert sft.examples>=2
    assert dpo.examples==1
    sft_row=json.loads(open(sft.path,encoding="utf-8").readline())
    dpo_row=json.loads(open(dpo.path,encoding="utf-8").readline())
    assert sft_row["messages"][-1]["role"]=="assistant"
    assert dpo_row["chosen"][0]["role"]=="assistant"
    assert dpo_row["rejected"][0]["role"]=="assistant"


def test_untrusted_correction_stays_candidate_until_review(tmp_path) -> None:
    store=TrainingStore(str(tmp_path/"learning.sqlite3"))
    original=store.add_example(TrainingExampleCreate(
        organization_id="org_1",purpose=Purpose.analysis,request="Analyse attendance.",
        semantic_payload={"attendancePercent":72},response_text="Original response.",
        quality_overall=0.9,status="candidate",response_fingerprint="fp-untrusted",
    ))
    feedback=store.add_feedback(FeedbackCreate(
        organization_id="org_1",response_fingerprint="fp-untrusted",rating=-1,
        correction_text="Suggested correction from a normal user.",trusted_reviewer=False,
    ))
    assert store.get_example(original.example_id).status=="candidate"
    assert store.get_example(feedback.example_id).status=="candidate"
    assert feedback.trusted_reviewer is False

    store.set_status(feedback.example_id,"approved","org_1")
    exported=DatasetBuilder(store,str(tmp_path/"datasets"),"redacted").export(
        DatasetExportRequest(organization_id="org_1",format="dpo",include_global=False)
    )
    assert exported.examples==1


def test_redacts_multiple_semantic_identities_from_training_text(tmp_path) -> None:
    store=TrainingStore(str(tmp_path/"learning.sqlite3"),privacy_mode="redacted")
    item=store.add_example(TrainingExampleCreate(
        organization_id="org_1",purpose=Purpose.comparison,
        request="Compare Amina Nambi with John Kato and contact parent@example.com.",
        semantic_payload={
            "rows":[
                {"studentName":"Amina Nambi","studentId":"std_1","attendancePercent":72},
                {"studentName":"John Kato","studentId":"std_2","attendancePercent":91},
            ],
            "guardianEmail":"parent@example.com",
        },
        response_text="Amina Nambi is below John Kato. parent@example.com should not be retained.",
        quality_overall=0.95,status="approved",
    ))
    combined=item.request+" "+item.response_text
    assert "Amina Nambi" not in combined
    assert "John Kato" not in combined
    assert "parent@example.com" not in combined
    assert "std_1" not in json.dumps(item.semantic_payload)
    assert "std_2" not in json.dumps(item.semantic_payload)


def test_training_mutations_enforce_organization_ownership(tmp_path) -> None:
    import pytest

    store=TrainingStore(str(tmp_path/"learning.sqlite3"))
    example=store.add_example(TrainingExampleCreate(
        organization_id="org_a",purpose=Purpose.analysis,request="Analyse attendance.",
        semantic_payload={"attendancePercent":80},response_text="Attendance is 80%.",
        quality_overall=0.95,status="candidate",
    ))
    with pytest.raises(PermissionError):
        store.set_status(example.example_id,"approved","org_b")

    adapter_dir=tmp_path/"adapter"
    adapter_dir.mkdir()
    from ledgerly_response_intelligence.training.models import AdapterRegister
    adapter=store.register_adapter(AdapterRegister(
        organization_id="org_a",name="adapter-a",base_model="example/base",
        path=str(adapter_dir),activate=False,
    ))
    with pytest.raises(PermissionError):
        store.activate_adapter(adapter.adapter_id,"org_b")

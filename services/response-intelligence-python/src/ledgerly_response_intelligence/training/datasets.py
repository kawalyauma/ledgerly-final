from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .models import DatasetExportRequest, DatasetExportResult
from .store import TrainingStore


SYSTEM_POLICY=(
    "You are Ledgerly Response Intelligence. Write a professional evidence-grounded response. "
    "Use only the supplied evidence. Distinguish facts, calculations, associations, plausible contributors "
    "and proven causes. Never invent amounts, percentages, dates, people or events."
)


class DatasetBuilder:
    def __init__(self,store:TrainingStore,dataset_dir:str,privacy_mode:str="redacted")->None:
        self.store=store
        self.dataset_dir=Path(dataset_dir)
        self.dataset_dir.mkdir(parents=True,exist_ok=True)
        self.privacy_mode=privacy_mode

    def export(self,request:DatasetExportRequest)->DatasetExportResult:
        if request.format=="dpo":
            rows=self._dpo_rows(request.organization_id)
        else:
            rows=self._sft_rows(request.organization_id,request.min_quality,request.include_global)
        safe_name=self._safe_filename(request.filename or f"{request.format}-{request.organization_id or 'global'}")
        path=self.dataset_dir/f"{safe_name}.jsonl"
        with path.open("w",encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row,ensure_ascii=False,default=str)+"\n")
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        return DatasetExportResult(
            format=request.format,path=str(path),examples=len(rows),organization_id=request.organization_id,
            privacy_mode=self.privacy_mode,sha256=digest,
        )

    def _sft_rows(self,organization_id:str,min_quality:float,include_global:bool)->list[dict[str,Any]]:
        examples=self.store.list_examples(
            organization_id=organization_id,status="approved",limit=50000,include_global=include_global
        )
        rows=[]
        for item in examples:
            if item.quality_overall<min_quality:continue
            evidence=json.dumps(item.semantic_payload,ensure_ascii=False,default=str)
            user=(
                f"Purpose: {item.purpose.value}\n"
                f"Register: {item.register.value if item.register else 'adaptive'}\n"
                f"Strategy: {item.strategy_id or 'adaptive'}\n"
                f"Request: {item.request}\n"
                f"Verified semantic evidence: {evidence}"
            )
            rows.append({
                "messages":[
                    {"role":"system","content":SYSTEM_POLICY},
                    {"role":"user","content":user},
                    {"role":"assistant","content":item.response_text},
                ],
                "metadata":{
                    "example_id":item.example_id,"organization_scope":"organization" if item.organization_id else "global",
                    "quality":item.quality_overall,"source":item.source,
                }
            })
        return rows

    def _dpo_rows(self,organization_id:str)->list[dict[str,Any]]:
        # Preference rows come specifically from human corrections so the chosen
        # response has explicit human supervision rather than an inferred preference.
        with self.store._lock,self.store._connect() as db:
            if organization_id:
                rows=db.execute(
                    """SELECT f.*,e.request_text,e.semantic_json,e.response_text AS rejected_text,e.purpose
                       FROM response_feedback f
                       JOIN training_examples e ON e.response_fingerprint=f.response_fingerprint
                       WHERE f.organization_id=? AND f.correction_text<>'' AND f.rating<=0 AND f.trusted_reviewer=1
                       ORDER BY f.created_at""",(organization_id,)
                ).fetchall()
            else:
                rows=db.execute(
                    """SELECT f.*,e.request_text,e.semantic_json,e.response_text AS rejected_text,e.purpose
                       FROM response_feedback f
                       JOIN training_examples e ON e.response_fingerprint=f.response_fingerprint
                       WHERE f.organization_id='' AND f.correction_text<>'' AND f.rating<=0 AND f.trusted_reviewer=1
                       ORDER BY f.created_at"""
                ).fetchall()
        result=[]
        for row in rows:
            prompt=[
                {"role":"system","content":SYSTEM_POLICY},
                {"role":"user","content":(
                    f"Purpose: {row['purpose']}\nRequest: {row['request_text']}\n"
                    f"Verified semantic evidence: {row['semantic_json']}"
                )},
            ]
            result.append({
                "prompt":prompt,
                "chosen":[{"role":"assistant","content":str(row["correction_text"])}],
                "rejected":[{"role":"assistant","content":str(row["rejected_text"])}],
                "metadata":{"feedback_id":str(row["feedback_id"])},
            })
        return result

    @staticmethod
    def _safe_filename(value:str)->str:
        cleaned=re.sub(r"[^a-zA-Z0-9._-]+","-",value).strip("-._")
        return (cleaned or "training-dataset")[:120]

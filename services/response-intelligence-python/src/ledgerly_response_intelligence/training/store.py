from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from ..memory import fingerprint
from ..models import Purpose, Register
from .models import (
    AdapterRecord,
    AdapterRegister,
    FeedbackCreate,
    FeedbackRecord,
    FineTuneConfig,
    StyleProfile,
    TrainingRunRecord,
    TrainingExample,
    TrainingExampleCreate,
    TrainingStats,
)
from .privacy import redact_text, sanitize_training_example, stable_json


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class TrainingStore:
    def __init__(
        self,
        path: str,
        *,
        privacy_mode: str = "redacted",
        min_sft_examples: int = 25,
        min_preference_examples: int = 20,
    ) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.privacy_mode = privacy_mode
        self.min_sft_examples = max(2,min_sft_examples)
        self.min_preference_examples = max(2,min_preference_examples)
        self._lock = threading.RLock()
        self._init()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=20, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init(self) -> None:
        with self._lock, self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS training_examples(
                  example_id TEXT PRIMARY KEY,
                  organization_id TEXT NOT NULL DEFAULT '',
                  purpose TEXT NOT NULL,
                  request_text TEXT NOT NULL,
                  semantic_json TEXT NOT NULL DEFAULT '{}',
                  response_text TEXT NOT NULL,
                  register_name TEXT NOT NULL DEFAULT '',
                  strategy_id TEXT NOT NULL DEFAULT '',
                  quality_overall REAL NOT NULL DEFAULT 0,
                  source TEXT NOT NULL DEFAULT 'response',
                  status TEXT NOT NULL DEFAULT 'candidate',
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  response_fingerprint TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_training_examples_org_status
                  ON training_examples(organization_id,status,purpose);
                CREATE INDEX IF NOT EXISTS idx_training_examples_fingerprint
                  ON training_examples(response_fingerprint);

                CREATE TABLE IF NOT EXISTS response_feedback(
                  feedback_id TEXT PRIMARY KEY,
                  organization_id TEXT NOT NULL DEFAULT '',
                  response_fingerprint TEXT NOT NULL,
                  rating INTEGER NOT NULL,
                  comment TEXT NOT NULL DEFAULT '',
                  correction_text TEXT NOT NULL DEFAULT '',
                  example_id TEXT NOT NULL DEFAULT '',
                  trusted_reviewer INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_response_feedback_fingerprint
                  ON response_feedback(response_fingerprint);

                CREATE TABLE IF NOT EXISTS training_runs(
                  run_id TEXT PRIMARY KEY,
                  organization_id TEXT NOT NULL DEFAULT '',
                  mode TEXT NOT NULL,
                  base_model TEXT NOT NULL,
                  dataset_path TEXT NOT NULL,
                  output_dir TEXT NOT NULL,
                  status TEXT NOT NULL,
                  config_json TEXT NOT NULL DEFAULT '{}',
                  metrics_json TEXT NOT NULL DEFAULT '{}',
                  created_at TEXT NOT NULL,
                  completed_at TEXT
                );

                CREATE TABLE IF NOT EXISTS model_adapters(
                  adapter_id TEXT PRIMARY KEY,
                  organization_id TEXT NOT NULL DEFAULT '',
                  name TEXT NOT NULL,
                  base_model TEXT NOT NULL,
                  path TEXT NOT NULL,
                  active INTEGER NOT NULL DEFAULT 0,
                  metrics_json TEXT NOT NULL DEFAULT '{}',
                  created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_model_adapters_org
                  ON model_adapters(organization_id,active);
                """
            )
            feedback_columns={str(row["name"]) for row in db.execute("PRAGMA table_info(response_feedback)").fetchall()}
            if "trusted_reviewer" not in feedback_columns:
                db.execute("ALTER TABLE response_feedback ADD COLUMN trusted_reviewer INTEGER NOT NULL DEFAULT 0")



    def add_example(self, item: TrainingExampleCreate) -> TrainingExample:
        request, semantic, response = sanitize_training_example(
            item.request,
            item.semantic_payload,
            item.response_text,
            entity_label=item.entity_label,
            mode=self.privacy_mode,
        )
        now = _now()
        example_id = "tex_" + uuid.uuid4().hex
        response_fp = item.response_fingerprint.strip() or fingerprint(response)
        with self._lock, self._connect() as db:
            existing = db.execute(
                "SELECT example_id FROM training_examples WHERE organization_id=? AND response_fingerprint=? LIMIT 1",
                (item.organization_id, response_fp),
            ).fetchone()
            if existing:
                return self.get_example(str(existing["example_id"]))
            db.execute(
                """
                INSERT INTO training_examples(
                  example_id,organization_id,purpose,request_text,semantic_json,response_text,
                  register_name,strategy_id,quality_overall,source,status,tags_json,
                  response_fingerprint,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    example_id,item.organization_id,item.purpose.value,request,stable_json(semantic),response,
                    item.register.value if item.register else "",item.strategy_id,item.quality_overall,item.source,
                    item.status,stable_json(item.tags),response_fp,now,now,
                ),
            )
        return self.get_example(example_id)

    def capture_candidate(
        self,
        *,
        organization_id: str,
        purpose: Purpose,
        request: str,
        semantic_payload: dict[str, Any],
        response_text: str,
        register: Register | None,
        strategy_id: str,
        quality_overall: float,
        tags: list[str],
        entity_label: str = "",
        response_fingerprint: str = "",
    ) -> TrainingExample:
        return self.add_example(
            TrainingExampleCreate(
                organization_id=organization_id,
                purpose=purpose,
                request=request,
                semantic_payload=semantic_payload,
                response_text=response_text,
                register=register,
                strategy_id=strategy_id,
                quality_overall=quality_overall,
                source="response",
                status="candidate",
                tags=tags,
                entity_label=entity_label,
                response_fingerprint=response_fingerprint,
            )
        )

    def get_example(self, example_id: str) -> TrainingExample:
        with self._lock, self._connect() as db:
            row = db.execute("SELECT * FROM training_examples WHERE example_id=?", (example_id,)).fetchone()
        if not row:
            raise KeyError(example_id)
        return self._row_example(row)

    def find_by_fingerprint(self, fingerprint_value: str, organization_id: str = "") -> TrainingExample | None:
        with self._lock, self._connect() as db:
            row = db.execute(
                """
                SELECT * FROM training_examples
                WHERE response_fingerprint=? AND (?='' OR organization_id=?)
                ORDER BY updated_at DESC LIMIT 1
                """,
                (fingerprint_value, organization_id, organization_id),
            ).fetchone()
        return self._row_example(row) if row else None

    def list_examples(
        self,
        *,
        organization_id: str = "",
        status: str = "",
        purpose: str = "",
        limit: int = 100,
        include_global: bool = False,
    ) -> list[TrainingExample]:
        clauses: list[str] = []
        args: list[Any] = []
        if organization_id:
            if include_global:
                clauses.append("(organization_id=? OR organization_id='')")
            else:
                clauses.append("organization_id=?")
            args.append(organization_id)
        elif not include_global:
            clauses.append("organization_id=''")
        if status:
            clauses.append("status=?");args.append(status)
        if purpose:
            clauses.append("purpose=?");args.append(purpose)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        args.append(max(1,min(limit,2000)))
        with self._lock, self._connect() as db:
            rows = db.execute(
                f"SELECT * FROM training_examples{where} ORDER BY updated_at DESC LIMIT ?",
                tuple(args),
            ).fetchall()
        return [self._row_example(row) for row in rows]

    def set_status(self, example_id: str, status: str) -> TrainingExample:
        if status not in {"candidate","approved","rejected"}:
            raise ValueError("invalid status")
        with self._lock, self._connect() as db:
            db.execute(
                "UPDATE training_examples SET status=?,updated_at=? WHERE example_id=?",
                (status,_now(),example_id),
            )
        return self.get_example(example_id)

    def add_feedback(self, item: FeedbackCreate) -> FeedbackRecord:
        feedback_id = "fb_" + uuid.uuid4().hex
        existing: TrainingExample | None = None
        if item.example_id:
            try:
                candidate=self.get_example(item.example_id)
                if not item.organization_id or candidate.organization_id==item.organization_id:
                    existing=candidate
            except KeyError:
                existing=None
        if existing is None:
            existing=self.find_by_fingerprint(item.response_fingerprint,item.organization_id)
        example_id = existing.example_id if existing else ""
        correction = redact_text(item.correction_text,item.entity_label)
        comment = redact_text(item.comment,item.entity_label)
        if correction and existing:
            corrected = self.add_example(
                TrainingExampleCreate(
                    organization_id=existing.organization_id,
                    purpose=existing.purpose,
                    request=existing.request,
                    semantic_payload=existing.semantic_payload,
                    response_text=correction,
                    register=existing.register,
                    strategy_id=existing.strategy_id,
                    quality_overall=max(existing.quality_overall,0.9),
                    source="correction",
                    status="approved" if item.trusted_reviewer else "candidate",
                    tags=[*existing.tags,"human-correction","trusted-review" if item.trusted_reviewer else "needs-review"],
                )
            )
            example_id = corrected.example_id
            if item.trusted_reviewer:
                self.set_status(corrected.example_id,"approved")
                self.set_status(existing.example_id,"rejected")
        elif item.approve_original and existing and item.trusted_reviewer:
            self.set_status(existing.example_id,"approved")
        elif item.rating < 0 and existing and item.trusted_reviewer:
            self.set_status(existing.example_id,"rejected")
        with self._lock, self._connect() as db:
            db.execute(
                """
                INSERT INTO response_feedback(
                  feedback_id,organization_id,response_fingerprint,rating,comment,
                  correction_text,example_id,trusted_reviewer,created_at
                ) VALUES(?,?,?,?,?,?,?,?,?)
                """,
                (
                    feedback_id,item.organization_id,item.response_fingerprint,item.rating,comment,
                    correction,example_id,1 if item.trusted_reviewer else 0,_now(),
                ),
            )
        return FeedbackRecord(
            feedback_id=feedback_id,
            organization_id=item.organization_id,
            response_fingerprint=item.response_fingerprint,
            rating=item.rating,
            comment=comment,
            correction_text=correction,
            example_id=example_id,
            trusted_reviewer=item.trusted_reviewer,
            created_at=_now(),
        )

    def stats(self, organization_id: str = "") -> TrainingStats:
        org_clause = "organization_id=?" if organization_id else "organization_id=''"
        args = (organization_id,) if organization_id else ()
        with self._lock, self._connect() as db:
            status_rows = db.execute(
                f"SELECT status,COUNT(*) AS n FROM training_examples WHERE {org_clause} GROUP BY status",args
            ).fetchall()
            fb = db.execute(
                f"""SELECT
                    SUM(CASE WHEN rating>0 THEN 1 ELSE 0 END) positive,
                    SUM(CASE WHEN rating<0 THEN 1 ELSE 0 END) negative,
                    SUM(CASE WHEN correction_text<>'' AND trusted_reviewer=1 THEN 1 ELSE 0 END) corrections
                    FROM response_feedback WHERE {org_clause}""",args
            ).fetchone()
            runs = db.execute(f"SELECT COUNT(*) n FROM training_runs WHERE {org_clause}",args).fetchone()
            adapters = db.execute(f"SELECT COUNT(*) n FROM model_adapters WHERE {org_clause}",args).fetchone()
        counts={str(row["status"]):int(row["n"]) for row in status_rows}
        approved=counts.get("approved",0)
        corrections=int(fb["corrections"] or 0) if fb else 0
        readiness: Literal["empty","collecting","sft-ready","preference-ready"]="empty"
        if approved or counts.get("candidate",0): readiness="collecting"
        if approved>=self.min_sft_examples: readiness="sft-ready"
        if corrections>=self.min_preference_examples and approved>=self.min_sft_examples: readiness="preference-ready"
        return TrainingStats(
            organization_id=organization_id,candidates=counts.get("candidate",0),
            approved=approved,rejected=counts.get("rejected",0),
            feedback_positive=int(fb["positive"] or 0) if fb else 0,
            feedback_negative=int(fb["negative"] or 0) if fb else 0,
            corrections=corrections,training_runs=int(runs["n"] or 0),adapters=int(adapters["n"] or 0),
            readiness=readiness,
        )

    def style_profile(self, organization_id: str) -> StyleProfile:
        examples=self.list_examples(organization_id=organization_id,status="approved",limit=500,include_global=False)
        if not examples:return StyleProfile(organization_id=organization_id)
        import re
        from collections import Counter
        words=[len(ex.response_text.split()) for ex in examples]
        sentence_lengths: list[int]=[]
        heading=bullet=concise=0
        registers: Counter[str]=Counter();strategies: Counter[str]=Counter()
        for ex in examples:
            sentences=[s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+",ex.response_text) if s.strip()]
            sentence_lengths.extend(len(s.split()) for s in sentences)
            heading+=int(bool(re.search(r"^#{1,4}\s+",ex.response_text,re.M)))
            bullet+=int(bool(re.search(r"^[-*]\s+",ex.response_text,re.M)))
            concise+=int(len(ex.response_text.split())<=250)
            if ex.register:registers[ex.register.value]+=1
            if ex.strategy_id:strategies[ex.strategy_id]+=1
        avg_words=sum(words)/len(words)
        avg_sentence=sum(sentence_lengths)/len(sentence_lengths) if sentence_lengths else 0
        rules=[
            f"Learned organization style: typical response length is about {avg_words:.0f} words.",
            f"Typical sentence length is about {avg_sentence:.0f} words.",
        ]
        if heading/len(examples)>0.6:rules.append("This organization usually prefers descriptive headings.")
        if bullet/len(examples)>0.5:rules.append("This organization often uses short bullet lists where they improve scanning.")
        if concise/len(examples)>0.7:rules.append("Prefer concise answers unless the request explicitly asks for deep analysis.")
        return StyleProfile(
            organization_id=organization_id,approved_examples=len(examples),
            preferred_register=registers.most_common(1)[0][0] if registers else "",
            preferred_strategy=strategies.most_common(1)[0][0] if strategies else "",
            average_words=avg_words,average_sentence_words=avg_sentence,
            heading_rate=heading/len(examples),bullet_rate=bullet/len(examples),concise_rate=concise/len(examples),
            rules=rules,
        )

    def create_training_run(self,config:FineTuneConfig)->TrainingRunRecord:
        run_id="trn_"+uuid.uuid4().hex
        now=_now()
        with self._lock,self._connect() as db:
            db.execute(
                """INSERT INTO training_runs(
                   run_id,organization_id,mode,base_model,dataset_path,output_dir,status,config_json,created_at
                   ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    run_id,config.organization_id,f"{config.objective}:{config.mode}",config.base_model,
                    config.dataset_path,config.output_dir,"running",stable_json(config.model_dump(mode="json")),now,
                ),
            )
        return self.get_training_run(run_id)

    def finish_training_run(self,run_id:str,*,status:str,metrics:dict[str,Any]|None=None)->TrainingRunRecord:
        with self._lock,self._connect() as db:
            db.execute(
                "UPDATE training_runs SET status=?,metrics_json=?,completed_at=? WHERE run_id=?",
                (status,stable_json(metrics or {}),_now(),run_id),
            )
        return self.get_training_run(run_id)

    def get_training_run(self,run_id:str)->TrainingRunRecord:
        with self._lock,self._connect() as db:
            row=db.execute("SELECT * FROM training_runs WHERE run_id=?",(run_id,)).fetchone()
        if not row:raise KeyError(run_id)
        mode_text=str(row["mode"])
        objective,_,mode=mode_text.partition(":")
        return TrainingRunRecord(
            run_id=str(row["run_id"]),organization_id=str(row["organization_id"]),
            objective=objective or "sft",mode=mode or mode_text,base_model=str(row["base_model"]),
            dataset_path=str(row["dataset_path"]),output_dir=str(row["output_dir"]),status=str(row["status"]),
            config=json.loads(str(row["config_json"] or "{}")),metrics=json.loads(str(row["metrics_json"] or "{}")),
            created_at=str(row["created_at"]),completed_at=str(row["completed_at"] or ""),
        )

    def list_training_runs(self,organization_id:str="",limit:int=100)->list[TrainingRunRecord]:
        with self._lock,self._connect() as db:
            rows=db.execute(
                "SELECT run_id FROM training_runs WHERE organization_id=? ORDER BY created_at DESC LIMIT ?",
                (organization_id,max(1,min(limit,1000))),
            ).fetchall()
        return [self.get_training_run(str(row["run_id"])) for row in rows]

    def register_adapter(self,item:AdapterRegister)->AdapterRecord:
        if item.activate and not Path(item.path).exists():
            raise FileNotFoundError(f"Cannot activate a missing adapter path: {item.path}")
        adapter_id="adp_"+uuid.uuid4().hex
        now=_now()
        with self._lock,self._connect() as db:
            if item.activate:
                db.execute("UPDATE model_adapters SET active=0 WHERE organization_id=?",(item.organization_id,))
            db.execute(
                """INSERT INTO model_adapters(
                   adapter_id,organization_id,name,base_model,path,active,metrics_json,created_at
                   ) VALUES(?,?,?,?,?,?,?,?)""",
                (
                    adapter_id,item.organization_id,item.name,item.base_model,item.path,1 if item.activate else 0,
                    stable_json(item.metrics),now,
                ),
            )
        return self.get_adapter(adapter_id)

    def get_adapter(self,adapter_id:str)->AdapterRecord:
        with self._lock,self._connect() as db:
            row=db.execute("SELECT * FROM model_adapters WHERE adapter_id=?",(adapter_id,)).fetchone()
        if not row:raise KeyError(adapter_id)
        return AdapterRecord(
            adapter_id=str(row["adapter_id"]),organization_id=str(row["organization_id"]),name=str(row["name"]),
            base_model=str(row["base_model"]),path=str(row["path"]),active=bool(row["active"]),
            metrics=json.loads(str(row["metrics_json"] or "{}")),created_at=str(row["created_at"]),
        )

    def list_adapters(self,organization_id:str="")->list[AdapterRecord]:
        with self._lock,self._connect() as db:
            rows=db.execute(
                "SELECT * FROM model_adapters WHERE organization_id=? ORDER BY active DESC,created_at DESC",
                (organization_id,),
            ).fetchall()
        return [AdapterRecord(
            adapter_id=str(row["adapter_id"]),organization_id=str(row["organization_id"]),name=str(row["name"]),
            base_model=str(row["base_model"]),path=str(row["path"]),active=bool(row["active"]),
            metrics=json.loads(str(row["metrics_json"] or "{}")),created_at=str(row["created_at"]),
        ) for row in rows]

    def active_adapter(self,organization_id:str)->AdapterRecord|None:
        with self._lock,self._connect() as db:
            row=db.execute(
                "SELECT adapter_id FROM model_adapters WHERE organization_id=? AND active=1 ORDER BY created_at DESC LIMIT 1",
                (organization_id,),
            ).fetchone()
        return self.get_adapter(str(row["adapter_id"])) if row else None

    def activate_adapter(self,adapter_id:str)->AdapterRecord:
        adapter=self.get_adapter(adapter_id)
        if not Path(adapter.path).exists():
            raise FileNotFoundError(f"Cannot activate a missing adapter path: {adapter.path}")
        with self._lock,self._connect() as db:
            db.execute("UPDATE model_adapters SET active=0 WHERE organization_id=?",(adapter.organization_id,))
            db.execute("UPDATE model_adapters SET active=1 WHERE adapter_id=?",(adapter_id,))
        return self.get_adapter(adapter_id)

    @staticmethod
    def _row_example(row: sqlite3.Row) -> TrainingExample:
        register_raw=str(row["register_name"] or "")
        return TrainingExample(
            example_id=str(row["example_id"]),organization_id=str(row["organization_id"]),
            purpose=Purpose(str(row["purpose"])),request=str(row["request_text"]),
            semantic_payload=json.loads(str(row["semantic_json"] or "{}")),response_text=str(row["response_text"]),
            register=Register(register_raw) if register_raw in Register._value2member_map_ else None,
            strategy_id=str(row["strategy_id"] or ""),quality_overall=float(row["quality_overall"] or 0),
            source=str(row["source"] or ""),status=str(row["status"] or ""),
            tags=list(json.loads(str(row["tags_json"] or "[]"))),response_fingerprint=str(row["response_fingerprint"]),
            created_at=str(row["created_at"]),updated_at=str(row["updated_at"]),
        )

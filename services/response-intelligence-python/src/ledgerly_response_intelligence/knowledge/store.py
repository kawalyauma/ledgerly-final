from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .models import KnowledgeSearchHit, KnowledgeSource, KnowledgeSourceCreate, KnowledgeStats


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _normalize_space(text: str) -> str:
    return re.sub(r"[ \t]+", " ", text).strip()


def chunk_text(text: str, *, target_chars: int = 2200, overlap_chars: int = 240) -> list[str]:
    paragraphs=[_normalize_space(item) for item in re.split(r"\n\s*\n+",text) if _normalize_space(item)]
    if not paragraphs:
        paragraphs=[_normalize_space(text)]
    chunks:list[str]=[]
    current=""
    for paragraph in paragraphs:
        if not paragraph:
            continue
        if len(paragraph)>target_chars*2:
            sentences=[item.strip() for item in re.split(r"(?<=[.!?])\s+",paragraph) if item.strip()]
        else:
            sentences=[paragraph]
        for piece in sentences:
            candidate=(current+"\n\n"+piece).strip() if current else piece
            if len(candidate)<=target_chars or not current:
                current=candidate
                if len(current)<=target_chars:
                    continue
            if current:
                chunks.append(current)
                tail=current[-overlap_chars:] if overlap_chars else ""
                current=(tail+" "+piece).strip()
            else:
                current=piece
            while len(current)>target_chars*2:
                chunks.append(current[:target_chars])
                current=current[max(0,target_chars-overlap_chars):]
    if current:
        chunks.append(current)
    clean:list[str]=[]
    seen:set[str]=set()
    for item in chunks:
        item=_normalize_space(item.replace("\x00"," "))
        digest=_sha256(item)
        if item and digest not in seen:
            clean.append(item)
            seen.add(digest)
    return clean


class KnowledgeStore:
    def __init__(self,path:str)->None:
        self.path=Path(path)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        self._lock=threading.RLock()
        self.fts_enabled=False
        self._init()

    def _connect(self)->sqlite3.Connection:
        db=sqlite3.connect(self.path,timeout=20,check_same_thread=False)
        db.row_factory=sqlite3.Row
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def _init(self)->None:
        with self._lock,self._connect() as db:
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS knowledge_sources(
                  source_id TEXT PRIMARY KEY,
                  organization_id TEXT NOT NULL DEFAULT '',
                  title TEXT NOT NULL,
                  source_type TEXT NOT NULL,
                  url TEXT NOT NULL DEFAULT '',
                  author TEXT NOT NULL DEFAULT '',
                  published_at TEXT NOT NULL DEFAULT '',
                  approved INTEGER NOT NULL DEFAULT 0,
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  metadata_json TEXT NOT NULL DEFAULT '{}',
                  content_sha256 TEXT NOT NULL,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_sources_org_approved
                  ON knowledge_sources(organization_id,approved,source_type);

                CREATE TABLE IF NOT EXISTS knowledge_chunks(
                  chunk_id TEXT PRIMARY KEY,
                  source_id TEXT NOT NULL,
                  organization_id TEXT NOT NULL DEFAULT '',
                  title TEXT NOT NULL DEFAULT '',
                  content TEXT NOT NULL,
                  position INTEGER NOT NULL,
                  token_estimate INTEGER NOT NULL DEFAULT 0,
                  source_type TEXT NOT NULL DEFAULT '',
                  url TEXT NOT NULL DEFAULT '',
                  approved INTEGER NOT NULL DEFAULT 0,
                  tags_json TEXT NOT NULL DEFAULT '[]',
                  FOREIGN KEY(source_id) REFERENCES knowledge_sources(source_id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks(source_id,position);
                CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_org_approved ON knowledge_chunks(organization_id,approved);
                """
            )
            try:
                db.execute(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(chunk_id UNINDEXED,title,content,tags)"
                )
                self.fts_enabled=True
            except sqlite3.OperationalError:
                self.fts_enabled=False

    def add_source(self,item:KnowledgeSourceCreate)->KnowledgeSource:
        content=item.content.replace("\x00"," ").strip()
        digest=_sha256(content)
        with self._lock,self._connect() as db:
            existing=db.execute(
                """SELECT source_id FROM knowledge_sources
                   WHERE organization_id=? AND content_sha256=? LIMIT 1""",
                (item.organization_id,digest),
            ).fetchone()
            if existing:
                return self.get_source(str(existing["source_id"]))
            source_id="ks_"+uuid.uuid4().hex
            now=_now()
            db.execute(
                """INSERT INTO knowledge_sources(
                   source_id,organization_id,title,source_type,url,author,published_at,approved,
                   tags_json,metadata_json,content_sha256,created_at,updated_at
                   ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    source_id,item.organization_id,item.title,item.source_type,item.url,item.author,item.published_at,
                    1 if item.approved else 0,json.dumps(item.tags,ensure_ascii=False),
                    json.dumps(item.metadata,ensure_ascii=False,default=str),digest,now,now,
                ),
            )
            for position,chunk in enumerate(chunk_text(content)):
                chunk_id="kc_"+uuid.uuid4().hex
                db.execute(
                    """INSERT INTO knowledge_chunks(
                       chunk_id,source_id,organization_id,title,content,position,token_estimate,
                       source_type,url,approved,tags_json
                       ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        chunk_id,source_id,item.organization_id,item.title,chunk,position,max(1,len(chunk)//4),
                        item.source_type,item.url,1 if item.approved else 0,json.dumps(item.tags,ensure_ascii=False),
                    ),
                )
                if self.fts_enabled:
                    db.execute(
                        "INSERT INTO knowledge_chunks_fts(chunk_id,title,content,tags) VALUES(?,?,?,?)",
                        (chunk_id,item.title,chunk," ".join(item.tags)),
                    )
        return self.get_source(source_id)

    def seed_starter_pack(self,organization_id:str="")->list[KnowledgeSource]:
        from .starter_pack import starter_analysis_pack

        sources:list[KnowledgeSource]=[]
        for item in starter_analysis_pack(organization_id):
            sources.append(self.add_source(item))
        return sources

    def get_source(self,source_id:str)->KnowledgeSource:
        with self._lock,self._connect() as db:
            row=db.execute(
                """SELECT s.*,COUNT(c.chunk_id) chunk_count
                   FROM knowledge_sources s LEFT JOIN knowledge_chunks c ON c.source_id=s.source_id
                   WHERE s.source_id=? GROUP BY s.source_id""",(source_id,)
            ).fetchone()
        if not row:raise KeyError(source_id)
        return self._source(row)

    def list_sources(self,organization_id:str="",approved_only:bool=False,limit:int=200)->list[KnowledgeSource]:
        where=["s.organization_id=?"];args:list[Any]=[organization_id]
        if approved_only:where.append("s.approved=1")
        args.append(max(1,min(limit,1000)))
        with self._lock,self._connect() as db:
            rows=db.execute(
                f"""SELECT s.*,COUNT(c.chunk_id) chunk_count
                    FROM knowledge_sources s LEFT JOIN knowledge_chunks c ON c.source_id=s.source_id
                    WHERE {' AND '.join(where)} GROUP BY s.source_id
                    ORDER BY s.updated_at DESC LIMIT ?""",tuple(args)
            ).fetchall()
        return [self._source(row) for row in rows]

    def set_approved(self,source_id:str,approved:bool,organization_id:str="")->KnowledgeSource:
        source=self.get_source(source_id)
        if organization_id and source.organization_id!=organization_id:
            raise PermissionError("Knowledge source does not belong to this organization.")
        with self._lock,self._connect() as db:
            db.execute(
                "UPDATE knowledge_sources SET approved=?,updated_at=? WHERE source_id=?",
                (1 if approved else 0,_now(),source_id),
            )
            db.execute(
                "UPDATE knowledge_chunks SET approved=? WHERE source_id=?",
                (1 if approved else 0,source_id),
            )
        return self.get_source(source_id)

    def delete_source(self,source_id:str,organization_id:str="")->None:
        source=self.get_source(source_id)
        if organization_id and source.organization_id!=organization_id:
            raise PermissionError("Knowledge source does not belong to this organization.")
        with self._lock,self._connect() as db:
            chunk_ids=[str(row["chunk_id"]) for row in db.execute(
                "SELECT chunk_id FROM knowledge_chunks WHERE source_id=?",(source_id,)
            ).fetchall()]
            if self.fts_enabled and chunk_ids:
                db.executemany("DELETE FROM knowledge_chunks_fts WHERE chunk_id=?",[(item,) for item in chunk_ids])
            db.execute("DELETE FROM knowledge_sources WHERE source_id=?",(source_id,))

    def search(
        self,
        *,
        organization_id:str,
        query:str,
        limit:int=6,
        include_global:bool=True,
        source_types:list[str]|None=None,
    )->list[KnowledgeSearchHit]:
        query=query.strip()
        if len(query)<2:return []
        max_results=max(1,min(limit,30))
        source_types=source_types or []
        scope_clause="(c.organization_id=? OR c.organization_id='')" if include_global else "c.organization_id=?"
        type_clause=""
        args:list[Any]=[organization_id]
        if source_types:
            placeholders=",".join("?" for _ in source_types)
            type_clause=f" AND c.source_type IN ({placeholders})"
            args.extend(source_types)
        rows:list[sqlite3.Row]=[]
        with self._lock,self._connect() as db:
            if self.fts_enabled:
                terms=[token for token in re.findall(r"[A-Za-z0-9]+",query.lower()) if len(token)>1][:24]
                fts_query=" OR ".join(f'"{term}"' for term in terms)
                if fts_query:
                    sql=f"""SELECT c.*,s.published_at,bm25(knowledge_chunks_fts) rank
                            FROM knowledge_chunks_fts f
                            JOIN knowledge_chunks c ON c.chunk_id=f.chunk_id
                            JOIN knowledge_sources s ON s.source_id=c.source_id
                            WHERE knowledge_chunks_fts MATCH ? AND c.approved=1 AND {scope_clause}{type_clause}
                            ORDER BY rank LIMIT ?"""
                    rows=db.execute(sql,tuple([fts_query,*args,max_results*4])).fetchall()
            if not rows:
                tokens=[token for token in re.findall(r"[A-Za-z0-9]+",query.lower()) if len(token)>2][:12]
                if not tokens:return []
                like_clause=" OR ".join("(LOWER(c.title) LIKE ? OR LOWER(c.content) LIKE ?)" for _ in tokens)
                like_args:list[Any]=[]
                for token in tokens:like_args.extend([f"%{token}%",f"%{token}%"])
                sql=f"""SELECT c.*,s.published_at,0 rank FROM knowledge_chunks c
                         JOIN knowledge_sources s ON s.source_id=c.source_id
                         WHERE c.approved=1 AND {scope_clause}{type_clause} AND ({like_clause})
                         LIMIT ?"""
                rows=db.execute(sql,tuple([*args,*like_args,max_results*6])).fetchall()

        tokens=set(re.findall(r"[a-z0-9]+",query.lower()))
        hits:list[KnowledgeSearchHit]=[]
        for row in rows:
            haystack=(str(row["title"])+" "+str(row["content"])+" "+" ".join(json.loads(str(row["tags_json"] or "[]")))).lower()
            doc_tokens=set(re.findall(r"[a-z0-9]+",haystack))
            overlap=len(tokens&doc_tokens)/max(len(tokens),1)
            phrase_bonus=0.15 if query.lower() in haystack else 0
            org_bonus=0.08 if str(row["organization_id"])==organization_id and organization_id else 0
            score=min(1.0,overlap+phrase_bonus+org_bonus)
            hits.append(KnowledgeSearchHit(
                chunk_id=str(row["chunk_id"]),source_id=str(row["source_id"]),title=str(row["title"]),
                content=str(row["content"]),source_type=str(row["source_type"]),url=str(row["url"] or ""),
                published_at=str(row["published_at"] or ""),score=score,
                organization_scope="organization" if str(row["organization_id"])==organization_id else "global",
                tags=list(json.loads(str(row["tags_json"] or "[]"))),
            ))
        hits.sort(key=lambda item:(-item.score,item.source_id,item.chunk_id))
        dedup:list[KnowledgeSearchHit]=[];seen:set[tuple[str,str]]=set()
        for hit in hits:
            key=(hit.source_id,hit.content[:160])
            if key in seen:continue
            dedup.append(hit);seen.add(key)
            if len(dedup)>=max_results:break
        return dedup

    def stats(self,organization_id:str)->KnowledgeStats:
        with self._lock,self._connect() as db:
            src=db.execute(
                """SELECT COUNT(*) total,SUM(CASE WHEN approved=1 THEN 1 ELSE 0 END) approved
                   FROM knowledge_sources WHERE organization_id=?""",(organization_id,)
            ).fetchone()
            chunks=db.execute(
                """SELECT COUNT(*) total,SUM(CASE WHEN approved=1 THEN 1 ELSE 0 END) approved
                   FROM knowledge_chunks WHERE organization_id=?""",(organization_id,)
            ).fetchone()
            global_src=db.execute(
                "SELECT COUNT(*) total FROM knowledge_sources WHERE organization_id='' AND approved=1"
            ).fetchone()
        return KnowledgeStats(
            organization_id=organization_id,sources=int(src["total"] or 0),approved_sources=int(src["approved"] or 0),
            chunks=int(chunks["total"] or 0),approved_chunks=int(chunks["approved"] or 0),
            global_sources_available=int(global_src["total"] or 0),
        )

    @staticmethod
    def _source(row:sqlite3.Row)->KnowledgeSource:
        return KnowledgeSource(
            source_id=str(row["source_id"]),organization_id=str(row["organization_id"]),title=str(row["title"]),
            source_type=str(row["source_type"]),url=str(row["url"] or ""),author=str(row["author"] or ""),
            published_at=str(row["published_at"] or ""),approved=bool(row["approved"]),
            tags=list(json.loads(str(row["tags_json"] or "[]"))),
            metadata=dict(json.loads(str(row["metadata_json"] or "{}"))),chunk_count=int(row["chunk_count"] or 0),
            content_sha256=str(row["content_sha256"]),created_at=str(row["created_at"]),updated_at=str(row["updated_at"]),
        )

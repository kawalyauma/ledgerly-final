import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";
import { ulibtech } from "../school-management/ulibtech.js";

const CHUNK_CHARS = 3500;

/** Splits extracted text into ~3.5k character passages on paragraph or line boundaries. */
export function chunkText(text: string): Array<{ start: number; content: string }> {
  const chunks: Array<{ start: number; content: string }> = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + CHUNK_CHARS);
    if (end < text.length) {
      const window = text.slice(start + CHUNK_CHARS * 0.6, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\nPage "), window.lastIndexOf("\n"));
      if (cut > 0) end = start + Math.floor(CHUNK_CHARS * 0.6) + cut;
    }
    const content = text.slice(start, end).trim();
    if (content.length > 40) chunks.push({ start, content });
    start = end;
  }
  return chunks;
}

export type SourceRow = { id: string; title: string; resourceType: string | null; status: string; chunkCount: number };

/** Copies one e-library resource (metadata and text) into the school's source store. Re-ingesting is a no-op. */
export async function ingestResource(runtime: Runtime, organizationId: string, slug: string): Promise<SourceRow> {
  const existing = await runtime.db.query<SourceRow>(
    `SELECT id,title,resource_type AS "resourceType",status,chunk_count AS "chunkCount" FROM lrn_sources
      WHERE organization_id=$1 AND provider='ulibtech' AND external_slug=$2`, [organizationId, slug]);
  if (existing.rows[0]?.status === "ready") return existing.rows[0];

  const library = ulibtech(runtime);
  const meta = await library.resource(slug);
  const id = existing.rows[0]?.id ?? createId("lsrc");
  await runtime.db.query(
    `INSERT INTO lrn_sources(id,organization_id,external_slug,title,resource_type,class_name,subject_name,term_name,page_url,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
     ON CONFLICT(organization_id,provider,external_slug) DO UPDATE SET title=EXCLUDED.title,resource_type=EXCLUDED.resource_type`,
    [id, organizationId, meta.slug, meta.title, meta.typeSlug, meta.className, meta.subject, meta.term, meta.pageUrl]);

  let text = "";
  try {
    text = (await library.text(meta.slug)).text ?? "";
  } catch (error) {
    await runtime.db.query(`UPDATE lrn_sources SET status='failed',error=$2 WHERE id=$1`, [id, error instanceof Error ? error.message : String(error)]);
    throw error;
  }
  const chunks = chunkText(text);
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM lrn_source_chunks WHERE source_id=$1", [id]);
    for (const [seq, chunk] of chunks.entries()) {
      await client.query(
        `INSERT INTO lrn_source_chunks(id,organization_id,source_id,seq,char_start,content) VALUES($1,$2,$3,$4,$5,$6)`,
        [createId("lchk"), organizationId, id, seq, chunk.start, chunk.content]);
    }
    await client.query(
      `UPDATE lrn_sources SET status=$2,total_chars=$3,chunk_count=$4,fetched_at=CURRENT_TIMESTAMP,error=NULL WHERE id=$1`,
      [id, chunks.length ? "ready" : "no_text", text.length, chunks.length]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { id, title: meta.title, resourceType: meta.typeSlug, status: chunks.length ? "ready" : "no_text", chunkCount: chunks.length };
}

export type Passage = { id: string; sourceId: string; sourceTitle: string; seq: number; content: string };

const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "what", "which", "into", "about", "lesson", "topic", "learners"]);

/** Most relevant passages from the given sources for a topic, within a character budget. */
export async function relevantPassages(runtime: Runtime, organizationId: string, sourceIds: string[], query: string, budgetChars: number, limit = 8): Promise<Passage[]> {
  if (!sourceIds.length) return [];
  const words = [...new Set(query.toLowerCase().match(/[a-z]{3,}/g) ?? [])].filter(w => !STOP.has(w)).slice(0, 24);
  const rows = words.length
    ? await runtime.db.query<Passage & { rank: number }>(
      `SELECT c.id,c.source_id AS "sourceId",s.title AS "sourceTitle",c.seq,c.content,
              ts_rank(c.search, to_tsquery('english',$3)) AS rank
         FROM lrn_source_chunks c JOIN lrn_sources s ON s.id=c.source_id
        WHERE c.organization_id=$1 AND c.source_id=ANY($2::text[]) AND c.search @@ to_tsquery('english',$3)
        ORDER BY rank DESC, c.seq LIMIT $4`,
      [organizationId, sourceIds, words.join(" | "), limit * 2])
    : { rows: [] as Array<Passage & { rank: number }> };
  const picked: Passage[] = [];
  let used = 0;
  for (const row of rows.rows) {
    if (picked.length >= limit || used + row.content.length > budgetChars) continue;
    picked.push(row);
    used += row.content.length;
  }
  return picked;
}

/** The opening passages of each source, in order, within a budget (used for the scheme outline step). */
export async function openingPassages(runtime: Runtime, organizationId: string, sourceIds: string[], budgetChars: number): Promise<Passage[]> {
  if (!sourceIds.length) return [];
  const rows = await runtime.db.query<Passage>(
    `SELECT c.id,c.source_id AS "sourceId",s.title AS "sourceTitle",c.seq,c.content
       FROM lrn_source_chunks c JOIN lrn_sources s ON s.id=c.source_id
      WHERE c.organization_id=$1 AND c.source_id=ANY($2::text[])
      ORDER BY array_position($2::text[], c.source_id), c.seq LIMIT 200`, [organizationId, sourceIds]);
  // Each source gets an equal share so one long document cannot crowd out the others.
  const share = Math.floor(budgetChars / new Set(rows.rows.map(r => r.sourceId)).size || budgetChars);
  const usedBy = new Map<string, number>();
  const picked: Passage[] = [];
  for (const row of rows.rows) {
    const used = usedBy.get(row.sourceId) ?? 0;
    if (used + row.content.length > share) continue;
    picked.push(row);
    usedBy.set(row.sourceId, used + row.content.length);
  }
  return picked;
}

export function formatPassages(passages: Passage[]) {
  return passages.map(p => `<passage id="${p.id}" source="${p.sourceTitle.replace(/"/g, "'")}" part="${p.seq + 1}">\n${p.content}\n</passage>`).join("\n\n");
}

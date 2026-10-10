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

/* ───────────── Book map: which class / term / topic each part of a book is about ───────────── */

export type ClassRef = { level: "n" | "p" | "s"; no: number };
export type Scope = { cls?: ClassRef | null; term?: number | null };

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };
const num = (v: string) => /^\d$/.test(v) ? Number(v) : NUM[v.toLowerCase()] ?? null;

/** "P.5", "PRIMARY FIVE", "P5", "SENIOR 2", "S.2", "BABY CLASS" → class reference. */
export function parseClass(text: string): ClassRef | null {
  const t = text.toLowerCase();
  const nursery = /\b(baby|middle|top)\s+class\b/.exec(t);
  if (nursery) return { level: "n", no: { baby: 1, middle: 2, top: 3 }[nursery[1] as "baby"] };
  const m = /\b(?:(p|primary|s|senior)\.?\s*(one|two|three|four|five|six|seven|[1-7])\b)/.exec(t);
  if (!m) return null;
  const n = num(m[2]!);
  if (!n || (m[1]!.startsWith("s") && n > 6)) return null;
  return { level: m[1]!.startsWith("p") ? "p" : "s", no: n };
}

export function parseTerm(text: string): number | null {
  const m = /\bterm\s*[-:]?\s*(one|two|three|iii|ii|i|[1-3])\b/i.exec(text);
  return m ? num(m[1]!) : null;
}

/** Every class a title says it covers: "P4 P6 Package", "P4,p6&p7 MTC Notes", "P.4 - P.6 SST", "Primary 5". */
export function classesInTitle(title: string): ClassRef[] {
  const t = title.toLowerCase();
  const out: ClassRef[] = [];
  const range = /\b(p|s)\.?\s*([1-7])\s*(?:-|–|to)\s*(?:\1\.?\s*)?([1-7])\b/.exec(t);
  if (range) for (let n = Number(range[2]); n <= Number(range[3]); n += 1) out.push({ level: range[1] as "p" | "s", no: n });
  for (const m of t.matchAll(/\b(p|s|primary|senior)\.?\s*(one|two|three|four|five|six|seven|[1-7])\b/g)) {
    const n = num(m[2]!); if (n) out.push({ level: m[1]!.startsWith("p") ? "p" : "s", no: n });
  }
  const one = parseClass(t); if (one) out.push(one);
  return out.filter((c, i) => out.findIndex(x => x.level === c.level && x.no === c.no) === i);
}

type MapEvent = { pos: number; cls?: ClassRef; term?: number; heading?: string };

/** Finds class, term and topic headings in a book's text. Headings are short lines, mostly in capitals or starting with a keyword. */
export function mapHeadings(text: string): MapEvent[] {
  const events: MapEvent[] = [];
  let pos = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const at = pos;
    pos += raw.length + 1;
    if (line.length < 3 || line.length > 110) continue;
    const letters = line.replace(/[^a-zA-Z]/g, "");
    const caps = letters.length ? letters.replace(/[^A-Z]/g, "").length / letters.length : 0;
    const keyword = /^(topic|theme|unit|term|primary|senior|p\.?\s?[1-7]\b|s\.?\s?[1-6]\b|sub[\s-]?topic|lesson)\b/i.test(line);
    if (caps < 0.6 && !keyword) continue;
    const ev: MapEvent = { pos: at };
    const cls = parseClass(line); if (cls) ev.cls = cls;
    const term = parseTerm(line); if (term) ev.term = term;
    const topic = /^(?:topic|theme|unit)\s*[\dIVX]*\s*[:.\-–]?\s*(.{3,100})$/i.exec(line);
    if (topic) ev.heading = topic[1]!.trim();
    if (ev.cls || ev.term || ev.heading) events.push(ev);
  }
  return events;
}

/** Labels each chunk with the class, term and topic in force at that point of the book. */
export function labelChunks(chunks: Array<{ start: number; content: string }>, events: MapEvent[], defaults: Scope) {
  let cls = defaults.cls ?? null, term = defaults.term ?? null, heading: string | null = null, e = 0;
  return chunks.map(chunk => {
    // Headings in the first 40% of a chunk already describe it.
    const cutoff = chunk.start + Math.floor(chunk.content.length * 0.4);
    while (e < events.length && events[e]!.pos <= cutoff) {
      const ev = events[e]!;
      if (ev.cls && (!cls || ev.cls.level !== cls.level || ev.cls.no !== cls.no)) { cls = ev.cls; if (!ev.term) term = defaults.term ?? null; }
      if (ev.term) term = ev.term;
      if (ev.heading) heading = ev.heading;
      e += 1;
    }
    return { ...chunk, cls, term, heading };
  });
}

const MAP_VERSION = 1;

/** Copies one e-library resource (metadata and its whole text) into the school's source store and maps it. */
export async function ingestResource(runtime: Runtime, organizationId: string, slug: string): Promise<SourceRow> {
  const existing = await runtime.db.query<SourceRow & { mapVersion: number }>(
    `SELECT id,title,resource_type AS "resourceType",status,chunk_count AS "chunkCount",map_version AS "mapVersion" FROM lrn_sources
      WHERE organization_id=$1 AND provider='ulibtech' AND external_slug=$2`, [organizationId, slug]);
  if (existing.rows[0]?.status === "ready" && existing.rows[0].mapVersion >= MAP_VERSION) return existing.rows[0];

  const library = ulibtech(runtime);
  // Published books have full catalogue details; drafts are described by the partner text endpoint.
  const meta = await library.resource(slug).catch(async () => {
    const t = (await library.text(slug, 0, 1000)).resource as Record<string, string | null>;
    return { slug, title: String(t.title ?? slug), typeSlug: t.type ?? null, className: t.className ?? null, subject: t.subject ?? null, term: t.term ?? null, ...library.links(slug) };
  });
  const id = existing.rows[0]?.id ?? createId("lsrc");
  await runtime.db.query(
    `INSERT INTO lrn_sources(id,organization_id,external_slug,title,resource_type,class_name,subject_name,term_name,page_url,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
     ON CONFLICT(organization_id,provider,external_slug) DO UPDATE SET title=EXCLUDED.title,resource_type=EXCLUDED.resource_type`,
    [id, organizationId, meta.slug, meta.title, meta.typeSlug, meta.className, meta.subject, meta.term, meta.pageUrl]);

  let text = "";
  try {
    text = (await library.fullText(meta.slug)).text ?? "";
  } catch (error) {
    await runtime.db.query(`UPDATE lrn_sources SET status='failed',error=$2 WHERE id=$1`, [id, error instanceof Error ? error.message : String(error)]);
    throw error;
  }
  // A book's own headings win; its catalogue class/term are the fallback when it has none.
  const titleClasses = classesInTitle(`${meta.title} ${meta.className ?? ""}`);
  const defaults: Scope = { cls: titleClasses.length === 1 ? titleClasses[0] : null, term: titleClassesTerm(meta.title, meta.term) };
  // A book about one class and one term is labelled as a whole; headings only split books that span several.
  const singleScope = titleClasses.length === 1 && defaults.term !== null;
  const chunks = labelChunks(chunkText(text), singleScope ? [] : mapHeadings(text), defaults);
  const covered = [...new Set(chunks.filter(c => c.cls).map(c => `${c.cls!.level}${c.cls!.no}`))];
  const terms = [...new Set(chunks.map(c => c.term).filter((t): t is number => Boolean(t)))].sort();
  const client = await runtime.db.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM lrn_source_chunks WHERE source_id=$1", [id]);
    for (const [seq, chunk] of chunks.entries()) {
      await client.query(
        `INSERT INTO lrn_source_chunks(id,organization_id,source_id,seq,char_start,content,class_level,class_no,term_no,heading) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [createId("lchk"), organizationId, id, seq, chunk.start, chunk.content, chunk.cls?.level ?? null, chunk.cls?.no ?? null, chunk.term, chunk.heading?.slice(0, 200) ?? null]);
    }
    await client.query(
      `UPDATE lrn_sources SET status=$2,total_chars=$3,chunk_count=$4,classes_covered=$5,terms_covered=$6,map_version=$7,fetched_at=CURRENT_TIMESTAMP,error=NULL WHERE id=$1`,
      [id, chunks.length ? "ready" : "no_text", text.length, chunks.length, covered.length ? covered : titleClasses.map(c => `${c.level}${c.no}`), terms, MAP_VERSION]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { id, title: meta.title, resourceType: meta.typeSlug, status: chunks.length ? "ready" : "no_text", chunkCount: chunks.length };
}

/** A title like "Term 1–3" or "All Terms" covers every term; "Term II" just one. */
function titleClassesTerm(title: string, catalogueTerm: string | null): number | null {
  if (/all\s+terms|terms?\s*(?:1|i|one)\s*(?:-|–|to|&)\s*(?:3|iii|three)|t1\s*-?\s*t3/i.test(title)) return null;
  return parseTerm(title) ?? (catalogueTerm ? parseTerm(catalogueTerm) : null);
}

export type Passage = { id: string; sourceId: string; sourceTitle: string; seq: number; content: string };

const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "what", "which", "into", "about", "lesson", "topic", "learners"]);

/** SQL filter keeping passages of the target class and term (unlabelled passages always pass). */
function scopeFilter(scope: Scope | undefined, params: unknown[]) {
  if (!scope) return "";
  const parts: string[] = [];
  if (scope.cls) {
    params.push(scope.cls.level, scope.cls.no);
    parts.push(`(c.class_no IS NULL OR (c.class_level=$${params.length - 1} AND c.class_no=$${params.length}))`);
  }
  if (scope.term) { params.push(scope.term); parts.push(`(c.term_no IS NULL OR c.term_no=$${params.length})`); }
  return parts.length ? ` AND ${parts.join(" AND ")}` : "";
}

/** Most relevant passages from the given sources for a topic, within a character budget, inside the class/term scope. */
export async function relevantPassages(runtime: Runtime, organizationId: string, sourceIds: string[], query: string, budgetChars: number, limit = 8, scope?: Scope): Promise<Passage[]> {
  if (!sourceIds.length) return [];
  const words = [...new Set(query.toLowerCase().match(/[a-z]{3,}/g) ?? [])].filter(w => !STOP.has(w)).slice(0, 24);
  if (!words.length) return [];
  const run = async (sc?: Scope) => {
    const params: unknown[] = [organizationId, sourceIds, words.join(" | "), limit * 2];
    const filter = scopeFilter(sc, params);
    return (await runtime.db.query<Passage & { rank: number }>(
      `SELECT c.id,c.source_id AS "sourceId",s.title AS "sourceTitle",c.seq,c.content,
              ts_rank(c.search, to_tsquery('english',$3)) * CASE WHEN c.class_no IS NOT NULL THEN 1.3 ELSE 1 END AS rank
         FROM lrn_source_chunks c JOIN lrn_sources s ON s.id=c.source_id
        WHERE c.organization_id=$1 AND c.source_id=ANY($2::text[]) AND c.search @@ to_tsquery('english',$3)${filter}
        ORDER BY rank DESC, c.seq LIMIT $4`, params)).rows;
  };
  let rows = await run(scope);
  if (!rows.length && scope) rows = await run({ cls: scope.cls });
  const picked: Passage[] = [];
  let used = 0;
  for (const row of rows) {
    if (picked.length >= limit || used + row.content.length > budgetChars) continue;
    picked.push(row);
    used += row.content.length;
  }
  return picked;
}

/** The passages of each source for the class and term, in book order, sharing the budget (used for the outline step). */
export async function openingPassages(runtime: Runtime, organizationId: string, sourceIds: string[], budgetChars: number, scope?: Scope): Promise<Passage[]> {
  if (!sourceIds.length) return [];
  const run = async (sc?: Scope) => {
    const params: unknown[] = [organizationId, sourceIds];
    const filter = scopeFilter(sc, params);
    // Labelled passages of the right class/term come before unlabelled ones (covers, introductions).
    return (await runtime.db.query<Passage>(
      `SELECT c.id,c.source_id AS "sourceId",s.title AS "sourceTitle",c.seq,c.content
         FROM lrn_source_chunks c JOIN lrn_sources s ON s.id=c.source_id
        WHERE c.organization_id=$1 AND c.source_id=ANY($2::text[])${filter}
        ORDER BY array_position($2::text[], c.source_id), (c.term_no IS NULL AND c.class_no IS NULL), c.seq LIMIT 400`, params)).rows;
  };
  let rows = await run(scope);
  if (!rows.length && scope) rows = await run();
  const share = Math.floor(budgetChars / new Set(rows.map(r => r.sourceId)).size || budgetChars);
  const usedBy = new Map<string, number>();
  const picked: Passage[] = [];
  for (const row of rows) {
    const used = usedBy.get(row.sourceId) ?? 0;
    if (used + row.content.length > share) continue;
    picked.push(row);
    usedBy.set(row.sourceId, used + row.content.length);
  }
  return picked.sort((a, b) => a.sourceId === b.sourceId ? a.seq - b.seq : 0);
}

export function formatPassages(passages: Passage[]) {
  return passages.map(p => `<passage id="${p.id}" source="${p.sourceTitle.replace(/"/g, "'")}" part="${p.seq + 1}">\n${p.content}\n</passage>`).join("\n\n");
}

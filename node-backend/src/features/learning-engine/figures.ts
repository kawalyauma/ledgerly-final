import { createHash } from "node:crypto";
import { z } from "zod";
import type { Runtime } from "../../runtime.js";
import { AppError } from "../../http/errors.js";
import { createId } from "../core-identity/security.js";
import { enqueueTask, getSettings, onTaskFailed, parseLenient, registerTaskHandler } from "./engine.js";
import { svgToPng } from "./export.js";
import { codedFigure, type CodedSpec } from "./figures-coded.js";

export type Anchor = { key: string; name: string; x: number; y: number };
export type FigureRow = {
  id: string; conceptKey: string; title: string; subject: string | null; kind: string; baseKey: string | null; svg: string | null;
  width: number | null; height: number | null; anchors: Anchor[]; status: string; uses: number;
};

const STOP = new Set(["a", "an", "the", "of", "showing", "show", "diagram", "drawing", "picture", "illustration", "labelled", "labeled", "and", "its", "with", "in", "on"]);
/** "The external parts of a domestic fowl (hen)" → "domestic-external-fowl-hen-parts" (word order does not matter). */
export function conceptKey(concept: string) {
  const words = concept.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w && !STOP.has(w))
    .map(w => w.replace(/(ies)$/, "y").replace(/([^s])s$/, "$1"));
  return [...new Set(words)].sort().join("-").slice(0, 160);
}
const slug = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const sameName = (a: string, b: string) => slug(a).replace(/s$/, "") === slug(b).replace(/s$/, "");

const figureColumns = `id,concept_key AS "conceptKey",title,subject,kind,base_key AS "baseKey",svg,width,height,anchors,status,uses`;

export async function getFigure(runtime: Runtime, id: string): Promise<FigureRow> {
  const r = await runtime.db.query<FigureRow>(`SELECT ${figureColumns} FROM lrn_figures WHERE id=$1`, [id]);
  if (!r.rows[0]) throw new AppError(404, "NOT_FOUND", "Figure not found");
  return r.rows[0];
}

/**
 * Finds a reusable figure for a concept: the same concept key, or a close one whose parts cover what the
 * lesson needs. Shared figures from any school count, so a drawing is only ever generated once.
 */
export async function findFigure(runtime: Runtime, organizationId: string, concept: string, parts: string[], subject?: string | null): Promise<FigureRow | null> {
  const key = conceptKey(concept);
  const rows = (await runtime.db.query<FigureRow & { sim: number }>(
    `SELECT ${figureColumns},similarity(concept_key,$1) AS sim FROM lrn_figures
      WHERE status IN ('ready','pending','generating') AND (shared OR organization_id=$2) AND (concept_key=$1 OR concept_key % $1)
        AND ($3::text IS NULL OR subject IS NULL OR lower(subject)=lower($3))
      ORDER BY (concept_key=$1) DESC,(status='ready') DESC,sim DESC,uses DESC LIMIT 10`, [key, organizationId, subject ?? null])).rows;
  for (const f of rows) {
    if (f.conceptKey === key) return f;
    if (f.sim < 0.55 || f.status !== "ready") continue;
    const covered = parts.filter(p => f.anchors.some(a => sameName(a.name, p))).length;
    if (!parts.length || covered / parts.length >= 0.6) return f;
  }
  return null;
}

/** Returns a figure for the concept: reused when it exists, otherwise queued for generation (counts towards the daily image limit). */
export async function requestFigure(runtime: Runtime, organizationId: string, requestedBy: string | null, input: { concept: string; title: string; parts: string[]; subject?: string | null; level?: string | null; style?: string | null }) {
  const found = await findFigure(runtime, organizationId, input.concept, input.parts, input.subject);
  if (found) {
    await runtime.db.query(`UPDATE lrn_figures SET uses=uses+1 WHERE id=$1`, [found.id]);
    return { figure: found, reused: true };
  }
  const settings = await getSettings(runtime, organizationId);
  if (!settings.imageGeneration) return { figure: null, reused: false, reason: "Image generation is switched off" };
  const today = await runtime.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM lrn_figures WHERE organization_id=$1 AND kind='generated' AND created_at >= date_trunc('day',CURRENT_TIMESTAMP)`, [organizationId]);
  if ((today.rows[0]?.n ?? 0) >= settings.dailyImageLimit) return { figure: null, reused: false, reason: "Today's image limit is used up" };
  const id = createId("lfig");
  await runtime.db.query(
    `INSERT INTO lrn_figures(id,organization_id,concept_key,title,subject,kind,status,source,anchors) VALUES($1,$2,$3,$4,$5,'generated','pending',$6::jsonb,$7::jsonb)`,
    [id, organizationId, conceptKey(input.concept), input.title.slice(0, 200), input.subject ?? null,
      JSON.stringify({ concept: input.concept, level: input.level ?? null, style: input.style ?? null, requestedParts: input.parts }),
      JSON.stringify(input.parts.map(p => ({ key: slug(p), name: p, x: -1, y: -1 })))]);
  await enqueueTask(runtime, organizationId, "figure.generate", id, { priority: 45, requestedBy });
  return { figure: await getFigure(runtime, id), reused: false };
}

/** Stores a code-drawn figure (shape, fraction, number line, clock, chart) once; identical requests reuse it. Never uses the AI. */
export async function codedFigureRow(runtime: Runtime, organizationId: string, spec: CodedSpec): Promise<FigureRow> {
  const drawn = codedFigure(spec);
  const existing = await runtime.db.query<FigureRow>(`SELECT ${figureColumns} FROM lrn_figures WHERE kind='coded' AND concept_key=$1`, [drawn.conceptKey]);
  if (existing.rows[0]) {
    await runtime.db.query(`UPDATE lrn_figures SET uses=uses+1 WHERE id=$1`, [existing.rows[0].id]);
    return existing.rows[0];
  }
  const id = createId("lfig");
  await runtime.db.query(
    `INSERT INTO lrn_figures(id,organization_id,concept_key,title,subject,kind,svg,width,height,anchors,status,source,uses)
     VALUES($1,$2,$3,$4,$5,'coded',$6,$7,$8,$9::jsonb,'ready',$10::jsonb,1) ON CONFLICT DO NOTHING`,
    [id, organizationId, drawn.conceptKey, drawn.title, drawn.subject, drawn.svg, drawn.width, drawn.height, JSON.stringify(drawn.anchors), JSON.stringify({ spec })]);
  return (await runtime.db.query<FigureRow>(`SELECT ${figureColumns} FROM lrn_figures WHERE kind='coded' AND concept_key=$1`, [drawn.conceptKey])).rows[0]!;
}

/* ───────────── Labelling ───────────── */

export type LabelSpec = {
  mode: "names" | "letters" | "blank" | "custom";
  /** Parts to label (names or anchor keys); default all. */
  parts?: string[];
  /** For custom: anchor key → text. */
  texts?: Record<string, string>;
  /** Shuffles which letter goes on which part (letters mode), so each exam paper differs. */
  seed?: number;
  title?: string | null;
};

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const escXml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function shuffle<T>(items: T[], seed: number) {
  const out = [...items];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i -= 1) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

/**
 * Composes the labelled picture: the unlabelled base image in the middle, labels in side columns, each joined to
 * its part by a leader line. Labels never overlap; the base drawing is never altered.
 */
export function composeLabelled(base: { href: string; width: number; height: number }, anchors: Anchor[], labels: Array<{ key: string; text: string; boxed?: boolean }>, title?: string | null) {
  const imgW = 900, imgH = Math.round(base.height * (imgW / base.width));
  const col = 300, top = title ? 70 : 24, W = imgW + col * 2;
  const placed = labels.map(l => ({ ...l, a: anchors.find(a => a.key === l.key)! })).filter(l => l.a && l.a.x >= 0);
  const sides = { left: placed.filter(l => l.a.x < 0.5), right: placed.filter(l => l.a.x >= 0.5) };
  const gap = 46;
  const layout = (items: typeof placed) => {
    const sorted = [...items].sort((p, q) => p.a.y - q.a.y);
    const ys = sorted.map(l => top + l.a.y * imgH);
    for (let i = 1; i < ys.length; i += 1) ys[i] = Math.max(ys[i]!, ys[i - 1]! + gap);
    const overflow = (ys.at(-1) ?? 0) - (top + imgH - 10);
    if (overflow > 0) for (let i = ys.length - 1; i >= 0; i -= 1) ys[i] = Math.max(top + 14, ys[i]! - overflow);
    for (let i = ys.length - 2; i >= 0; i -= 1) ys[i] = Math.min(ys[i]!, ys[i + 1]! - gap);
    return sorted.map((l, i) => ({ ...l, ly: ys[i]! }));
  };
  const H = Math.max(top + imgH + 24, ...[...layout(sides.left), ...layout(sides.right)].map(l => l.ly + 40));
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Liberation Sans">`,
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`,
    ...(title ? [`<text x="${W / 2}" y="44" font-size="30" font-weight="bold" text-anchor="middle" fill="#16202c">${escXml(title)}</text>`] : []),
    `<image href="${base.href}" x="${col}" y="${top}" width="${imgW}" height="${imgH}" preserveAspectRatio="xMidYMid meet"/>`,
  ];
  for (const [side, items] of [["left", layout(sides.left)], ["right", layout(sides.right)]] as const) {
    for (const l of items) {
      const ax = col + l.a.x * imgW, ay = top + l.a.y * imgH;
      const lx = side === "left" ? col - 16 : col + imgW + 16;
      parts.push(`<polyline points="${ax.toFixed(1)},${ay.toFixed(1)} ${(side === "left" ? lx + 10 : lx - 10).toFixed(1)},${l.ly.toFixed(1)} ${lx.toFixed(1)},${l.ly.toFixed(1)}" fill="none" stroke="#222" stroke-width="2.2"/>`);
      parts.push(`<circle cx="${ax.toFixed(1)}" cy="${ay.toFixed(1)}" r="5" fill="#222"/>`);
      if (l.boxed) {
        const bx = side === "left" ? lx - 210 : lx;
        parts.push(`<rect x="${bx}" y="${l.ly - 22}" width="210" height="44" fill="#fff" stroke="#222" stroke-width="2" rx="4"/>`);
        if (l.text) parts.push(`<text x="${bx + 105}" y="${l.ly + 9}" font-size="26" font-weight="bold" text-anchor="middle" fill="#16202c">${escXml(l.text)}</text>`);
      } else {
        parts.push(`<text x="${side === "left" ? lx - 8 : lx + 8}" y="${l.ly + 9}" font-size="27" text-anchor="${side === "left" ? "end" : "start"}" fill="#16202c">${escXml(l.text)}</text>`);
      }
    }
  }
  parts.push("</svg>");
  return { svg: parts.join(""), width: W, height: H };
}

async function baseHref(runtime: Runtime, f: FigureRow) {
  if (f.svg) return { href: `data:image/svg+xml;base64,${Buffer.from(f.svg).toString("base64")}`, width: f.width ?? 640, height: f.height ?? 420 };
  if (!f.baseKey) throw new AppError(409, "FIGURE_NOT_READY", "This figure is still being drawn");
  const bytes = await runtime.storage.get(f.baseKey);
  if (!bytes) throw new AppError(404, "FIGURE_IMAGE_MISSING", "The figure image is missing");
  return { href: `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`, width: f.width ?? 1024, height: f.height ?? 1024 };
}

/** Renders (or reuses) a labelling of a figure and returns its image key and answer key. */
export async function labelFigure(runtime: Runtime, figureId: string, spec: LabelSpec) {
  const f = await getFigure(runtime, figureId);
  if (f.status !== "ready") throw new AppError(409, "FIGURE_NOT_READY", "This figure is still being drawn");
  const usable = f.anchors.filter(a => a.x >= 0 && a.y >= 0);
  const chosen = spec.parts?.length ? usable.filter(a => spec.parts!.some(p => p === a.key || sameName(p, a.name))) : usable;
  if (!chosen.length) throw new AppError(422, "NO_PARTS", "None of those parts are marked on this figure");
  let labels: Array<{ key: string; text: string; boxed?: boolean }>;
  const answerKey: Record<string, string> = {};
  if (spec.mode === "letters") {
    // Without a seed letters run top to bottom; each exam paper passes its own seed so letters land on different parts.
    const order = spec.seed && spec.seed > 1 ? shuffle(chosen, spec.seed) : [...chosen].sort((p, q) => p.y - q.y);
    labels = order.map((a, i) => { answerKey[LETTERS[i]!] = a.name; return { key: a.key, text: LETTERS[i]!, boxed: true }; });
  } else if (spec.mode === "blank") {
    labels = chosen.map(a => ({ key: a.key, text: "", boxed: true }));
    chosen.forEach((a, i) => { answerKey[String(i + 1)] = a.name; });
  } else if (spec.mode === "custom") {
    labels = chosen.map(a => ({ key: a.key, text: spec.texts?.[a.key] ?? a.name }));
  } else {
    labels = chosen.map(a => ({ key: a.key, text: a.name }));
  }
  const canonical = { mode: spec.mode, labels: labels.map(l => [l.key, l.text, Boolean(l.boxed)]), title: spec.title ?? null };
  const specHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
  const cached = await runtime.db.query<{ id: string; pngKey: string; width: number; height: number; answerKey: Record<string, string> }>(
    `SELECT id,png_key AS "pngKey",width,height,answer_key AS "answerKey" FROM lrn_figure_labelings WHERE figure_id=$1 AND spec_hash=$2`, [figureId, specHash]);
  if (cached.rows[0]) return cached.rows[0];
  const composed = composeLabelled(await baseHref(runtime, f), f.anchors, labels, spec.title);
  const png = svgToPng(composed.svg, composed.width);
  const id = createId("llab");
  const pngKey = `learning/figures/${figureId}/${id}.png`;
  await runtime.storage.put(pngKey, png.png, "image/png");
  await runtime.db.query(
    `INSERT INTO lrn_figure_labelings(id,figure_id,mode,spec_hash,spec,answer_key,png_key,width,height) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9)
     ON CONFLICT(figure_id,spec_hash) DO NOTHING`,
    [id, figureId, spec.mode, specHash, JSON.stringify(canonical), JSON.stringify(answerKey), pngKey, png.width, png.height]);
  const row = await runtime.db.query<{ id: string; pngKey: string; width: number; height: number; answerKey: Record<string, string> }>(
    `SELECT id,png_key AS "pngKey",width,height,answer_key AS "answerKey" FROM lrn_figure_labelings WHERE figure_id=$1 AND spec_hash=$2`, [figureId, specHash]);
  return row.rows[0]!;
}

export async function labelingImage(runtime: Runtime, labelingId: string) {
  const r = await runtime.db.query<{ pngKey: string }>(`SELECT png_key AS "pngKey" FROM lrn_figure_labelings WHERE id=$1`, [labelingId]);
  if (!r.rows[0]) return null;
  return runtime.storage.get(r.rows[0].pngKey);
}

/**
 * An exam item from a figure: a fresh letter layout (seeded per paper) and "Name the parts marked A–D",
 * with the answer key. Different papers get different letters on different parts.
 */
export async function figureExamItem(runtime: Runtime, figureId: string, input: { count: number; seed: number; parts?: string[]; mode?: "letters" | "blank" }) {
  const f = await getFigure(runtime, figureId);
  const usable = f.anchors.filter(a => a.x >= 0);
  const pool = input.parts?.length ? usable.filter(a => input.parts!.some(p => sameName(p, a.name) || p === a.key)) : usable;
  const pick = shuffle(pool, input.seed).slice(0, Math.max(1, Math.min(input.count, pool.length)));
  const mode = input.mode ?? "letters";
  const labeling = await labelFigure(runtime, figureId, { mode, parts: pick.map(a => a.key), seed: input.seed, title: null });
  const letters = Object.keys(labeling.answerKey);
  const question = mode === "letters"
    ? `Study the diagram of ${f.title.toLowerCase().replace(/^(the|a)\s+/, "")} and name the parts marked ${letters.length > 1 ? `${letters.slice(0, -1).join(", ")} and ${letters.at(-1)}` : letters[0]}.`
    : `Label the parts of ${f.title.toLowerCase().replace(/^(the|a)\s+/, "")} in the boxes provided.`;
  return { figureId, labelingId: labeling.id, question, answerKey: labeling.answerKey, imageUrl: `/api/v1/learn/figures/labelings/${labeling.id}.png` };
}

/* ───────────── Generation (Codex) ───────────── */

const anchorReply = z.object({
  parts: z.array(z.object({ name: z.string().min(1).max(80), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(30),
  missing: z.array(z.string().max(80)).max(30).default([]),
  textInImage: z.boolean().default(false),
});
const qaReply = z.object({
  ok: z.boolean(),
  fixes: z.array(z.object({ name: z.string().max(80), x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).max(30).default([]),
  problems: z.array(z.string().max(300)).max(20).default([]),
});

const STYLE = "a clean, colourful school textbook illustration in flat vector style with bold dark outlines and soft shading, on a plain pure-white background, centred, with generous margins, scientifically accurate";

registerTaskHandler("figure.generate", async (ctx) => {
  const { runtime, task } = ctx;
  const f = await getFigure(runtime, task.subjectRef);
  if (f.status === "ready") return { skipped: "already drawn" };
  const src = (await runtime.db.query<{ source: { concept: string; level: string | null; style: string | null; requestedParts: string[] } }>(
    `SELECT source FROM lrn_figures WHERE id=$1`, [f.id])).rows[0]!.source;
  await runtime.db.query(`UPDATE lrn_figures SET status='generating',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [f.id]);
  const parts = src.requestedParts ?? [];

  // 1. Draw (no text at all; Ledgerly adds the labels itself so spelling and terms are always right).
  const drawn = await ctx.aiWithFiles({
    prompt: [
      `Use your image generation tool to create ONE image: ${src.concept}${src.level ? ` (for ${src.level} learners in Uganda)` : ""}.`,
      `Style: ${src.style || STYLE}.`,
      parts.length ? `Every one of these parts must be clearly visible and distinct: ${parts.join(", ")}.` : "",
      "ABSOLUTELY NO TEXT, NO LABELS, NO LETTERS, NO NUMBERS, NO ARROWS OR LEADER LINES anywhere in the image.",
      "Save the generated image file into /outputs/figure.png (copy it there from where the tool saved it). Reply only with: saved.",
    ].filter(Boolean).join("\n"),
  });
  const file = drawn.files.find(x => /\.(png|jpe?g|webp)$/i.test(x.name));
  if (!file) throw new Error("The image generator did not return an image.");
  const pngBytes = file.bytes;
  const width = pngBytes.length > 24 ? Buffer.from(pngBytes).readUInt32BE(16) : 1024;
  const height = pngBytes.length > 24 ? Buffer.from(pngBytes).readUInt32BE(20) : 1024;
  const baseKey = `learning/figures/${f.id}/base.png`;
  await runtime.storage.put(baseKey, pngBytes, "image/png");

  // 2. Find each part on the picture.
  const anchored = parseLenient(anchorReply, await ctx.ai({
    images: [{ name: "figure.png", bytes: pngBytes }],
    prompt: [
      `The attached image (${width}x${height}px) shows: ${src.concept}.`,
      `For each of these parts, give ONE point that lies clearly ON that part, where a label line should touch it: ${parts.join(", ")}.`,
      "Use fractions of the image size: x from 0 (left edge) to 1 (right edge), y from 0 (top) to 1 (bottom). Be precise; look carefully.",
      "List parts that are not visible in missing. Set textInImage true if the picture contains any text or letters.",
      'Reply shape: {"parts":[{"name":string,"x":number,"y":number}],"missing":[string],"textInImage":boolean}',
    ].join("\n"),
  }));
  let anchors: Anchor[] = anchored.parts.map(p => ({ key: slug(p.name), name: parts.find(q => sameName(q, p.name)) ?? p.name, x: p.x, y: p.y }));

  // 3. Check: label it with the names and ask Codex whether every line points at the right part; apply its fixes once.
  const tmp = { ...f, baseKey, width, height, anchors, status: "ready" } as FigureRow;
  const preview = composeLabelled(await baseHref(runtime, tmp), anchors, anchors.map(a => ({ key: a.key, text: a.name })), null);
  const check = parseLenient(qaReply, await ctx.ai({
    images: [{ name: "check.png", bytes: svgToPng(preview.svg, 1500).png }, { name: "original.png", bytes: pngBytes }],
    prompt: [
      "The first image is a labelled teaching diagram; the second is the same picture without labels.",
      `Check that every label line ends exactly on the named part (${anchors.map(a => a.name).join(", ")}).`,
      "For any label that points at the wrong place, give the corrected point as fractions (x, y) of the SECOND (unlabelled) image.",
      'Reply shape: {"ok":boolean,"fixes":[{"name":string,"x":number,"y":number}],"problems":[string]}',
    ].join("\n"),
  }));
  for (const fix of check.fixes) anchors = anchors.map(a => sameName(a.name, fix.name) ? { ...a, x: fix.x, y: fix.y } : a);
  await runtime.db.query(
    `UPDATE lrn_figures SET status='ready',base_key=$2,width=$3,height=$4,anchors=$5::jsonb,qa=$6::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
    [f.id, baseKey, width, height, JSON.stringify(anchors), JSON.stringify({ textInImage: anchored.textInImage, missing: anchored.missing, ok: check.ok, fixed: check.fixes.length, problems: check.problems })]);

  // 4. Lessons waiting for this drawing get their labelled version now.
  const waiting = await runtime.db.query<{ id: string; parts: string[] }>(`SELECT id,parts FROM lrn_lesson_assets WHERE figure_id=$1 AND labeling_id IS NULL`, [f.id]);
  for (const w of waiting.rows) {
    const l = await labelFigure(runtime, f.id, { mode: "names", parts: w.parts.length ? w.parts : undefined }).catch(() => null);
    if (l) await runtime.db.query(`UPDATE lrn_lesson_assets SET labeling_id=$2 WHERE id=$1`, [w.id, l.id]);
  }
  return { anchors: anchors.length, missing: anchored.missing, qaOk: check.ok, fixes: check.fixes.length, lessonsUpdated: waiting.rowCount };
});

onTaskFailed("figure.generate", async (runtime, task, message) => {
  await runtime.db.query(`UPDATE lrn_figures SET status='failed',error=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [task.subjectRef, message]);
});

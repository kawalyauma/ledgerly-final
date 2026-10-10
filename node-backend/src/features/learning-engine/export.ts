import { Resvg } from "@resvg/resvg-js";
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow,
  TextRun, WidthType, type ISectionOptions,
} from "docx";
import type { Runtime } from "../../runtime.js";
import { AppError } from "../../http/errors.js";
import { createId } from "../core-identity/security.js";
import { ulibtech } from "../school-management/ulibtech.js";

/** Renders a sanitised diagram SVG to PNG (fonts come from the system), for Word documents and previews. */
export function svgToPng(svg: string, width = 1280): { png: Uint8Array; width: number; height: number } {
  // The renderer matches fonts by exact family name only, so map the diagram's fonts to ones installed on the server.
  const fixed = svg.replace(/font-family="[^"]*"/g, 'font-family="Liberation Sans"');
  const out = new Resvg(fixed, {
    fitTo: { mode: "width", value: width }, background: "white",
    // Explicit font folders: the renderer's own system-font discovery finds nothing in the slim server image.
    font: { loadSystemFonts: false, fontDirs: ["/usr/share/fonts/truetype", "/usr/share/fonts"], defaultFontFamily: "Liberation Sans", sansSerifFamily: "Liberation Sans", serifFamily: "DejaVu Serif" },
  }).render();
  return { png: out.asPng(), width: out.width, height: out.height };
}

type Plan = {
  competences?: string[]; languageCompetence?: string | null; objectives?: string[]; priorKnowledge?: string | null; methods?: string[]; materials?: string[];
  references?: string[]; steps?: Array<{ stage: string; minutes?: number | null; teacherActivity: string; learnerActivity: string }>;
  assessment?: string | null; homework?: string | null; lifeSkills?: string[];
};
type LessonRow = {
  id: string; seq: number; week: number | null; periods: number; title: string; subtopic: string | null; objectives: string[]; status: string;
  notes: string | null; plan: Plan | null; methods: string | null; materials: string | null; unit: string; theme: string | null; competences: string | null;
};

const border = { style: BorderStyle.SINGLE, size: 4, color: "B8C2CF" };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

/** **bold** and *italic* inside a line, as runs. */
function runs(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun[] {
  const out: TextRun[] = [];
  for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g)) {
    if (!part) continue;
    if (part.startsWith("**")) out.push(new TextRun({ text: part.slice(2, -2), bold: true, size: opts.size }));
    else if (part.startsWith("*") && part.length > 2) out.push(new TextRun({ text: part.slice(1, -1), italics: true, bold: opts.bold, size: opts.size }));
    else out.push(new TextRun({ text: part.replace(/`/g, ""), bold: opts.bold, size: opts.size }));
  }
  return out;
}

const cell = (text: string, o: { bold?: boolean; fill?: string; width?: number; size?: number } = {}) => new TableCell({
  children: text.split("\n").map(line => new Paragraph({ children: runs(line, { bold: o.bold, size: o.size ?? 19 }) })),
  shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
  width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
  margins: { top: 60, bottom: 60, left: 90, right: 90 },
});

function table(header: string[], rows: string[][], widths?: number[]) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders,
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, { bold: true, fill: "E8F0FD", width: widths?.[i] })) }),
      ...rows.map(r => new TableRow({ children: r.map((v, i) => cell(v, { width: widths?.[i] })) })),
    ],
  });
}

function diagramBlock(svg: string, title: string, caption: string | null, maxWidthPx = 600): Paragraph[] {
  try {
    const img = svgToPng(svg);
    const w = Math.min(maxWidthPx, img.width), h = Math.round(img.height * (w / img.width));
    return [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 }, children: [new ImageRun({ type: "png", data: img.png, transformation: { width: w, height: h } })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: title, bold: true, size: 18 }), ...(caption ? [new TextRun({ text: ` — ${caption}`, size: 18, color: "5B6878" })] : [])] }),
    ];
  } catch {
    return [new Paragraph({ children: [new TextRun({ text: `[Diagram: ${title}]`, italics: true })] })];
  }
}

/** Markdown subset → Word: headings, bullet/numbered lists, tables, paragraphs, and [[diagram:key]] images. */
function markdownToDocx(md: string, diagram: (key: string) => Paragraph[]): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  const lines = md.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const d = /^\s*\[\[diagram:([a-z0-9-]+)\]\]\s*$/.exec(line);
    if (d) { out.push(...diagram(d[1]!)); continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) { rows.push(cells(lines[i]!)); i += 1; }
      i -= 1;
      out.push(table(header, rows.map(r => header.map((_, k) => r[k] ?? ""))), new Paragraph({ text: "" }));
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { out.push(new Paragraph({ heading: [HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_4][h[1]!.length - 1], children: runs(h[2]!) })); continue; }
    const li = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) { out.push(new Paragraph({ children: [new TextRun(li[1] ? "•  " : `${li[2]}.  `), ...runs(li[3]!)], indent: { left: 360, hanging: 260 }, spacing: { after: 40 } })); continue; }
    if (!line.trim()) continue;
    out.push(new Paragraph({ children: runs(line), spacing: { after: 100 } }));
  }
  return out;
}

const list = (items?: string[]) => (items?.length ? items : ["—"]).map(t => new Paragraph({ children: [new TextRun("•  "), ...runs(t)], indent: { left: 360, hanging: 260 } }));
const label = (text: string) => new Paragraph({ spacing: { before: 140, after: 40 }, children: [new TextRun({ text, bold: true, color: "123D8A" })] });

export async function loadSchemeForExport(runtime: Runtime, organizationId: string, schemeId: string, untilWeek?: number) {
  const s = await runtime.db.query<{
    id: string; title: string; summary: string | null; weeks: number; periodsPerWeek: number; className: string; subjectName: string; termName: string;
    school: string; library: { classSlug: string | null; subjectSlug: string | null; termSlug: string | null }; writeUntilWeek: number | null;
  }>(
    `SELECT sc.id,sc.title,sc.summary,sc.weeks,sc.periods_per_week AS "periodsPerWeek",c.name AS "className",sub.name AS "subjectName",t.name AS "termName",
            o.name AS school,sc.library_filters AS library,sc.write_until_week AS "writeUntilWeek"
       FROM lrn_schemes sc JOIN school_classes c ON c.id=sc.class_id JOIN school_subjects sub ON sub.id=sc.subject_id JOIN school_terms t ON t.id=sc.term_id
       JOIN organizations o ON o.id=sc.organization_id WHERE sc.id=$1 AND sc.organization_id=$2`, [schemeId, organizationId]);
  const scheme = s.rows[0];
  if (!scheme) throw new AppError(404, "NOT_FOUND", "Scheme not found");
  const lessons = (await runtime.db.query<LessonRow>(
    `SELECT l.id,l.seq,l.week,l.periods,l.title,l.subtopic,l.objectives,l.status,l.notes_markdown AS notes,l.lesson_plan AS plan,l.methods,l.materials,
            u.title AS unit,u.theme,u.competences
       FROM lrn_lessons l JOIN lrn_units u ON u.id=l.unit_id WHERE l.scheme_id=$1 AND ($2::int IS NULL OR COALESCE(l.week,1) <= $2) ORDER BY l.seq`,
    [schemeId, untilWeek ?? null])).rows;
  const assets = (await runtime.db.query<{ lessonId: string; key: string; title: string; caption: string | null; svg: string }>(
    `SELECT lesson_id AS "lessonId",asset_key AS key,title,caption,svg FROM lrn_lesson_assets WHERE lesson_id=ANY($1::text[]) ORDER BY created_at`,
    [lessons.map(l => l.id)])).rows;
  const questions = (await runtime.db.query<{ lessonId: string; stem: string; answer: string | null }>(
    `SELECT lesson_id AS "lessonId",stem,answer FROM lrn_questions WHERE lesson_id=ANY($1::text[]) AND status='active' ORDER BY created_at`,
    [lessons.map(l => l.id)])).rows;
  const sources = (await runtime.db.query<{ title: string; role: string; pageUrl: string | null }>(
    `SELECT s.title,ss.role,s.page_url AS "pageUrl" FROM lrn_scheme_sources ss JOIN lrn_sources s ON s.id=ss.source_id WHERE ss.scheme_id=$1 ORDER BY ss.role,s.title`, [schemeId])).rows;
  return { scheme, lessons, assets, questions, sources };
}

/** The scheme as a Word document: scheme of work table, then a lesson plan and learner notes (with diagrams) per lesson. */
export async function schemeDocx(runtime: Runtime, organizationId: string, schemeId: string, untilWeek?: number) {
  const { scheme, lessons, assets, questions, sources } = await loadSchemeForExport(runtime, organizationId, schemeId, untilWeek);
  const weeksLabel = untilWeek ? (untilWeek === 1 ? "Week 1" : `Weeks 1–${untilWeek}`) : "Whole term";
  const sections: ISectionOptions[] = [];

  sections.push({
    properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
    children: [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: scheme.school.toUpperCase(), bold: true, size: 28 })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `${scheme.subjectName.toUpperCase()} SCHEME OF WORK · ${scheme.className.toUpperCase()} · ${scheme.termName.toUpperCase()}`, bold: true, size: 26, color: "123D8A" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: `${weeksLabel} · ${scheme.periodsPerWeek} periods a week · prepared by Ledgerly AI from the sources listed at the end`, size: 18, color: "5B6878" })] }),
      ...(scheme.summary ? [new Paragraph({ spacing: { after: 160 }, children: runs(scheme.summary, { size: 20 }) })] : []),
      table(
        ["Wk", "Pd", "Theme / Topic", "Subtopic", "Competences & objectives", "Methods", "Learning activities", "Materials", "Ref."],
        lessons.map(l => {
          const p = l.plan;
          return [
            String(l.week ?? ""), String(l.periods), [l.theme, l.unit].filter(Boolean).join("\n"), [l.title, l.subtopic].filter(Boolean).join(": "),
            [...(p?.competences ?? []), ...(p?.objectives ?? l.objectives ?? [])].slice(0, 6).map(x => `• ${x}`).join("\n"),
            (p?.methods ?? (l.methods ? [l.methods] : [])).join(", "),
            (p?.steps ?? []).map(st => st.learnerActivity).filter(Boolean).slice(0, 3).map(x => `• ${x}`).join("\n"),
            (p?.materials ?? (l.materials ? [l.materials] : [])).join(", "),
            (p?.references ?? []).slice(0, 2).join("; "),
          ];
        }),
        [4, 4, 12, 13, 20, 10, 18, 10, 9],
      ),
    ],
  });

  for (const l of lessons.filter(x => x.notes || x.plan)) {
    const p = l.plan;
    const mine = assets.filter(a => a.lessonId === l.id);
    const used = new Set<string>();
    const fig = (key: string) => { const a = mine.find(x => x.key === key); if (!a) return []; used.add(key); return diagramBlock(a.svg, a.title, a.caption); };
    const children: Array<Paragraph | Table> = [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(`Lesson ${l.seq}: ${l.title}`)] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: `${scheme.subjectName} · ${scheme.className} · ${scheme.termName} · Week ${l.week ?? "-"} · ${l.periods} period(s) · ${l.unit}${l.subtopic ? ` › ${l.subtopic}` : ""}`, color: "5B6878", size: 18 })] }),
    ];
    if (p) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Lesson plan")] }));
      children.push(table(["Class", "Subject", "Topic", "Subtopic", "Duration"], [[scheme.className, scheme.subjectName, l.unit, l.subtopic ?? l.title, `${l.periods} period(s)`]]));
      children.push(label("Competences"), ...list(p.competences));
      if (p.languageCompetence) children.push(label("Language competence"), new Paragraph({ children: runs(p.languageCompetence) }));
      children.push(label("Objectives"), ...list(p.objectives));
      if (p.priorKnowledge) children.push(label("Prior knowledge"), new Paragraph({ children: runs(p.priorKnowledge) }));
      children.push(label("Methods"), ...list(p.methods), label("Instructional materials"), ...list(p.materials));
      children.push(label("Lesson procedure"), table(["Stage", "Time", "Teacher's activity", "Learners' activity"],
        (p.steps ?? []).map(st => [st.stage, st.minutes ? `${st.minutes} min` : "", st.teacherActivity, st.learnerActivity]), [18, 8, 37, 37]));
      if (p.assessment) children.push(label("Assessment"), new Paragraph({ children: runs(p.assessment) }));
      if (p.homework) children.push(label("Homework"), new Paragraph({ children: runs(p.homework) }));
      if (p.lifeSkills?.length) children.push(label("Life skills and values"), ...list(p.lifeSkills));
      if (p.references?.length) children.push(label("References"), ...list(p.references));
    }
    if (l.notes) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, pageBreakBefore: Boolean(p), children: [new TextRun("Lesson notes")] }));
      children.push(...markdownToDocx(l.notes, fig));
    }
    for (const a of mine.filter(x => !used.has(x.key))) children.push(...diagramBlock(a.svg, a.title, a.caption));
    const qs = questions.filter(q => q.lessonId === l.id);
    if (qs.length) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Activity")] }));
      qs.forEach((q, i) => children.push(new Paragraph({ children: [new TextRun(`${i + 1}.  `), ...runs(q.stem)], indent: { left: 360, hanging: 300 }, spacing: { after: 60 } })));
    }
    sections.push({ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children });
  }

  sections.push({
    properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Sources")] }),
      new Paragraph({ children: [new TextRun({ text: "Every topic, note and activity above was drawn from these e-library resources (notesug.com). The diagrams were drawn by Ledgerly AI from what the sources describe. Teachers should review before use.", size: 19 })] }),
      ...sources.map(s => new Paragraph({ children: [new TextRun("•  "), new TextRun({ text: s.title, bold: true }), new TextRun({ text: ` (${s.role.replace("_", " ")})${s.pageUrl ? ` — ${s.pageUrl}` : ""}`, size: 18 })], indent: { left: 360, hanging: 260 } })),
    ],
  });

  const doc = new Document({
    creator: "Ledgerly AI", title: `${scheme.title} (${weeksLabel})`,
    styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
    sections,
  });
  const bytes = new Uint8Array(await Packer.toBuffer(doc));
  const name = `${scheme.subjectName} ${scheme.className} ${scheme.termName} ${weeksLabel} scheme lesson plans notes`.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return { bytes, fileName: `${name}.docx`, scheme, lessons, weeksLabel };
}

/** Posts the scheme pack (Word document) to the public library, notesug.com, and records the link. */
export async function postSchemeToLibrary(runtime: Runtime, organizationId: string, userId: string, schemeId: string, untilWeek?: number) {
  const doc = await schemeDocx(runtime, organizationId, schemeId, untilWeek);
  const s = doc.scheme;
  const written = doc.lessons.filter(l => l.notes).length;
  if (!written) throw new AppError(409, "NOTHING_WRITTEN", "No lessons have been written yet");
  const title = `${s.className.replace(/\s+\d{4}$/, "")} ${s.subjectName} Scheme of Work, Lesson Plans and Notes – ${s.termName}, ${doc.weeksLabel}`;
  const posted = await ulibtech(runtime).publish(
    { name: doc.fileName, bytes: doc.bytes, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    {
      title: title.slice(0, 200),
      shortDescription: `${s.subjectName} ${s.className.replace(/\s+\d{4}$/, "")} ${s.termName}: scheme of work with ${written} full lesson plans and learner notes with diagrams.`.slice(0, 300),
      description: `Prepared by Ledgerly AI from Ugandan schemes of work, curricula and lesson notes in the e-library. Includes the scheme of work table, a sample lesson plan for each lesson (competences, objectives, methods, materials, timed procedure) and learner notes with diagrams and activities.${s.summary ? `\n\n${s.summary}` : ""}`,
      classSlug: s.library.classSlug ?? undefined, subjectSlug: s.library.subjectSlug ?? undefined, termSlug: s.library.termSlug ?? undefined,
      typeSlug: "schemes-of-work", author: "Ledgerly AI", keywords: [s.subjectName, s.className, s.termName, "scheme of work", "lesson plans", "lesson notes"].join(","),
    });
  await runtime.db.query(
    `INSERT INTO lrn_library_posts(id,organization_id,scheme_id,kind,weeks,external_slug,page_url,status,posted_by) VALUES($1,$2,$3,'lesson_pack',$4,$5,$6,$7,$8)`,
    [createId("lpost"), organizationId, schemeId, doc.weeksLabel, posted.slug, posted.pageUrl, posted.status, userId]);
  return { slug: posted.slug, url: posted.pageUrl, status: posted.status, lessons: written };
}

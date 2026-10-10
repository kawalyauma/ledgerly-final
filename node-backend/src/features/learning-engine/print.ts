import type { Runtime } from "../../runtime.js";
import { getLesson } from "./schemes.js";

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Small, safe Markdown subset (headings, lists, bold, italics, tables, paragraphs); everything is escaped first. */
export function markdownToHtml(md: string, diagram: (key: string) => string): string {
  const inline = (t: string) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<i>$2</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
  const out: string[] = [];
  const lines = md.replace(/\r/g, "").split("\n");
  let list: "ul" | "ol" | null = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const d = /^\s*\[\[diagram:([a-z0-9-]+)\]\]\s*$/.exec(line);
    if (d) { close(); out.push(diagram(d[1]!)); continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      close();
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      out.push("<table><tr>" + cells(line).map(c => `<th>${inline(c)}</th>`).join("") + "</tr>");
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) { out.push("<tr>" + cells(lines[i]!).map(c => `<td>${inline(c)}</td>`).join("") + "</tr>"); i += 1; }
      i -= 1; out.push("</table>"); continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { close(); const n = Math.min(4, h[1]!.length + 1); out.push(`<h${n}>${inline(h[2]!)}</h${n}>`); continue; }
    const li = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) { const kind = li[1] ? "ul" : "ol"; if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; } out.push(`<li>${inline(li[3]!)}</li>`); continue; }
    if (!line.trim()) { close(); continue; }
    close(); out.push(`<p>${inline(line)}</p>`);
  }
  close();
  return out.join("\n");
}

type Plan = { competences?: string[]; languageCompetence?: string | null; objectives?: string[]; priorKnowledge?: string | null; methods?: string[]; materials?: string[];
  references?: string[]; steps?: Array<{ stage: string; minutes?: number | null; teacherActivity: string; learnerActivity: string }>; assessment?: string | null; homework?: string | null; lifeSkills?: string[] };

/** A printable page for one lesson: sample lesson plan, learner notes with diagrams inline, and the sources used. */
export async function lessonPrintHtml(runtime: Runtime, organizationId: string, lessonId: string) {
  const l = await getLesson(runtime, organizationId, lessonId) as Awaited<ReturnType<typeof getLesson>> & { lessonPlan: Plan | null };
  const meta = await runtime.db.query<{ subject: string; className: string; term: string; school: string | null }>(
    `SELECT s.name AS subject,c.name AS "className",t.name AS term,(SELECT name FROM organizations WHERE id=$2) AS school
       FROM lrn_schemes sc JOIN school_subjects s ON s.id=sc.subject_id JOIN school_classes c ON c.id=sc.class_id JOIN school_terms t ON t.id=sc.term_id WHERE sc.id=$1`,
    [String(l.schemeId), organizationId]);
  const m = meta.rows[0];
  const assets = await runtime.db.query<{ key: string; title: string; caption: string | null; svg: string }>(
    `SELECT asset_key AS key,title,caption,svg FROM lrn_lesson_assets WHERE lesson_id=$1`, [lessonId]);
  const byKey = new Map(assets.rows.map(a => [a.key, a]));
  const used = new Set<string>();
  // Sanitised SVG is embedded as an <img> data URI so it renders as a picture and can never run anything.
  const figure = (key: string) => {
    const a = byKey.get(key);
    if (!a) return "";
    used.add(key);
    return `<figure><img alt="${esc(a.title)}" src="data:image/svg+xml;base64,${Buffer.from(a.svg).toString("base64")}"><figcaption><b>${esc(a.title)}</b>${a.caption ? ` — ${esc(a.caption)}` : ""}</figcaption></figure>`;
  };
  const notes = l.notes ? markdownToHtml(String(l.notes), figure) : "<p><i>Notes not written yet.</i></p>";
  const extra = assets.rows.filter(a => !used.has(a.key)).map(a => figure(a.key)).join("");
  const p = l.lessonPlan;
  const list = (items?: string[]) => items?.length ? `<ul>${items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : "<p>—</p>";
  const plan = p ? `
    <section class="plan"><h2>Sample lesson plan</h2>
      <table class="kv">
        <tr><th>Class</th><td>${esc(m?.className)}</td><th>Subject</th><td>${esc(m?.subject)}</td></tr>
        <tr><th>Topic</th><td>${esc(l.unit)}</td><th>Subtopic</th><td>${esc(l.subtopic ?? l.title)}</td></tr>
        <tr><th>Periods</th><td>${esc(l.periods)}</td><th>Week</th><td>${esc(l.week ?? "")}</td></tr>
      </table>
      <h3>Competences</h3>${list(p.competences)}${p.languageCompetence ? `<p><b>Language competence:</b> ${esc(p.languageCompetence)}</p>` : ""}
      <h3>Objectives</h3>${list(p.objectives)}
      ${p.priorKnowledge ? `<h3>Prior knowledge</h3><p>${esc(p.priorKnowledge)}</p>` : ""}
      <div class="two"><div><h3>Methods</h3>${list(p.methods)}</div><div><h3>Materials</h3>${list(p.materials)}</div></div>
      <h3>Lesson procedure</h3>
      <table><tr><th>Stage</th><th>Time</th><th>Teacher's activity</th><th>Learners' activity</th></tr>
        ${(p.steps ?? []).map(s => `<tr><td><b>${esc(s.stage)}</b></td><td>${s.minutes ? `${esc(s.minutes)} min` : ""}</td><td>${esc(s.teacherActivity)}</td><td>${esc(s.learnerActivity)}</td></tr>`).join("")}
      </table>
      ${p.assessment ? `<h3>Assessment</h3><p>${esc(p.assessment)}</p>` : ""}${p.homework ? `<h3>Homework</h3><p>${esc(p.homework)}</p>` : ""}
      ${p.lifeSkills?.length ? `<h3>Life skills and values</h3>${list(p.lifeSkills)}` : ""}
      ${p.references?.length ? `<h3>References</h3>${list(p.references)}` : ""}
    </section>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(l.title)} · ${esc(m?.subject)} ${esc(m?.className)}</title>
<style>
body{font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1b2430;max-width:900px;margin:0 auto;padding:24px 18px 60px}
header{border-bottom:3px solid #1d5fd1;padding-bottom:10px;margin-bottom:18px}header small{color:#5b6878;display:block}
h1{font-size:24px;margin:4px 0}h2{font-size:20px;margin:28px 0 8px;color:#123d8a}h3{font-size:16px;margin:16px 0 4px}h4,h5{margin:12px 0 4px}
table{border-collapse:collapse;width:100%;margin:8px 0;font-size:14px}th,td{border:1px solid #cfd7e2;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f0f3f8}
table.kv th{width:16%}figure{margin:16px 0;text-align:center;break-inside:avoid}figure img{max-width:100%;height:auto;border:1px solid #e3e8ef;border-radius:8px;background:#fff}
figcaption{font-size:13px;color:#5b6878;margin-top:4px}.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.sources{font-size:13px;color:#5b6878}
@media print{body{padding:0}header{border-color:#000}a{color:inherit}}
</style></head><body>
<header><small>${esc(m?.school)} · ${esc(m?.subject)} · ${esc(m?.className)} · ${esc(m?.term)}</small><h1>Lesson ${esc(l.seq)}: ${esc(l.title)}</h1><small>${esc(l.unit)}${l.subtopic ? ` › ${esc(l.subtopic)}` : ""}</small></header>
${plan}
<section><h2>Lesson notes</h2>${notes}${extra}</section>
<section class="sources"><h2>Sources</h2><ul>${(l.citations as Array<{ title: string; pageUrl: string | null; part: number }>).map(c => `<li>${esc(c.title)} (part ${esc(c.part)})${c.pageUrl ? ` — <a href="${esc(c.pageUrl)}">${esc(c.pageUrl)}</a>` : ""}</li>`).join("")}</ul>
<p>Written by Ledgerly AI from the school e-library sources above; review before use.</p></section>
</body></html>`;
}

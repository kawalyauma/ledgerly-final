import { z } from "zod";
import type { Anchor } from "./figures.js";

// Figures drawn by code from a few numbers: always exact, identical every time, free, and cached by their spec.

export const codedSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("shape"), shape: z.enum(["circle", "square", "rectangle", "triangle", "right-triangle", "equilateral-triangle", "isosceles-triangle", "parallelogram", "rhombus", "trapezium", "kite", "pentagon", "hexagon", "octagon"]) }),
  z.object({ type: z.literal("fraction"), shape: z.enum(["circle", "bar"]), numerator: z.number().int().min(0).max(24), denominator: z.number().int().min(1).max(24) }),
  z.object({ type: z.literal("number-line"), from: z.number().min(-1000).max(1000), to: z.number().min(-1000).max(1000), step: z.number().positive().max(1000), marks: z.array(z.number()).max(12).default([]) }),
  z.object({ type: z.literal("clock"), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }),
  z.object({ type: z.literal("bar-chart"), title: z.string().max(120).default(""), yLabel: z.string().max(60).default(""), bars: z.array(z.object({ label: z.string().min(1).max(30), value: z.number().min(0).max(1e9) })).min(1).max(12) }),
]);
export type CodedSpec = z.infer<typeof codedSpecSchema>;

const W = 640, H = 420;
const STROKE = 'stroke="#000" stroke-width="3"';
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Black and white for printing: outlines, white fills, and diagonal hatching for "shaded" parts.
const HATCH = `<defs><pattern id="hatch" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)"><rect width="10" height="10" fill="#fff"/><line x1="0" y1="0" x2="0" y2="10" stroke="#000" stroke-width="2.4"/></pattern></defs>`;
const svgWrap = (body: string, w = W, h = H) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Liberation Sans">${HATCH}<rect width="${w}" height="${h}" fill="#fff"/>${body}</svg>`;
const n = (v: number) => Math.round(v * 10) / 10;
const anchor = (key: string, name: string, x: number, y: number, w = W, h = H): Anchor => ({ key, name, x: n(x) / w, y: n(y) / h });

function polygon(points: Array<[number, number]>, names: string[], fill = "#ffffff") {
  const pts = points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
  const anchors = points.map(([x, y], i) => anchor(`vertex-${i + 1}`, names[i] ?? `Vertex ${i + 1}`, x, y));
  // Side midpoints are anchors too, for "label the sides" questions.
  points.forEach(([x, y], i) => { const [x2, y2] = points[(i + 1) % points.length]!; anchors.push(anchor(`side-${i + 1}`, `Side ${i + 1}`, (x + x2) / 2, (y + y2) / 2)); });
  return { body: `<polygon points="${pts}" fill="${fill}" ${STROKE}/>`, anchors };
}

function regular(sides: number, r = 150, cx = W / 2, cy = H / 2 + 10) {
  return Array.from({ length: sides }, (_, i) => {
    const t = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)] as [number, number];
  });
}

export function codedFigure(spec: CodedSpec): { conceptKey: string; title: string; subject: string; svg: string; width: number; height: number; anchors: Anchor[] } {
  const key = (parts: Array<string | number>) => `coded-line-${parts.join("-")}`.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").slice(0, 160);
  switch (spec.type) {
    case "shape": {
      const vertexNames = (k: number) => Array.from({ length: k }, (_, i) => String.fromCharCode(65 + i));
      let drawn: { body: string; anchors: Anchor[] };
      if (spec.shape === "circle") {
        drawn = {
          body: `<circle cx="320" cy="215" r="160" fill="#ffffff" ${STROKE}/><circle cx="320" cy="215" r="5" fill="#000"/><line x1="320" y1="215" x2="480" y2="215" ${STROKE} stroke-dasharray="8 6"/><line x1="160" y1="215" x2="480" y2="215" stroke="#000" stroke-width="1.5" stroke-dasharray="3 5"/>`,
          anchors: [anchor("centre", "Centre", 320, 215), anchor("radius", "Radius", 420, 215), anchor("diameter", "Diameter", 220, 215), anchor("circumference", "Circumference", 320 + 160 * Math.cos(-0.8), 215 + 160 * Math.sin(-0.8))],
        };
      } else {
        const pts: Record<string, Array<[number, number]>> = {
          square: [[170, 65], [470, 65], [470, 365], [170, 365]],
          rectangle: [[110, 95], [530, 95], [530, 335], [110, 335]],
          triangle: [[230, 70], [520, 350], [110, 350]],
          "right-triangle": [[150, 70], [150, 350], [500, 350]],
          "equilateral-triangle": regular(3, 175),
          "isosceles-triangle": [[320, 60], [470, 360], [170, 360]],
          parallelogram: [[200, 100], [540, 100], [440, 330], [100, 330]],
          rhombus: [[320, 50], [500, 215], [320, 380], [140, 215]],
          trapezium: [[220, 100], [420, 100], [530, 330], [110, 330]],
          kite: [[320, 50], [460, 170], [320, 380], [180, 170]],
          pentagon: regular(5), hexagon: regular(6), octagon: regular(8),
        };
        const points = pts[spec.shape]!;
        drawn = polygon(points, vertexNames(points.length));
        if (spec.shape === "right-triangle") drawn.body += `<polyline points="150,325 175,325 175,350" fill="none" stroke="#000" stroke-width="2.5"/>`;
      }
      return { conceptKey: key(["shape", spec.shape]), title: spec.shape.replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase()), subject: "mathematics", svg: svgWrap(drawn.body), width: W, height: H, anchors: drawn.anchors };
    }
    case "fraction": {
      const { numerator: a, denominator: b } = spec;
      let body = "";
      if (spec.shape === "circle") {
        const cx = 320, cy = 215, r = 170;
        for (let i = 0; i < b; i += 1) {
          const t1 = -Math.PI / 2 + (i * 2 * Math.PI) / b, t2 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / b;
          const large = t2 - t1 > Math.PI ? 1 : 0;
          const d = b === 1 ? `M ${cx - r},${cy} a ${r},${r} 0 1,0 ${2 * r},0 a ${r},${r} 0 1,0 ${-2 * r},0`
            : `M ${cx},${cy} L ${n(cx + r * Math.cos(t1))},${n(cy + r * Math.sin(t1))} A ${r},${r} 0 ${large},1 ${n(cx + r * Math.cos(t2))},${n(cy + r * Math.sin(t2))} Z`;
          body += `<path d="${d}" fill="${i < a ? "url(#hatch)" : "#ffffff"}" ${STROKE}/>`;
        }
      } else {
        const x0 = 60, w = 520 / b;
        for (let i = 0; i < b; i += 1) body += `<rect x="${n(x0 + i * w)}" y="150" width="${n(w)}" height="120" fill="${i < a ? "url(#hatch)" : "#ffffff"}" ${STROKE}/>`;
      }
      return { conceptKey: key(["fraction", spec.shape, a, b]), title: `Fraction ${a}/${b}`, subject: "mathematics", svg: svgWrap(body), width: W, height: H,
        anchors: [anchor("shaded", "Shaded part", spec.shape === "circle" ? 320 + 80 * Math.cos(-Math.PI / 2 + Math.PI / b) : 60 + 260 / b, spec.shape === "circle" ? 215 + 80 * Math.sin(-Math.PI / 2 + Math.PI / b) : 210)] };
    }
    case "number-line": {
      const { from, to, step } = spec;
      const lo = Math.min(from, to), hi = Math.max(from, to);
      const count = Math.min(40, Math.round((hi - lo) / step));
      const x = (v: number) => 50 + ((v - lo) / (hi - lo || 1)) * 540;
      let body = `<line x1="30" y1="210" x2="610" y2="210" ${STROKE}/><path d="M610,210 l-14,-8 v16 z M30,210 l14,-8 v16 z" fill="#000"/>`;
      for (let i = 0; i <= count; i += 1) {
        const v = lo + i * step;
        body += `<line x1="${n(x(v))}" y1="198" x2="${n(x(v))}" y2="222" stroke="#000" stroke-width="2.5"/><text x="${n(x(v))}" y="255" font-size="20" text-anchor="middle">${esc(String(Math.round(v * 1000) / 1000))}</text>`;
      }
      const anchors = spec.marks.map((m, i) => anchor(`mark-${i + 1}`, `Point ${String.fromCharCode(80 + i)}`, x(m), 210));
      for (const m of spec.marks) body += `<circle cx="${n(x(m))}" cy="210" r="8" fill="#000"/>`;
      return { conceptKey: key(["number-line", lo, hi, step, ...spec.marks]), title: `Number line ${lo} to ${hi}`, subject: "mathematics", svg: svgWrap(body), width: W, height: H, anchors };
    }
    case "clock": {
      const cx = 320, cy = 210, r = 175;
      let body = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="#000" stroke-width="5"/>`;
      for (let i = 1; i <= 12; i += 1) {
        const t = -Math.PI / 2 + (i * Math.PI) / 6;
        body += `<text x="${n(cx + (r - 32) * Math.cos(t))}" y="${n(cy + (r - 32) * Math.sin(t) + 9)}" font-size="28" text-anchor="middle">${i}</text>`;
      }
      for (let i = 0; i < 60; i += 1) {
        const t = (i * Math.PI) / 30, l = i % 5 === 0 ? 14 : 6;
        body += `<line x1="${n(cx + (r - 2) * Math.cos(t))}" y1="${n(cy + (r - 2) * Math.sin(t))}" x2="${n(cx + (r - 2 - l) * Math.cos(t))}" y2="${n(cy + (r - 2 - l) * Math.sin(t))}" stroke="#000" stroke-width="${i % 5 === 0 ? 3 : 1.5}"/>`;
      }
      const tm = -Math.PI / 2 + (spec.minute * Math.PI) / 30, th = -Math.PI / 2 + (((spec.hour % 12) + spec.minute / 60) * Math.PI) / 6;
      body += `<line x1="${cx}" y1="${cy}" x2="${n(cx + 100 * Math.cos(th))}" y2="${n(cy + 100 * Math.sin(th))}" stroke="#000" stroke-width="9" stroke-linecap="round"/>`;
      body += `<line x1="${cx}" y1="${cy}" x2="${n(cx + 145 * Math.cos(tm))}" y2="${n(cy + 145 * Math.sin(tm))}" stroke="#000" stroke-width="5" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="8" fill="#000"/>`;
      return { conceptKey: key(["clock", spec.hour % 12, spec.minute]), title: `Clock showing ${spec.hour % 12 || 12}:${String(spec.minute).padStart(2, "0")}`, subject: "mathematics", svg: svgWrap(body), width: W, height: H,
        anchors: [anchor("hour-hand", "Hour hand", cx + 60 * Math.cos(th), cy + 60 * Math.sin(th)), anchor("minute-hand", "Minute hand", cx + 110 * Math.cos(tm), cy + 110 * Math.sin(tm)), anchor("face", "Clock face", cx + r * 0.7, cy + r * 0.7)] };
    }
    case "bar-chart": {
      const max = Math.max(...spec.bars.map(b => b.value), 1);
      const top = spec.title ? 50 : 20, base = 360, left = 80, width = 530;
      const bw = width / spec.bars.length;
      let body = spec.title ? `<text x="${W / 2}" y="32" font-size="22" font-weight="bold" text-anchor="middle">${esc(spec.title)}</text>` : "";
      body += `<line x1="${left}" y1="${top}" x2="${left}" y2="${base}" ${STROKE}/><line x1="${left}" y1="${base}" x2="${left + width}" y2="${base}" ${STROKE}/>`;
      const ticks = 5;
      for (let i = 0; i <= ticks; i += 1) {
        const v = (max * i) / ticks, y = base - ((base - top - 10) * i) / ticks;
        body += `<line x1="${left - 6}" y1="${n(y)}" x2="${left}" y2="${n(y)}" stroke="#000" stroke-width="2"/><text x="${left - 10}" y="${n(y + 6)}" font-size="15" text-anchor="end">${esc(String(Math.round(v * 100) / 100))}</text>`;
      }
      const anchors: Anchor[] = [];
      spec.bars.forEach((b, i) => {
        const h = ((base - top - 10) * b.value) / max, x = left + i * bw + bw * 0.15;
        body += `<rect x="${n(x)}" y="${n(base - h)}" width="${n(bw * 0.7)}" height="${n(h)}" fill="url(#hatch)" stroke="#000" stroke-width="2"/><text x="${n(x + bw * 0.35)}" y="${base + 24}" font-size="16" text-anchor="middle">${esc(b.label)}</text>`;
        anchors.push(anchor(`bar-${i + 1}`, b.label, x + bw * 0.35, base - h / 2));
      });
      if (spec.yLabel) body += `<text x="22" y="${(top + base) / 2}" font-size="16" text-anchor="middle" transform="rotate(-90 22 ${(top + base) / 2})">${esc(spec.yLabel)}</text>`;
      return { conceptKey: key(["bar-chart", spec.title, ...spec.bars.flatMap(b => [b.label, b.value])]), title: spec.title || "Bar graph", subject: "mathematics", svg: svgWrap(body), width: W, height: H, anchors };
    }
  }
}

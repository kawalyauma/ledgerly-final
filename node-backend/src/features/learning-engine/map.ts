import type { Anchor } from "./figures.js";
import { UGANDA_MAP } from "./data/uganda-map.js";

// Code-drawn map of Uganda for SST: black and white for printing, real coordinates, every feature an anchor so
// the same map serves notes (names), exams (letters A, B, C) and "label the map" (blank boxes).

export const MAP_LAYERS = ["regions", "lakes", "rivers", "neighbours", "towns", "mountains", "equator"] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

const TOWNS: Array<[string, number, number]> = [
  ["Kampala", 32.5825, 0.3476], ["Entebbe", 32.4637, 0.0512], ["Jinja", 33.2026, 0.4479], ["Gulu", 32.2881, 2.7724], ["Mbarara", 30.6545, -0.6072],
  ["Mbale", 34.175, 1.0827], ["Lira", 32.8999, 2.2499], ["Arua", 30.9111, 3.0201], ["Fort Portal", 30.275, 0.671], ["Masaka", 31.7341, -0.3338],
  ["Soroti", 33.6111, 1.7146], ["Kabale", 29.9899, -1.2486], ["Hoima", 31.3524, 1.4331], ["Moroto", 34.6666, 2.5345], ["Kasese", 30.0833, 0.1833], ["Tororo", 34.1809, 0.6929],
];
const MOUNTAINS: Array<[string, number, number]> = [
  ["Mount Elgon", 34.55, 1.134], ["Mount Rwenzori", 29.872, 0.386], ["Mount Moroto", 34.77, 2.53], ["Mount Kadam", 34.72, 1.78], ["Mount Muhavura", 29.677, -1.381],
];

const NEIGHBOUR_POINTS: Record<string, [number, number]> = {
  Kenya: [35.3, 0.4], Tanzania: [31.6, -1.6], Rwanda: [29.95, -1.75], "DR Congo": [29.45, 1.6], "South Sudan": [31.6, 4.25],
};

const BOX = { w: 29.0, e: 35.6, s: -1.9, n: 4.6 };
const W = 900, H = Math.round(((BOX.n - BOX.s) / (BOX.e - BOX.w)) * W);
const px = (lon: number) => ((lon - BOX.w) / (BOX.e - BOX.w)) * W;
const py = (lat: number) => ((BOX.n - lat) / (BOX.n - BOX.s)) * H;
const path = (rings: number[][][], close = true) => rings.map(r => "M" + r.map(([x, y]) => `${px(x!).toFixed(1)},${py(y!).toFixed(1)}`).join("L") + (close ? "Z" : "")).join("");
const inside = (x: number, y: number) => x > 30 && x < W - 30 && y > 30 && y < H - 30;

/** Visual centre of a set of rings, using only points inside the map frame. */
function centre(rings: number[][][]) {
  const pts = rings.flat().map(([x, y]) => [px(x!), py(y!)] as [number, number]).filter(([x, y]) => inside(x, y));
  if (!pts.length) return null;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length] as [number, number];
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function ugandaMap(layers: MapLayer[], highlight: string[] = []) {
  const want = new Set(layers);
  const hi = new Set(highlight.map(h => h.toLowerCase()));
  const anchors: Anchor[] = [];
  const add = (key: string, name: string, x: number, y: number) => { if (inside(x, y)) anchors.push({ key, name, x: x / W, y: y / H }); };
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Liberation Sans">`,
    `<defs><pattern id="water" patternUnits="userSpaceOnUse" width="12" height="7"><rect width="12" height="7" fill="#fff"/><line x1="0" y1="3.5" x2="8" y2="3.5" stroke="#000" stroke-width="1.1"/></pattern>`,
    `<pattern id="hi" patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(45)"><rect width="9" height="9" fill="#fff"/><line x1="0" y1="0" x2="0" y2="9" stroke="#000" stroke-width="1.6"/></pattern>`,
    `<clipPath id="frame"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>`,
    `<rect width="${W}" height="${H}" fill="#fff"/><g clip-path="url(#frame)">`,
  ];
  if (want.has("neighbours")) for (const c of UGANDA_MAP.neighbours) {
    parts.push(`<path d="${path(c.rings)}" fill="#f2f2f2" stroke="#000" stroke-width="1.2"/>`);
    // Fixed label points inside each neighbour (a centre of the visible part can fall on the shared border).
    const at = NEIGHBOUR_POINTS[c.name];
    if (at) add(`country-${c.name.toLowerCase().replace(/\W+/g, "-")}`, c.name, px(at[0]), py(at[1]));
  }
  parts.push(`<path d="${path(UGANDA_MAP.uganda)}" fill="#fff" stroke="#000" stroke-width="3.2"/>`);
  if (want.has("regions")) for (const r of UGANDA_MAP.regions) {
    const isHi = hi.has(r.name.toLowerCase());
    parts.push(`<path d="${path(r.rings)}" fill="${isHi ? "url(#hi)" : "none"}" stroke="#000" stroke-width="1.4" stroke-dasharray="7 5"/>`);
    const ce = centre(r.rings); if (ce) add(`region-${r.name.toLowerCase()}`, `${r.name} Region`, ce[0], ce[1]);
  }
  if (want.has("lakes")) for (const l of UGANDA_MAP.lakes) {
    parts.push(`<path d="${path(l.rings)}" fill="url(#water)" stroke="#000" stroke-width="1.6"/>`);
    const ce = centre(l.rings); if (ce) add(`lake-${l.name.toLowerCase().replace(/\W+/g, "-")}`, l.name, ce[0], ce[1]);
  }
  if (want.has("rivers")) for (const r of UGANDA_MAP.rivers) {
    parts.push(`<path d="${path(r.lines, false)}" fill="none" stroke="#000" stroke-width="2"/>`);
    const longest = [...r.lines].sort((a, b) => b.length - a.length)[0];
    const mid = longest?.[Math.floor(longest.length / 2)];
    const label = r.name ? `River ${r.name.replace(/^River\s+/i, "")}` : null;
    if (label && mid && !anchors.some(a => a.name === label)) add(`river-${r.name!.toLowerCase().replace(/\W+/g, "-")}`, label, px(mid[0]!), py(mid[1]!));
  }
  if (want.has("equator")) {
    parts.push(`<line x1="0" y1="${py(0).toFixed(1)}" x2="${W}" y2="${py(0).toFixed(1)}" stroke="#000" stroke-width="1.4" stroke-dasharray="14 6 3 6"/>`);
    add("equator", "Equator", px(29.6), py(0));
  }
  if (want.has("mountains")) for (const [name, lon, lat] of MOUNTAINS) {
    const x = px(lon), y = py(lat);
    parts.push(`<path d="M${(x - 9).toFixed(1)},${(y + 7).toFixed(1)} L${x.toFixed(1)},${(y - 9).toFixed(1)} L${(x + 9).toFixed(1)},${(y + 7).toFixed(1)} Z" fill="#000"/>`);
    add(`mountain-${name.toLowerCase().replace(/\W+/g, "-")}`, name, x, y);
  }
  if (want.has("towns")) for (const [name, lon, lat] of TOWNS) {
    const x = px(lon), y = py(lat);
    parts.push(name === "Kampala" ? `<rect x="${(x - 6).toFixed(1)}" y="${(y - 6).toFixed(1)}" width="12" height="12" fill="#000"/>` : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="#000"/>`);
    add(`town-${name.toLowerCase().replace(/\W+/g, "-")}`, name, x, y);
  }
  parts.push(`</g><g transform="translate(${W - 60},70)"><path d="M0,-38 L11,0 L0,-8 L-11,0 Z" fill="#000"/><text x="0" y="22" font-size="22" font-weight="bold" text-anchor="middle">N</text></g>`);
  parts.push("</svg>");
  return { svg: parts.join(""), width: W, height: H, anchors, title: `Map of Uganda${highlight.length ? ` (${highlight.map(esc).join(", ")})` : ""}` };
}

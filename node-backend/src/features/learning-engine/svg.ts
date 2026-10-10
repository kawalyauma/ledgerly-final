// Rebuilds AI-drawn SVG diagrams from a strict allow-list, so a diagram can never carry scripts,
// event handlers, external images, links or CSS that loads anything. Unknown elements are dropped
// together with their content; unknown attributes are dropped.

const ELEMENTS = new Set([
  "svg", "g", "defs", "title", "desc", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "marker", "lineargradient", "radialgradient", "stop", "pattern", "clippath", "symbol", "use",
]);
const CANONICAL: Record<string, string> = { lineargradient: "linearGradient", radialgradient: "radialGradient", clippath: "clipPath" };
const ATTRIBUTES = new Set([
  "viewbox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "dx", "dy",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
  "opacity", "transform", "font-size", "font-weight", "font-family", "font-style", "text-anchor", "dominant-baseline", "letter-spacing",
  "id", "class", "offset", "stop-color", "stop-opacity", "marker-end", "marker-start", "marker-mid", "markerwidth", "markerheight",
  "refx", "refy", "orient", "markerunits", "preserveaspectratio", "gradientunits", "patternunits", "clip-path", "href", "xmlns", "rotate",
]);
const CAMEL: Record<string, string> = {
  viewbox: "viewBox", markerwidth: "markerWidth", markerheight: "markerHeight", refx: "refX", refy: "refY", markerunits: "markerUnits",
  preserveaspectratio: "preserveAspectRatio", gradientunits: "gradientUnits", patternunits: "patternUnits",
};

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decode = (v: string) => v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

function safeValue(name: string, raw: string): string | null {
  const value = decode(raw).trim();
  if (/[<>]|javascript:|data:|expression\s*\(|@import/i.test(value)) return null;
  // url(...) may only point at an element inside the same diagram, e.g. marker-end="url(#arrow)".
  if (/url\s*\(/i.test(value) && !/^url\(\s*#[\w-]+\s*\)$/i.test(value)) return null;
  if (name === "href" && !/^#[\w-]+$/.test(value)) return null;
  return value.slice(0, 20000);
}

/** Returns a clean, self-contained SVG string, or null when nothing usable remains. */
export function sanitizeSvg(input: string, maxBytes = 80_000): string | null {
  const src = input.replace(/<\?xml[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/gi, "");
  const start = src.search(/<svg[\s>]/i);
  if (start < 0) return null;
  const out: string[] = [];
  const stack: Array<{ name: string; kept: boolean }> = [];
  let skipDepth = 0;
  const token = /<\/?([a-zA-Z][\w:-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)/g;
  token.lastIndex = start;
  let m: RegExpExecArray | null;
  let sawRoot = false;
  while ((m = token.exec(src))) {
    const [full, rawName, attrs = "", selfClose, text] = m;
    if (text !== undefined) {
      if (!skipDepth && stack.length && /^(text|tspan|title|desc)$/.test(stack.at(-1)!.name)) out.push(esc(decode(text)));
      continue;
    }
    const name = rawName!.toLowerCase().replace(/^svg:/, "");
    const closing = full.startsWith("</");
    if (closing) {
      const top = stack.pop();
      if (!top) break;
      if (!top.kept) skipDepth = Math.max(0, skipDepth - 1);
      else if (!skipDepth) out.push(`</${CANONICAL[top.name] ?? top.name}>`);
      if (!stack.length) break;
      continue;
    }
    const allowed = ELEMENTS.has(name) && (sawRoot || name === "svg");
    if (name === "svg") sawRoot = true;
    if (!allowed || skipDepth) {
      if (!selfClose) { stack.push({ name, kept: false }); skipDepth += 1; }
      continue;
    }
    const kept: string[] = [];
    for (const a of attrs.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
      let attr = a[1]!.toLowerCase();
      if (attr === "xlink:href") attr = "href";
      if (!ATTRIBUTES.has(attr) || attr.startsWith("on")) continue;
      const value = safeValue(attr, a[2] ?? a[3] ?? a[4] ?? "");
      if (value === null) continue;
      if (attr === "xmlns") continue;
      kept.push(`${CAMEL[attr] ?? attr}="${esc(value)}"`);
    }
    if (name === "svg" && !stack.length) {
      kept.unshift('xmlns="http://www.w3.org/2000/svg"');
      if (!kept.some(k => k.startsWith("font-family="))) kept.push('font-family="Arial, Helvetica, sans-serif"');
    }
    const tag = CANONICAL[name] ?? name;
    if (selfClose) out.push(`<${tag}${kept.length ? " " + kept.join(" ") : ""}/>`);
    else { out.push(`<${tag}${kept.length ? " " + kept.join(" ") : ""}>`); stack.push({ name, kept: true }); }
  }
  while (stack.length) { const top = stack.pop()!; if (top.kept && !skipDepth) out.push(`</${CANONICAL[top.name] ?? top.name}>`); else if (!top.kept) skipDepth = Math.max(0, skipDepth - 1); }
  const svg = out.join("");
  if (!/^<svg[\s>]/.test(svg) || !/viewBox=/.test(svg) || Buffer.byteLength(svg) > maxBytes) return null;
  if (!/<(path|rect|circle|ellipse|line|polyline|polygon|text)\b/.test(svg)) return null;
  return svg;
}

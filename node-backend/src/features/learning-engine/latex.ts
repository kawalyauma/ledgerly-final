import katex from "katex";

// Lesson notes write maths in LaTeX ($…$ inline, $$…$$ on its own line). Print renders it as MathML (native in
// browsers, no fonts or CSS to ship); Word exports and the app get a readable plain-text form.

const MATH = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;

/** Splits text into plain parts and maths parts. A lone "$" in money ("shs 500$") is left as text. */
export function splitMath(text: string): Array<{ math: boolean; display: boolean; text: string }> {
  const out: Array<{ math: boolean; display: boolean; text: string }> = [];
  let last = 0;
  for (const m of text.matchAll(MATH)) {
    if (m.index! > last) out.push({ math: false, display: false, text: text.slice(last, m.index) });
    out.push({ math: true, display: Boolean(m[1]), text: (m[1] ?? m[2] ?? "").trim() });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ math: false, display: false, text: text.slice(last) });
  return out;
}

export const hasMath = (text: string) => /\$[^$\n]+\$/.test(text);

/** LaTeX → MathML string (safe: KaTeX escapes everything and allows no HTML or links). */
export function latexToMathml(tex: string, display = false) {
  return katex.renderToString(tex, { output: "mathml", displayMode: display, throwOnError: false, trust: false, strict: "ignore" });
}

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", n: "ⁿ" };
const SYMBOLS: Array<[RegExp, string]> = [
  [/\\times/g, "×"], [/\\div/g, "÷"], [/\\cdot/g, "·"], [/\\pm/g, "±"], [/\\leq?/g, "≤"], [/\\geq?/g, "≥"], [/\\neq/g, "≠"], [/\\approx/g, "≈"],
  [/\\degree|\^\{?\\circ\}?/g, "°"], [/\\pi/g, "π"], [/\\%/g, "%"], [/\\,|\\;|\\!|\\quad|\\qquad/g, " "], [/\\left|\\right/g, ""],
  [/\\text\{([^}]*)\}|\\mathrm\{([^}]*)\}/g, "$1$2"],
];

/** LaTeX → readable text for Word and the phone app: \frac{3}{4} → 3/4, x^{2} → x², \times → ×. */
export function latexToText(tex: string) {
  let t = tex;
  for (let i = 0; i < 4 && /\\frac/.test(t); i += 1) t = t.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_m, a: string, b: string) => `${/^\w+$/.test(a) ? a : `(${a})`}/${/^\w+$/.test(b) ? b : `(${b})`}`);
  t = t.replace(/\\sqrt\{([^{}]*)\}/g, "√($1)");
  for (const [re, to] of SYMBOLS) t = t.replace(re, to);
  t = t.replace(/\^\{([^{}]*)\}|\^(\S)/g, (_m, a: string | undefined, b: string | undefined) => {
    const s = a ?? b ?? "";
    return [...s].every(c => SUP[c]) ? [...s].map(c => SUP[c]).join("") : `^(${s})`;
  });
  return t.replace(/[{}]/g, "").replace(/\\([a-zA-Z]+)/g, "$1").replace(/\s+/g, " ").trim();
}

/** Replaces every $…$ in a line with its plain-text form. */
export const mathToText = (text: string) => splitMath(text).map(p => (p.math ? latexToText(p.text) : p.text)).join("");

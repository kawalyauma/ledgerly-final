// Deterministic question normalisation and grouping. "1 + 2" and "2 + 4" share the group "math:N+N:d1"
// (addition of two 1-digit numbers) while "23 + 45" lands in "math:N+N:d2". Non-numeric questions are grouped
// by the concept and skill the AI tags them with, which in turn come from the scheme the question belongs to.

const NUMBERING = /^\s*(?:q(?:uestion)?\.?\s*)?(?:\(?\d{1,3}[.)]|\(?[a-h][.)]|\([ivx]{1,4}\)|[ivx]{1,4}[.)])\s+/i;

export function normalizeStem(stem: string): string {
  return stem
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(NUMBERING, "")
    .replace(/[×✕✖]/g, "*").replace(/[÷]/g, "/").replace(/[−–—]/g, "-")
    .replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1*")
    .replace(/_{2,}|\.{3,}|…/g, "__")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\s*([+\-*/=()])\s*/g, "$1")
    .replace(/[\s.?!:;,]+$/, "")
    .trim();
}

const MATH_WORDS: Array<[RegExp, string]> = [
  [/\bdivided by\b/g, "/"], [/\btake away\b/g, "-"], [/\bplus\b/g, "+"], [/\bminus\b/g, "-"], [/\btimes\b/g, "*"],
];
const PREFIX_FORMS: Array<[RegExp, (a: string, b: string) => string]> = [
  [/^(?:the )?sum of (\S+) and (\S+)$/, (a, b) => `${a}+${b}`],
  [/^add (\S+) (?:and|to) (\S+)$/, (a, b) => `${a}+${b}`],
  [/^subtract (\S+) from (\S+)$/, (a, b) => `${b}-${a}`],
  [/^(?:the )?difference between (\S+) and (\S+)$/, (a, b) => `${a}-${b}`],
  [/^multiply (\S+) by (\S+)$/, (a, b) => `${a}*${b}`],
  [/^(?:the )?product of (\S+) and (\S+)$/, (a, b) => `${a}*${b}`],
  [/^divide (\S+) by (\S+)$/, (a, b) => `${a}/${b}`],
  [/^share (\S+) (?:among|between) (\S+)$/, (a, b) => `${a}/${b}`],
];

/** Operator skeleton of a numeric question, or null when it is not a pure computation. */
export function mathSkeleton(normalized: string): { skeleton: string; digits: number; operands: number } | null {
  let s = normalized.replace(/^(work out|calculate|find|simplify|solve|evaluate|what is)\b:?/, "").trim();
  for (const [pattern, build] of PREFIX_FORMS) {
    const m = pattern.exec(s);
    if (m && /^\d/.test(m[1]!) && /^\d/.test(m[2]!)) { s = build(m[1]!, m[2]!); break; }
  }
  for (const [pattern, op] of MATH_WORDS) s = s.replace(pattern, op);
  s = s.replace(/\s+/g, "");
  if (!/\d/.test(s) || !/^[\d.+\-*/=()_,]+$/.test(s)) return null;
  const numbers = s.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.length < 2 && !s.includes("__")) return null;
  const skeleton = s.replace(/\d+\.\d+/g, "D").replace(/\d+/g, "N").replace(/_+/g, "_").replace(/=_?$/, "");
  const digits = Math.max(...numbers.map(n => n.replace(/\..*$/, "").length));
  return { skeleton, digits, operands: numbers.length };
}

const slug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

const OP_NAMES: Record<string, string> = { "+": "Addition", "-": "Subtraction", "*": "Multiplication", "/": "Division" };

export function groupFor(input: { stem: string; concept?: string | null; skill?: string | null }) {
  const normalized = normalizeStem(input.stem);
  const math = mathSkeleton(normalized);
  if (math) {
    const ops = [...new Set(math.skeleton.replace(/[^+\-*/]/g, ""))];
    const name = ops.length === 1 ? OP_NAMES[ops[0]!] : "Mixed operations";
    const blank = math.skeleton.includes("_") ? " (missing number)" : "";
    return {
      normalized,
      signature: math.skeleton,
      groupKey: `math:${math.skeleton}:d${math.digits}`,
      label: `${name} of ${math.digits}-digit numbers${blank}`,
      kind: "computation" as const,
      difficulty: Math.min(5, Math.max(1, math.digits + (ops.length > 1 ? 1 : 0) + (math.operands > 2 ? 1 : 0))),
    };
  }
  const concept = input.concept?.trim() || "general";
  const skill = input.skill?.trim() || "recall";
  return {
    normalized,
    signature: normalized.replace(/\d+(?:\.\d+)?/g, "N").slice(0, 200),
    groupKey: `concept:${slug(concept)}:${slug(skill)}`,
    label: `${concept} · ${skill}`.slice(0, 200),
    kind: null,
    difficulty: null,
  };
}

/** Safely evaluates + - * / and brackets, so computation answers can be checked without trusting the AI. */
export function evaluateArithmetic(expression: string): number | null {
  const src = expression.replace(/=.*$/, "").replace(/\s+/g, "");
  if (!/^[\d.+\-*/()]+$/.test(src)) return null;
  let i = 0;
  const peek = () => src[i];
  const number = (): number => {
    if (peek() === "(") { i++; const v = sum(); if (src[i++] !== ")") throw new Error("bracket"); return v; }
    if (peek() === "-") { i++; return -number(); }
    const m = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (!m) throw new Error("number");
    i += m[0].length;
    return Number(m[0]);
  };
  const product = (): number => {
    let v = number();
    while (peek() === "*" || peek() === "/") { const op = src[i++]; const r = number(); v = op === "*" ? v * r : v / r; }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") { const op = src[i++]; const r = product(); v = op === "+" ? v + r : v - r; }
    return v;
  };
  try {
    const v = sum();
    return i === src.length && Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null;
  } catch {
    return null;
  }
}

/** True when the quoted text really appears in the source passage (ignoring case, spacing and punctuation). */
export function quoteAppearsIn(quote: string | null | undefined, passage: string): boolean {
  if (!quote) return false;
  const squash = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
  const q = squash(quote);
  return q.length >= 6 && squash(passage).includes(q);
}

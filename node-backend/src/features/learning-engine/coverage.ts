/**
 * NCDC coverage: the topics the official curriculum sets for a class and term, and a check that a scheme outline
 * covers every one of them with a fair share of the term.
 */

export type RequiredTopic = { no: number; title: string; weight: number };

const STOP = new Set(["the", "and", "of", "in", "a", "an", "to", "our", "its", "their", "as", "on", "for", "with", "uganda"]);
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(w => !STOP.has(w)).map(w => w.replace(/(ies|es|s)$/, "")));

/**
 * Topic headings ("TOPIC 11: The Government of Uganda", "Theme 9: Our Transport") in a term's curriculum text, in order.
 * Each topic's weight is its share of the text, a fair proxy for the periods the curriculum gives it.
 * Numbers repeat when a book has several learning areas (e.g. RE themes after the main themes): the first one wins.
 */
export function topicsInCurriculum(text: string): RequiredTopic[] {
  const found: Array<{ no: number; title: string; at: number }> = [];
  const re = /(?:^|\n)[ |]*(TOPIC|Topic|THEME|Theme)\s+(\d{1,2})\s*[:.\-–]\s*\|?\s*([^\n|]{3,90})/g;
  for (const m of text.matchAll(re)) {
    const no = Number(m[2]);
    const title = m[3]!.replace(/\.{3,}.*$/, "").replace(/\s+\d+\s*periods?.*$/i, "").trim();
    if (!title || /^\d+$/.test(title) || found.some(f => f.no === no)) continue;
    found.push({ no, title, at: m.index ?? 0 });
  }
  // Keep the main run of topics: ascending numbers (a later restart at 1 is another learning area).
  const run: typeof found = [];
  for (const f of found) if (!run.length || f.no > run[run.length - 1]!.no) run.push(f); else break;
  const sizes = run.map((f, i) => (run[i + 1]?.at ?? text.length) - f.at);
  // The last topic runs to the end of the text, which may hold appendices or another learning area. Smooth
  // (rather than flatten) the section sizes: a genuinely broad topic must receive more lessons, while a bad OCR
  // boundary must not consume the whole term.
  const median = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)] ?? 1;
  const others = sizes.slice(0, -1).sort((a, b) => a - b);
  const lastCap = others.length ? others[Math.floor(others.length / 2)]! * 1.5 : Infinity;
  const evidence = sizes.map((n, i) => Math.min(i === sizes.length - 1 ? lastCap : Infinity, Math.max(median * 0.2, n)));
  const smoothed = evidence.map(n => Math.min(3.5, Math.max(0.45, Math.sqrt(n / Math.max(1, median)))));
  const total = smoothed.reduce((n, x) => n + x, 0) || 1;
  return run.map((f, i) => ({ no: f.no, title: f.title, weight: smoothed[i]! / total }));
}

/** Lessons each topic should get out of the term's teaching slots (at least one each). */
export function topicShares(topics: RequiredTopic[], slots: number): number[] {
  if (!topics.length) return [];
  const sum = topics.reduce((n, t) => n + t.weight, 0);
  const minimum = slots >= topics.length * 2 ? 2 : 1;
  const raw = topics.map(t => Math.max(minimum, Math.round((t.weight / sum) * slots)));
  // Bring the total back to the slot count, taking from (or giving to) the largest shares.
  let diff = raw.reduce((n, x) => n + x, 0) - slots;
  while (diff !== 0) {
    const order = raw.map((x, i) => i).sort((a, b) => diff > 0 ? raw[b]! - raw[a]! : raw[a]! - raw[b]!);
    const i = order[0]!;
    if (diff > 0 && raw[i]! <= minimum) break;
    raw[i]! += diff > 0 ? -1 : 1;
    diff += diff > 0 ? -1 : 1;
  }
  return raw;
}

/** Which required topic a unit belongs to: same topic number named in it, or most shared words with its title/theme. */
export function matchTopic(unit: { title: string; theme?: string | null }, topics: RequiredTopic[]): number {
  const text = `${unit.title} ${unit.theme ?? ""}`;
  const named = /\b(?:topic|theme)\s*(\d{1,2})\b/i.exec(text);
  if (named) { const i = topics.findIndex(t => t.no === Number(named[1])); if (i >= 0) return i; }
  const uw = words(text);
  let best = -1, bestScore = 0;
  topics.forEach((t, i) => {
    const tw = words(t.title);
    if (!tw.size) return;
    // Shared key words, ties going to the topic whose title is more fully named.
    const shared = [...tw].filter(w => uw.has(w)).length;
    const score = shared + shared / tw.size / 10;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return bestScore >= 1 ? best : -1;
}

/**
 * Problems with an outline against the required topics: topics with no unit, and topics given far fewer lessons than
 * their share while others take far more. Empty when the outline is acceptable.
 */
export function coverageProblems(units: Array<{ title: string; theme?: string | null; lessons: unknown[] }>, topics: RequiredTopic[], slots: number): string[] {
  if (!topics.length) return [];
  const shares = topicShares(topics, slots);
  const got = topics.map(() => 0);
  for (const u of units) { const i = matchTopic(u, topics); if (i >= 0) got[i]! += u.lessons.length; }
  const total = Math.max(1, got.reduce((n, x) => n + x, 0));
  const problems: string[] = [];
  topics.forEach((t, i) => {
    // Compare against the share of the lessons actually given, so a short outline is not punished twice.
    const want = Math.max(1, Math.round(shares[i]! * Math.min(1, total / slots)));
    if (!got[i]) problems.push(`NCDC topic ${t.no} "${t.title}" has no unit`);
    else if (got[i]! < Math.max(1, Math.floor(want * 0.5))) problems.push(`NCDC topic ${t.no} "${t.title}" has only ${got[i]} lessons; it needs about ${want}`);
  });
  return problems;
}

/**
 * Fits the outline's lessons into the term's slots without losing whole topics: when there are too many, each unit
 * keeps its fair share (practice lessons go first), instead of the last units being cut off.
 */
export function fitToSlots<T extends { kind: string }>(units: T[][], slots: number): T[][] {
  const total = units.reduce((n, u) => n + u.length, 0);
  if (total <= slots) return units;
  const keep = units.map(u => Math.max(Math.min(u.length, 1), Math.floor((u.length / total) * slots)));
  let spare = slots - keep.reduce((n, x) => n + x, 0);
  for (let i = 0; spare > 0 && i < units.length * 4; i += 1) {
    const j = i % units.length;
    if (keep[j]! < units[j]!.length) { keep[j]! += 1; spare -= 1; }
  }
  return units.map((u, i) => {
    let drop = u.length - keep[i]!;
    // Drop practice lessons from the end first, then teaching lessons from the end.
    const out = [...u];
    for (let k = out.length - 1; drop > 0 && k >= 0; k -= 1) if (out[k]!.kind === "practice") { out.splice(k, 1); drop -= 1; }
    while (drop > 0) { out.pop(); drop -= 1; }
    return out;
  });
}

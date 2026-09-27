import { useEffect, useState } from "react";

// Hash routes are "<route>[/<sub-view>[/<sub-sub-view>]]". The first segment picks the
// module route; the rest is the in-module view, which lets the single global sidebar
// deep-link into module workspaces instead of each workspace drawing its own sidebar.
export const currentHashPath = () => decodeURIComponent(location.hash.replace(/^#\/?/, ""));
export const routeKeyOf = (path: string) => path.split("/")[0] || "";

export function navigateTo(path: string) {
  const next = path.replace(/^#\/?/, "");
  if (currentHashPath() !== next) location.hash = next;
}

function segmentsAfter(base: string) {
  const parts = currentHashPath().split("/").filter(Boolean);
  return parts[0] === base ? parts.slice(1) : [];
}

/** Current sub-path segments under `base` (e.g. "school/fees/billing" → ["fees","billing"]). */
export function useHashSegments(base: string) {
  const [segments, setSegments] = useState(() => segmentsAfter(base));
  useEffect(() => {
    const sync = () => setSegments(segmentsAfter(base));
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, [base]);
  const go = (...next: Array<string | undefined>) => navigateTo([base, ...next.filter(Boolean)].join("/"));
  return [segments, go] as const;
}

/** One-level in-module view backed by the URL hash. Unknown values fall back to `fallback`. */
export function useHashView<T extends string>(base: string, fallback: T, allowed?: readonly string[]) {
  const [segments, go] = useHashSegments(base);
  const raw = segments[0] as T | undefined;
  const view = raw && (!allowed || allowed.includes(raw)) ? raw : fallback;
  return [view, (next: T) => go(next === fallback ? undefined : next)] as const;
}

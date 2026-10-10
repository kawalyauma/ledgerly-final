import { AppError } from "../../http/errors.js";
import type { Runtime } from "../../runtime.js";

type R = Record<string, any>;

/** Minimal client for the ULibTech (notesug.com) public library API. */
export class UlibtechClient {
  private taxonomyCache: { at: number; data: R } | null = null;

  constructor(private readonly runtime: Runtime) {}

  get baseUrl() { return this.runtime.config.ULIBTECH_API_URL.replace(/\/+$/, ""); }
  get textEnabled() { return Boolean(this.runtime.config.ULIBTECH_INTEGRATION_KEY); }

  /** Absolute links so the browser and AI can open, preview and download resources directly from ULibTech. */
  links(slug: string) {
    const s = encodeURIComponent(slug);
    return { pageUrl: `${this.baseUrl}/resources/${s}`, downloadUrl: `${this.baseUrl}/api/download/${s}`, previewUrl: `${this.baseUrl}/api/files/${s}/preview` };
  }

  private async request<T>(path: string, init: { integration?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "Ledgerly-ELibrary/1.0" };
    if (init.integration) {
      if (!this.runtime.config.ULIBTECH_INTEGRATION_KEY) throw new AppError(503, "ELIBRARY_TEXT_DISABLED", "Full-text access to the e-library is not configured");
      headers["X-Integration-Key"] = this.runtime.config.ULIBTECH_INTEGRATION_KEY;
    }
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, { headers, signal: AbortSignal.timeout(this.runtime.config.ULIBTECH_TIMEOUT_MS) });
    } catch {
      throw new AppError(502, "ELIBRARY_UNREACHABLE", "The e-library (ULibTech) could not be reached. Try again shortly.");
    }
    if (response.status === 404 || response.status === 410) throw new AppError(404, "ELIBRARY_RESOURCE_NOT_FOUND", "That e-library resource is no longer available");
    if (!response.ok) throw new AppError(502, "ELIBRARY_ERROR", `The e-library returned an error (${response.status})`);
    return response.json() as Promise<T>;
  }

  /** Normalises a ULibTech resource card to the shape Ledgerly's UI and AI tools use. */
  card(item: R) {
    const thumb = item.thumbnail?.variants?.find((v: R) => v.format === "webp" && v.width <= 480) ?? item.thumbnail?.variants?.[0];
    return {
      slug: item.slug,
      title: item.title,
      description: item.shortDescription ?? item.description ?? null,
      type: item.resourceType?.name ?? null,
      typeSlug: item.resourceType?.slug ?? null,
      className: item.class?.name ?? null,
      classSlug: item.class?.slug ?? null,
      level: item.class?.level?.name ?? null,
      subject: item.subject?.name ?? null,
      subjectSlug: item.subject?.slug ?? null,
      term: item.term?.name ?? null,
      year: item.academicYear?.year ?? item.academicYear?.name ?? null,
      fileType: item.file?.label ?? null,
      pageCount: item.file?.pageCount ?? null,
      sizeBytes: item.file?.sizeBytes ?? null,
      thumbnailUrl: thumb?.url ? (thumb.url.startsWith("http") ? thumb.url : `${this.baseUrl}${thumb.url}`) : null,
      downloads: item.downloadCount ?? 0,
      ...this.links(item.slug),
    };
  }

  async taxonomy() {
    if (this.taxonomyCache && Date.now() - this.taxonomyCache.at < 10 * 60_000) return this.taxonomyCache.data;
    const raw = await this.request<R>("/api/taxonomy");
    const data = {
      levels: (raw.levels ?? []).map((level: R) => ({ slug: level.slug, name: level.name, classes: (level.classes ?? []).map((c: R) => ({ slug: c.slug, name: c.name })) })),
      subjects: (raw.subjects ?? []).map((s: R) => ({ slug: s.slug, name: s.name, count: s.count ?? null })),
      types: (raw.types ?? []).filter((t: R) => (t.count ?? 1) > 0).map((t: R) => ({ slug: t.slug, name: t.name, count: t.count ?? null })),
      terms: (raw.terms ?? []).map((t: R) => ({ slug: t.slug, name: t.name })),
    };
    this.taxonomyCache = { at: Date.now(), data };
    return data;
  }

  async search(input: { q?: string; class?: string; subject?: string; type?: string; term?: string; level?: string; page?: number; pageSize?: number }) {
    const params = new URLSearchParams();
    for (const key of ["class", "subject", "type", "term", "level"] as const) if (input[key]) params.set(key, input[key]!);
    params.set("page", String(input.page ?? 1));
    params.set("pageSize", String(Math.min(48, Math.max(1, input.pageSize ?? 24))));
    const q = input.q?.trim();
    if (q) params.set("q", q.slice(0, 200));
    const raw = await this.request<R>(`${q ? "/api/search" : "/api/resources"}?${params}`);
    return {
      items: ((raw.items ?? []) as R[]).map(item => this.card(item)),
      page: raw.page ?? 1,
      totalPages: raw.totalPages ?? 1,
      total: raw.total ?? 0,
      didYouMean: raw.didYouMean ?? null,
    };
  }

  async resource(slug: string) {
    let raw = await this.request<R>(`/api/resources/${encodeURIComponent(slug)}`);
    if (raw.redirect) raw = await this.request<R>(`/api/resources/${encodeURIComponent(raw.redirect)}`);
    const r: R | undefined = raw.resource;
    if (!r) throw new AppError(404, "ELIBRARY_RESOURCE_NOT_FOUND", "That e-library resource is no longer available");
    return {
      ...this.card(r),
      description: r.description ?? r.shortDescription ?? null,
      topic: r.topicText ?? r.topic?.name ?? null,
      subtopic: r.subtopicText ?? r.subtopic?.name ?? null,
      curriculum: r.curriculum?.name ?? null,
      author: r.author ?? null,
      publisher: r.publisher ?? null,
      keywords: r.keywords ?? [],
      publishedAt: r.publishedAt ?? null,
    };
  }

  /** Extracted text for AI grounding; requires the shared integration key. Long books come in windows. */
  async text(slug: string, offset = 0, limit = 200_000) {
    return this.request<{ resource: R; text: string; totalChars: number; truncated: boolean; nextOffset?: number | null }>(
      `/api/integrations/resources/${encodeURIComponent(slug)}/text?offset=${offset}&limit=${limit}&includeDrafts=1`, { integration: true },
    );
  }

  /** The whole extracted text of a book, however long (read window by window, up to maxChars). */
  async fullText(slug: string, maxChars = 5_000_000) {
    const first = await this.text(slug, 0, 400_000);
    let text = first.text;
    let next = first.nextOffset ?? (first.truncated ? text.length : null);
    while (next !== null && next !== undefined && text.length < maxChars) {
      const page = await this.text(slug, next, 400_000);
      if (!page.text) break;
      text += page.text;
      next = page.nextOffset ?? null;
    }
    return { resource: first.resource, text, totalChars: first.totalChars, complete: text.length >= first.totalChars };
  }

  /** Partner catalogue (includes unreviewed drafts, which are only used for AI grounding, never shown publicly). */
  async catalog(input: { class?: string; subject?: string; type?: string; term?: string; q?: string; limit?: number }) {
    const params = new URLSearchParams({ includeDrafts: "1", limit: String(input.limit ?? 30) });
    for (const k of ["class", "subject", "type", "term", "q"] as const) if (input[k]) params.set(k, input[k]!);
    const raw = await this.request<{ items: Array<{ slug: string; title: string; status: string; type: string | null; class: string | null; subject: string | null; term: string | null; chars: number; sha256: string | null }> }>(
      `/api/integrations/resources?${params}`, { integration: true });
    return raw.items;
  }

  /** Publishes a document (scheme, notes, lesson plans) to the public library under the Ledgerly AI account. */
  async publish(file: { name: string; bytes: Uint8Array; mimeType: string }, meta: Record<string, string | undefined>) {
    if (!this.runtime.config.ULIBTECH_INTEGRATION_KEY) throw new AppError(503, "ELIBRARY_TEXT_DISABLED", "Publishing to the e-library is not configured");
    const form = new FormData();
    for (const [k, v] of Object.entries(meta)) if (v) form.set(k, v);
    form.set("file", new Blob([Buffer.from(file.bytes)], { type: file.mimeType }), file.name);
    const response = await fetch(`${this.baseUrl}/api/integrations/resources`, {
      method: "POST", body: form,
      headers: { "X-Integration-Key": this.runtime.config.ULIBTECH_INTEGRATION_KEY, "User-Agent": "Ledgerly-ELibrary/1.0" },
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.json().catch(() => ({})) as R;
    if (!response.ok) throw new AppError(502, "ELIBRARY_PUBLISH_FAILED", `The e-library refused the upload: ${body?.error?.message ?? response.status}`);
    const slug = body.resource?.slug ?? body.slug;
    return { slug, pageUrl: `${this.baseUrl}/resources/${slug}`, status: body.resource?.status ?? body.status ?? "processing", raw: body };
  }

  /** Uploads a new version of a document published earlier by Ledgerly AI (same page and link). */
  async replaceFile(slug: string, file: { name: string; bytes: Uint8Array; mimeType: string }, notes?: string) {
    if (!this.runtime.config.ULIBTECH_INTEGRATION_KEY) throw new AppError(503, "ELIBRARY_TEXT_DISABLED", "Publishing to the e-library is not configured");
    const form = new FormData();
    if (notes) form.set("notes", notes);
    form.set("file", new Blob([Buffer.from(file.bytes)], { type: file.mimeType }), file.name);
    const response = await fetch(`${this.baseUrl}/api/integrations/resources/${encodeURIComponent(slug)}/file`, {
      method: "POST", body: form,
      headers: { "X-Integration-Key": this.runtime.config.ULIBTECH_INTEGRATION_KEY, "User-Agent": "Ledgerly-ELibrary/1.0" },
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.json().catch(() => ({})) as R;
    if (!response.ok) throw new AppError(502, "ELIBRARY_PUBLISH_FAILED", `The e-library refused the new version: ${body?.error?.message ?? response.status}`);
    return { slug, pageUrl: `${this.baseUrl}/resources/${slug}` };
  }

  async publishedStatus(slug: string) {
    return this.request<{ slug: string; status: string; title: string }>(`/api/integrations/resources/${encodeURIComponent(slug)}/status`, { integration: true });
  }
}

const ELIBRARY_INTENT = /\b(schemes?( of work)?|lesson ?plans?|e-?library|ulibtech|notesug|past ?papers?|revision|syllabus|curriculum|lesson notes)\b/i;

/**
 * E-library material for the Ledgerly AI prompt when the user asks about schemes, lesson plans or study material.
 * Never throws: the chat must still work if ULibTech is slow or down.
 */
export async function elibraryPromptContext(client: UlibtechClient, query: string): Promise<string | null> {
  if (!ELIBRARY_INTENT.test(query)) return null;
  try {
    const result = await client.search({ q: query.replace(/\s+/g, " ").slice(0, 200), pageSize: 6 });
    if (!result.items.length) return "No matching e-library resources were found for this request.";
    const lines = result.items.map((item, index) =>
      `${index + 1}. ${item.title} | ${[item.type, item.className, item.subject, item.term].filter(Boolean).join(" | ")} | slug: ${item.slug} | ${item.pageUrl}`);
    const best = result.items.find(item => /scheme|lesson/i.test(item.typeSlug ?? "")) ?? result.items[0];
    let excerpt = "";
    if (client.textEnabled && best) {
      const content = await client.text(best.slug).catch(() => null);
      if (content?.text) excerpt = `\n\nExtracted text of "${best.title}" (first ${Math.min(content.text.length, 12000)} of ${content.totalChars} characters):\n${content.text.slice(0, 12000)}`;
    }
    return lines.join("\n") + excerpt;
  } catch {
    return "The e-library could not be reached for this request.";
  }
}

const clients = new WeakMap<Runtime, UlibtechClient>();
export function ulibtech(runtime: Runtime) {
  let client = clients.get(runtime);
  if (!client) { client = new UlibtechClient(runtime); clients.set(runtime, client); }
  return client;
}

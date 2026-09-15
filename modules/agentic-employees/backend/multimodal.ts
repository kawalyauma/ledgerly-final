import { AppError } from "../../../src/lib/errors";
import type { Env } from "../../../src/types";
import type { ModelTier } from "./policy";
import { resolveRuntimeProvider } from "./provider-config";
import { runWorkersAiAdvisory, type WorkersAiImage } from "./workers-ai";

export type ChatImage = WorkersAiImage & {
  id: string;
  objectKey: string;
  originalName: string;
};

type AiEnv = Env & { AI_PROVIDER_ENCRYPTION_KEY?: string };

function b64(bytes: Uint8Array) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 0x8000)));
  }
  return btoa(out);
}

function responseText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const chunks: string[] = [];
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) if (part?.type === "output_text" && part?.text) chunks.push(part.text);
  }
  return chunks.join("\n").trim();
}

function anthropicText(payload: any) {
  return (payload?.content || []).filter((x: any) => x?.type === "text" && x?.text).map((x: any) => x.text).join("\n").trim();
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    return { response, payload: payload as any };
  } finally {
    clearTimeout(timer);
  }
}

export function primaryModelSupportsVision(provider: string, model: string) {
  const id = model.toLowerCase();
  if (provider === "anthropic") return id.startsWith("claude-");
  if (provider === "google") return id.startsWith("gemini-");
  if (provider === "openai") {
    return /^(gpt-|o[1-9])/.test(id) && !/(audio|realtime|transcribe|tts)/.test(id);
  }
  return false;
}

export async function loadChatImages(
  db: D1Database,
  env: Env,
  organizationId: string,
  conversationId: string,
  attachmentIds: string[],
) {
  if (!attachmentIds.length) return [] as ChatImage[];
  if (attachmentIds.length > 4) throw new AppError(422, "TOO_MANY_IMAGES", "Attach at most 4 images to one AI message.");
  const images: ChatImage[] = [];
  for (const id of attachmentIds) {
    const row = await db.prepare(`SELECT id,object_key AS objectKey,original_name AS originalName,mime_type AS mimeType,
      conversation_id AS conversationId,message_id AS messageId,status,purpose
      FROM ae_image_attachments WHERE id=? AND organization_id=?`)
      .bind(id, organizationId).first<any>();
    if (!row || row.status === "deleted") throw new AppError(404, "IMAGE_NOT_FOUND", "One of the attached chat images was not found.");
    if (row.conversationId !== conversationId || row.purpose !== "chat") throw new AppError(403, "IMAGE_CONVERSATION_MISMATCH", "The image belongs to a different conversation.");
    if (row.messageId) throw new AppError(409, "IMAGE_ALREADY_SENT", "One of the images has already been attached to a message.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(String(row.mimeType))) throw new AppError(415, "UNSUPPORTED_IMAGE", "Chat images must be JPEG, PNG or WebP.");
    const object = await env.WORK_FILES_BUCKET.get(row.objectKey);
    if (!object) throw new AppError(404, "IMAGE_FILE_MISSING", "The stored chat image is missing.");
    const bytes = new Uint8Array(await object.arrayBuffer());
    images.push({ id: row.id, objectKey: row.objectKey, originalName: row.originalName, mimeType: row.mimeType, bytes } as ChatImage);
  }
  return images;
}

export async function analyzeImagesWithPrimary(input: {
  db: D1Database;
  env: AiEnv;
  organizationId: string;
  modelTier: ModelTier;
  userText: string;
  images: ChatImage[];
}) {
  const runtime = await resolveRuntimeProvider(input.db, input.env, input.organizationId, input.modelTier);
  if (!primaryModelSupportsVision(runtime.provider, runtime.model)) {
    return { supported: false, ok: false, text: "", provider: runtime.provider, model: runtime.model, error: null };
  }
  const prompt = [
    "Analyze the attached images for a Ledgerly school AI employee.",
    "Read visible text carefully, including tables and handwriting where legible. Describe relevant visual evidence and preserve names, dates, amounts, labels and relationships.",
    "Do not invent unreadable values. Return concise factual observations that another AI agent can use with Ledgerly tools.",
    `USER MESSAGE: ${input.userText || "(image-only message)"}`,
  ].join("\n\n");
  try {
    if (runtime.provider === "anthropic") {
      const content: any[] = input.images.map(image => ({
        type: "image",
        source: { type: "base64", media_type: image.mimeType, data: b64(image.bytes) },
      }));
      content.push({ type: "text", text: prompt });
      const { response, payload } = await fetchJson(`${runtime.baseUrl}/messages`, {
        method: "POST",
        headers: { "x-api-key": runtime.apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: runtime.model, max_tokens: Math.min(runtime.config.maxOutputTokens, 1600), messages: [{ role: "user", content }] }),
      }, runtime.config.timeoutMs);
      if (!response.ok) throw new Error(payload?.error?.message || `Anthropic vision request failed (${response.status})`);
      return { supported: true, ok: true, text: anthropicText(payload), provider: runtime.provider, model: runtime.model, error: null };
    }
    if (runtime.provider === "google") {
      const content: any[] = input.images.map(image => ({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${b64(image.bytes)}` } }));
      content.push({ type: "text", text: prompt });
      const { response, payload } = await fetchJson(`${runtime.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${runtime.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: runtime.model, max_tokens: Math.min(runtime.config.maxOutputTokens, 1600), messages: [{ role: "user", content }] }),
      }, runtime.config.timeoutMs);
      if (!response.ok) throw new Error(payload?.error?.message || `Gemini vision request failed (${response.status})`);
      return { supported: true, ok: true, text: payload?.choices?.[0]?.message?.content?.trim() || "", provider: runtime.provider, model: runtime.model, error: null };
    }
    const content: any[] = input.images.map(image => ({ type: "input_image", image_url: `data:${image.mimeType};base64,${b64(image.bytes)}` }));
    content.push({ type: "input_text", text: prompt });
    const { response, payload } = await fetchJson(`${runtime.baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${runtime.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: runtime.model, max_output_tokens: Math.min(runtime.config.maxOutputTokens, 1600), input: [{ role: "user", content }] }),
    }, runtime.config.timeoutMs);
    if (!response.ok) throw new Error(payload?.error?.message || `OpenAI vision request failed (${response.status})`);
    return { supported: true, ok: true, text: responseText(payload), provider: runtime.provider, model: runtime.model, error: null };
  } catch (error) {
    return { supported: true, ok: false, text: "", provider: runtime.provider, model: runtime.model, error: error instanceof Error ? error.message.slice(0, 700) : String(error).slice(0, 700) };
  }
}

export async function prepareImageAdvisory(input: {
  db: D1Database;
  env: AiEnv;
  organizationId: string;
  agentName: string;
  agentTitle: string;
  modelTier: ModelTier;
  userText: string;
  recentContext: string;
  images: ChatImage[];
}) {
  const [primary, workers] = await Promise.all([
    analyzeImagesWithPrimary({ db: input.db, env: input.env, organizationId: input.organizationId, modelTier: input.modelTier, userText: input.userText, images: input.images }),
    runWorkersAiAdvisory({ db: input.db, env: input.env, organizationId: input.organizationId, agentName: input.agentName, agentTitle: input.agentTitle, userText: input.userText, recentContext: input.recentContext, images: input.images }),
  ]);
  if (!primary.ok && !workers.ok) {
    if (!primary.supported && (!workers.configured || !workers.ok)) {
      throw new AppError(422, "AI_MODEL_NO_VISION", `The primary model ${primary.model} is not declared vision-capable and no working vision-capable Workers AI sidecar is available.`);
    }
    throw new AppError(502, "AI_VISION_FAILED", "The attached image could not be analyzed by either configured AI path.", { primary: primary.error, workers: workers.error });
  }
  const sections: string[] = [];
  if (workers.ok && workers.text) sections.push(`WORKERS AI SECONDARY IMAGE ANALYSIS (${workers.model}):\n${workers.text}`);
  if (primary.ok && primary.text) sections.push(`PRIMARY PROVIDER IMAGE ANALYSIS (${primary.provider}/${primary.model}):\n${primary.text}`);
  return {
    text: sections.join("\n\n"),
    workers,
    primary,
  };
}

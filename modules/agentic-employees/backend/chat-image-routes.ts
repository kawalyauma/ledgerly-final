import { Hono } from "hono";
import { z } from "zod";
import type { AppVariables, Env } from "../../../src/types";
import { AppError } from "../../../src/lib/errors";
import { requireScope } from "../../../src/lib/auth";
import { createId } from "../../../src/lib/ids";
import { AGENTS, allowedTools, isAgentKey, type AgentDefinition, type AgentKey, type ModelTier } from "./policy";
import { runAgent } from "./openai";
import { loadChatImages, prepareImageAdvisory } from "./multimodal";

export const agenticChatImageRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

type OverrideRow = { agentKey: string; enabled: number; modelTier: ModelTier | null; systemPrompt: string | null; toolAllowlistJson: string | null };

function safeName(value: string) {
  return String(value || "image").normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 160) || "image";
}
async function sha256(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(x => x.toString(16).padStart(2, "0")).join("");
}
async function effectiveAgent(db: D1Database, organizationId: string, key: AgentKey): Promise<AgentDefinition & { enabled: boolean; configuredTools: string[] }> {
  const base = AGENTS[key];
  const row = await db.prepare(`SELECT agent_key AS agentKey,enabled,model_tier AS modelTier,system_prompt AS systemPrompt,
    tool_allowlist_json AS toolAllowlistJson FROM ae_agent_settings WHERE organization_id=? AND agent_key=?`)
    .bind(organizationId, key).first<OverrideRow>();
  let requested: string[] | null = null;
  try { requested = row?.toolAllowlistJson ? JSON.parse(row.toolAllowlistJson) : null; } catch { requested = null; }
  return { ...base, modelTier: (row?.modelTier || base.modelTier) as ModelTier, systemPrompt: row?.systemPrompt?.trim() || base.systemPrompt,
    enabled: row ? Boolean(row.enabled) : true, configuredTools: allowedTools(base, requested) };
}
async function conversation(db: D1Database, organizationId: string, id: string) {
  const row = await db.prepare(`SELECT id,agent_key AS agentKey,title,status FROM ae_conversations WHERE id=? AND organization_id=?`)
    .bind(id, organizationId).first<{ id: string; agentKey: string; title: string; status: string }>();
  if (!row) throw new AppError(404, "NOT_FOUND", "AI conversation not found");
  return row;
}

agenticChatImageRoutes.post("/conversations/:id/images", requireScope("school:read"), async c => {
  const p = c.get("principal");
  const conv = await conversation(c.env.FINANCE_DB, p.organizationId, c.req.param("id"));
  if (conv.status !== "active") throw new AppError(409, "CONVERSATION_CLOSED", "Images can only be attached to an active conversation.");
  const form = await c.req.formData();
  const part = form.get("file");
  if (!(part instanceof File)) throw new AppError(422, "FILE_REQUIRED", "Choose an image to attach to the message.");
  if (part.size <= 0) throw new AppError(422, "EMPTY_FILE", "The image is empty.");
  if (part.size > MAX_IMAGE_BYTES) throw new AppError(413, "IMAGE_TOO_LARGE", "Chat images are limited to 8 MB each.");
  const mime = String(part.type || "").toLowerCase();
  if (!IMAGE_MIMES.has(mime)) throw new AppError(415, "UNSUPPORTED_IMAGE", "Chat images must be JPEG, PNG or WebP.");
  const id = createId("aeimg");
  const buffer = await part.arrayBuffer();
  const checksum = await sha256(buffer);
  const key = `agentic-chat-images/${p.organizationId}/${conv.id}/${id}/${safeName(part.name)}`;
  await c.env.WORK_FILES_BUCKET.put(key, buffer, {
    httpMetadata: { contentType: mime, contentDisposition: `inline; filename=\"${safeName(part.name)}\"` },
    customMetadata: { organizationId: p.organizationId, conversationId: conv.id, imageId: id, checksum, purpose: "chat" },
  });
  await c.env.FINANCE_DB.prepare(`INSERT INTO ae_image_attachments
    (id,organization_id,uploaded_by,object_key,original_name,mime_type,size_bytes,checksum_sha256,status,conversation_id,purpose)
    VALUES(?,?,?,?,?,?,?,?,'ready',?,'chat')`)
    .bind(id, p.organizationId, p.userId, key, part.name, mime, part.size, checksum, conv.id).run();
  return c.json({ data: { id, originalName: part.name, mimeType: mime, sizeBytes: part.size,
    previewUrl: `/api/v1/agentic-employees/vision/images/${id}`, purpose: "chat" } }, 201);
});

agenticChatImageRoutes.get("/conversations/:id/messages", requireScope("school:read"), async c => {
  const p = c.get("principal");
  const id = c.req.param("id");
  await conversation(c.env.FINANCE_DB, p.organizationId, id);
  const [messages, images] = await Promise.all([
    c.env.FINANCE_DB.prepare(`SELECT id,role,content,model,provider_response_id AS providerResponseId,metadata_json AS metadataJson,created_at AS createdAt
      FROM ae_messages WHERE organization_id=? AND conversation_id=? ORDER BY created_at,id`).bind(p.organizationId, id).all<any>(),
    c.env.FINANCE_DB.prepare(`SELECT id,message_id AS messageId,original_name AS originalName,mime_type AS mimeType,size_bytes AS sizeBytes
      FROM ae_image_attachments WHERE organization_id=? AND conversation_id=? AND message_id IS NOT NULL AND status<>'deleted' ORDER BY created_at,id`)
      .bind(p.organizationId, id).all<any>(),
  ]);
  const byMessage = new Map<string, any[]>();
  for (const image of images.results) {
    const list = byMessage.get(String(image.messageId)) || [];
    list.push({ ...image, previewUrl: `/api/v1/agentic-employees/vision/images/${image.id}` });
    byMessage.set(String(image.messageId), list);
  }
  return c.json({ data: messages.results.map(row => ({
    id: row.id, role: row.role, content: row.content, model: row.model, providerResponseId: row.providerResponseId,
    createdAt: row.createdAt, attachments: byMessage.get(String(row.id)) || [],
  })) });
});

agenticChatImageRoutes.post("/conversations/:id/messages", requireScope("school:read"), async c => {
  const parsed = z.object({
    content: z.string().trim().max(12000).optional().default(""),
    attachmentIds: z.array(z.string().min(1)).max(4).optional().default([]),
  }).safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid AI message", parsed.error.flatten());
  if (!parsed.data.content && !parsed.data.attachmentIds.length) throw new AppError(422, "VALIDATION_ERROR", "Type a message or attach an image.");
  const p = c.get("principal");
  const conv = await conversation(c.env.FINANCE_DB, p.organizationId, c.req.param("id"));
  if (!isAgentKey(conv.agentKey)) throw new AppError(409, "AGENT_INVALID", "Conversation agent is invalid.");
  const agent = await effectiveAgent(c.env.FINANCE_DB, p.organizationId, conv.agentKey);
  if (!agent.enabled) throw new AppError(409, "AGENT_DISABLED", "This AI employee is disabled.");
  const images = await loadChatImages(c.env.FINANCE_DB, c.env, p.organizationId, conv.id, parsed.data.attachmentIds);
  const userMessageId = createId("aam");
  const userText = parsed.data.content;
  const statements: D1PreparedStatement[] = [
    c.env.FINANCE_DB.prepare(`INSERT INTO ae_messages(id,organization_id,conversation_id,role,content,user_id,metadata_json)
      VALUES(?,?,?,'user',?,?,?)`).bind(userMessageId, p.organizationId, conv.id, userText, p.userId,
        JSON.stringify({ attachmentIds: parsed.data.attachmentIds, attachmentCount: images.length })),
  ];
  for (const image of images) statements.push(c.env.FINANCE_DB.prepare(`UPDATE ae_image_attachments SET message_id=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND organization_id=? AND conversation_id=? AND message_id IS NULL`).bind(userMessageId, image.id, p.organizationId, conv.id));
  await c.env.FINANCE_DB.batch(statements);

  const history = await c.env.FINANCE_DB.prepare(`SELECT role,content FROM ae_messages WHERE organization_id=? AND conversation_id=?
    AND role IN ('user','assistant') ORDER BY created_at DESC,id DESC LIMIT 24`)
    .bind(p.organizationId, conv.id).all<{ role: "user" | "assistant"; content: string }>();
  const ordered = [...history.results].reverse();
  const recentContext = ordered.slice(-8).map(x => `${x.role}: ${x.content}`).join("\n");
  let imageAdvisory: Awaited<ReturnType<typeof prepareImageAdvisory>> | null = null;
  if (images.length) {
    imageAdvisory = await prepareImageAdvisory({
      db: c.env.FINANCE_DB, env: c.env, organizationId: p.organizationId, agentName: agent.name, agentTitle: agent.title,
      modelTier: agent.modelTier, userText, recentContext, images,
    });
  }
  const result = await runAgent({
    db: c.env.FINANCE_DB,
    env: c.env,
    principal: p,
    agent,
    modelTier: agent.modelTier,
    requestedTools: agent.configuredTools,
    conversationId: conv.id,
    messages: ordered,
    workersAdvisory: imageAdvisory?.text,
  });
  const assistantMessageId = createId("aam");
  await c.env.FINANCE_DB.batch([
    c.env.FINANCE_DB.prepare(`INSERT INTO ae_messages
      (id,organization_id,conversation_id,role,content,user_id,model,provider_response_id,metadata_json)
      VALUES(?,?,?,'assistant',?,?,?,?,?,?)`).bind(
        assistantMessageId, p.organizationId, conv.id, result.text, p.userId, result.model, result.providerResponseId,
        JSON.stringify({ usage: result.usage, toolEvents: result.toolEvents, workersAi: result.workersAi || imageAdvisory?.workers || null,
          imageAnalysis: imageAdvisory ? { primary: imageAdvisory.primary, workers: imageAdvisory.workers } : null }),
      ),
    c.env.FINANCE_DB.prepare(`UPDATE ae_conversations SET last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND organization_id=?`).bind(conv.id, p.organizationId),
  ]);
  return c.json({ data: { id: assistantMessageId, role: "assistant", content: result.text, model: result.model,
    toolEvents: result.toolEvents, workersAi: result.workersAi || imageAdvisory?.workers || null, attachments: [] } });
});

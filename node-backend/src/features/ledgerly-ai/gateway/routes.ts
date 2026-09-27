import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import type { AppEnv } from "../../../http/types.js";
import type { Runtime } from "../../../runtime.js";
import { createId } from "../../core-identity/security.js";
import type { LedgerlyAiTaskKind } from "../providers/types.js";
import type { LedgerlyAiGatewayRepository } from "./repository.js";
import type { LedgerlyAiGatewayService } from "./service.js";

const taskKinds = ["chat","analysis","report","research","code","engineering","testing","operations"] as const;
const providerIds = ["claude-code","codex"] as const;
const attachmentSchema=z.object({
  fileId:z.string().trim().min(1).max(120).optional(),
  name:z.string().trim().min(1).max(160),
  mimeType:z.string().trim().min(1).max(150),
  content:z.string().max(40000).default(""),
  kind:z.enum(["file","context"]),
}).refine(item=>item.kind==="context"?Boolean(item.content.trim()):Boolean(item.fileId||item.content),"File attachment is missing its uploaded file id.");
const requestSchema = z.object({
  message: z.string().trim().min(1).max(30000),
  chatId: z.string().min(1).max(120).optional(),
  agentId: z.string().min(1).max(120).nullable().optional(),
  title: z.string().trim().min(1).max(160).optional(),
  activeModule: z.string().trim().min(1).max(120).nullable().optional(),
  taskKind: z.enum(taskKinds).default("chat"),
  provider: z.enum(providerIds).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  attachments:z.array(attachmentSchema).max(5)
    .refine(
      items=>items.reduce((sum,item)=>sum+Buffer.byteLength(item.content,"utf8"),0)<=120000,
      "Attached context is limited to 120 KB per message.",
    )
    .default([]),
  resumeJobId:z.string().trim().min(1).max(120).optional(),
});

function idempotencyKey(c: { req: { header(name: string): string | undefined } }) {
  return c.req.header("Idempotency-Key") ?? null;
}

export function createLedgerlyAiGatewayRoutes(
  repository: LedgerlyAiGatewayRepository,
  gateway: LedgerlyAiGatewayService,
  runtime:Runtime,
) {
  const routes = new Hono<AppEnv>();

  routes.post("/prompt", async (c) => {
    const parsed = requestSchema.omit({ chatId: true }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid Ledgerly AI prompt.", parsed.error.flatten());
    const response = await gateway.run({
      ...parsed.data,
      principal: c.get("principal"),
      taskKind: parsed.data.taskKind as LedgerlyAiTaskKind,
      idempotencyKey: idempotencyKey(c),
    });
    return c.json({ data: response }, 201);
  });

  routes.post("/chat", async (c) => {
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid Ledgerly AI chat request.", parsed.error.flatten());
    const response = await gateway.run({
      ...parsed.data,
      principal: c.get("principal"),
      taskKind: parsed.data.taskKind as LedgerlyAiTaskKind,
      idempotencyKey: idempotencyKey(c),
    });
    return c.json({ data: response }, parsed.data.chatId ? 200 : 201);
  });

  routes.post("/chat/stream", async (c) => {
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid Ledgerly AI streaming request.", parsed.error.flatten());
    c.header("Cache-Control", "no-cache");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const emit = async (event: string, data: unknown) => {
        await stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      try {
        await emit("connected", { name: "Ledgerly AI", at: new Date().toISOString() });
        const response = await gateway.run({
          ...parsed.data,
          principal: c.get("principal"),
          taskKind: parsed.data.taskKind as LedgerlyAiTaskKind,
          idempotencyKey: idempotencyKey(c),
        }, async (progress) => emit("progress", progress));
        await emit("response", response);
      } catch (error) {
        const appError = error instanceof AppError ? error : null;
        await emit("error", {
          code: appError?.code ?? "LEDGERLY_AI_REQUEST_FAILED",
          message: appError?.message ?? "Ledgerly AI could not complete the request.",
        });
      }
    });
  });

  routes.get("/my/chats", async (c) => {
    const status=z.enum(["active","archived"]).optional().safeParse(c.req.query("status"));
    if(!status.success)throw new AppError(422,"VALIDATION_ERROR","Invalid chat status.");
    return c.json({data:await repository.listMyChats(c.get("principal"),status.data)});
  });

  routes.post("/my/files",async(c)=>{
    const principal=c.get("principal"),form=await c.req.formData(),part=form.get("file");
    if(!(part instanceof File))throw new AppError(422,"FILE_REQUIRED","Choose a file to attach.");
    if(part.size<=0||part.size>25*1024*1024)throw new AppError(part.size>25*1024*1024?413:422,"INVALID_FILE_SIZE","Chat files must be between 1 byte and 25 MB.");
    const allowed=new Set(["text/plain","text/markdown","text/csv","application/json","application/xml","text/xml","application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.openxmlformats-officedocument.presentationml.presentation","image/png","image/jpeg","image/webp","image/gif"]);
    const mime=(part.type||"application/octet-stream").toLowerCase();
    if(!allowed.has(mime))throw new AppError(415,"UNSUPPORTED_CHAT_FILE","Attach a text, PDF, Word, Excel, PowerPoint, PNG, JPEG, WebP, or GIF file.");
    const id=createId("laif"),safe=part.name.replace(/[^a-zA-Z0-9._-]+/g,"-").slice(0,160)||"attachment",objectKey=`ledgerly-ai/${principal.organizationId}/inputs/${id}/${safe}`;
    const bytes=new Uint8Array(await part.arrayBuffer());await runtime.storage.put(objectKey,bytes,mime);
    try{const file=await repository.createChatFile({principal,id,direction:"input",objectKey,filename:part.name.slice(0,160),mimeType:mime,sizeBytes:bytes.byteLength});return c.json({data:{id:file.id,name:file.filename,mimeType:file.mimeType,sizeBytes:file.sizeBytes,kind:"file"}},201);}catch(error){await runtime.storage.delete(objectKey).catch(()=>{});throw error;}
  });

  routes.get("/my/files/:id",async(c)=>{
    const file=await repository.getMyChatFile(c.get("principal"),c.req.param("id")),bytes=await runtime.storage.get(file.objectKey);
    if(!bytes)throw new AppError(404,"LEDGERLY_AI_FILE_MISSING","The chat file is no longer available.");
    c.header("Content-Type",file.mimeType);c.header("Content-Length",String(bytes.byteLength));c.header("Content-Disposition",`attachment; filename="${file.filename.replace(/["\r\n]/g,"-")}"`);c.header("X-Content-Type-Options","nosniff");return c.body(bytes as any);
  });

  routes.get("/my/chats/:id", async (c) => {
    const principal=c.get("principal");
    const chat=await repository.getMyChat(principal,c.req.param("id"));
    const messages=await repository.listMyChatMessages(principal,chat.id);
    return c.json({data:{...chat,messages}});
  });

  routes.post("/my/chats/:id/messages", async (c) => {
    const parsed=requestSchema.omit({chatId:true}).safeParse(await c.req.json().catch(()=>null));
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid Ledgerly AI message.",parsed.error.flatten());
    const principal=c.get("principal");
    await repository.getMyChat(principal,c.req.param("id"));
    const response=await gateway.run({
      ...parsed.data,principal,chatId:c.req.param("id"),
      taskKind:parsed.data.taskKind as LedgerlyAiTaskKind,idempotencyKey:idempotencyKey(c),
    });
    return c.json({data:response});
  });

  routes.post("/my/chats/:id/archive", async (c) => {
    const principal=c.get("principal");
    await repository.getMyChat(principal,c.req.param("id"));
    return c.json({data:await repository.updateChat(principal,c.req.param("id"),{status:"archived"})});
  });

  routes.get("/my/jobs", async (c) => {
    const parsed=z.coerce.number().int().min(1).max(100).default(50).safeParse(c.req.query("limit")??50);
    if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid job limit.");
    return c.json({data:await repository.listUserJobs(c.get("principal"),parsed.data)});
  });

  routes.get("/chats", async (c) => {
    const status = z.enum(["active","archived"]).optional().safeParse(c.req.query("status"));
    if (!status.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid chat status.");
    return c.json({ data: await repository.listChats(c.get("principal"), status.data) });
  });

  routes.post("/chats", async (c) => {
    const parsed = z.object({
      title: z.string().trim().min(1).max(160),
    }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid Ledgerly AI chat.", parsed.error.flatten());
    const principal=c.get("principal");
    const chat = await repository.createChat({
      principal,
      title: parsed.data.title,
      agentId:null,
    });
    return c.json({ data: chat }, 201);
  });

  routes.get("/chats/:id", async (c) => {
    const principal = c.get("principal");
    const chat = await repository.getChat(principal, c.req.param("id"));
    const messages = await repository.listMessages(principal, chat.id);
    return c.json({ data: { ...chat, messages } });
  });

  routes.patch("/chats/:id", async (c) => {
    const parsed = z.object({
      title: z.string().trim().min(1).max(160).optional(),
      status: z.enum(["active","archived"]).optional(),
    }).refine((value) => value.title !== undefined || value.status !== undefined, "At least one change is required.")
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid chat update.", parsed.error.flatten());
    return c.json({ data: await repository.updateChat(c.get("principal"), c.req.param("id"), parsed.data) });
  });

  routes.post("/chats/:id/archive", async (c) => {
    return c.json({ data: await repository.updateChat(c.get("principal"), c.req.param("id"), { status: "archived" }) });
  });

  routes.delete("/chats/:id", async (c) => {
    await repository.updateChat(c.get("principal"), c.req.param("id"), { status: "deleted" });
    return c.body(null, 204);
  });

  routes.get("/chats/:id/messages", async (c) => {
    return c.json({ data: await repository.listMessages(c.get("principal"), c.req.param("id")) });
  });

  routes.post("/chats/:id/messages", async (c) => {
    const parsed = requestSchema.omit({ chatId: true }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid Ledgerly AI message.", parsed.error.flatten());
    const response = await gateway.run({
      ...parsed.data,
      principal: c.get("principal"),
      chatId: c.req.param("id"),
      taskKind: parsed.data.taskKind as LedgerlyAiTaskKind,
      idempotencyKey: idempotencyKey(c),
    });
    return c.json({ data: response });
  });

  return routes;
}

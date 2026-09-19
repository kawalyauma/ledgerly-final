import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { AppError } from "../../../http/errors.js";
import type { AppEnv } from "../../../http/types.js";
import type { LedgerlyAiTaskKind } from "../providers/types.js";
import type { LedgerlyAiGatewayRepository } from "./repository.js";
import type { LedgerlyAiGatewayService } from "./service.js";
import type { LedgerlyAiEmployeeRegistry } from "../employees/registry.js";

const taskKinds = ["chat","analysis","report","research","code","engineering","testing","operations"] as const;
const attachmentSchema=z.object({
  name:z.string().trim().min(1).max(160),
  mimeType:z.enum(["text/plain","text/markdown","text/csv","application/json","application/xml","text/xml"]),
  content:z.string().max(40000),
  kind:z.enum(["file","context"]),
});
const requestSchema = z.object({
  message: z.string().trim().min(1).max(30000),
  chatId: z.string().min(1).max(120).optional(),
  agentId: z.string().min(1).max(120).nullable().optional(),
  title: z.string().trim().min(1).max(160).optional(),
  activeModule: z.string().trim().min(1).max(120).nullable().optional(),
  taskKind: z.enum(taskKinds).default("chat"),
  metadata: z.record(z.string(), z.unknown()).optional(),
  attachments:z.array(attachmentSchema).max(5)
    .refine(
      items=>items.reduce((sum,item)=>sum+Buffer.byteLength(item.content,"utf8"),0)<=120000,
      "Attached context is limited to 120 KB per message.",
    )
    .default([]),
});

function idempotencyKey(c: { req: { header(name: string): string | undefined } }) {
  return c.req.header("Idempotency-Key") ?? null;
}

export function createLedgerlyAiGatewayRoutes(
  repository: LedgerlyAiGatewayRepository,
  gateway: LedgerlyAiGatewayService,
  employees?: LedgerlyAiEmployeeRegistry,
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
      agentId: z.string().min(1).max(120).nullable().optional(),
    }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Invalid Ledgerly AI chat.", parsed.error.flatten());
    const principal=c.get("principal");
    if(parsed.data.agentId&&employees){
      await employees.resolveSelectable(principal,parsed.data.agentId);
    }
    const chat = await repository.createChat({
      principal,
      title: parsed.data.title,
      agentId: parsed.data.agentId,
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

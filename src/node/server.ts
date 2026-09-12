import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import worker from "../index";
import { loadNodeConfig } from "./config";
import { createNodeRuntime } from "./runtime";

function requestUrl(req: IncomingMessage): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const scheme = proto?.split(",")[0]?.trim() || "http";
  const host = req.headers.host || "localhost";
  return `${scheme}://${host}${req.url || "/"}`;
}
function webRequest(req: IncomingMessage): Request {
  const method = req.method || "GET";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD") { init.body = Readable.toWeb(req) as ReadableStream; init.duplex = "half"; }
  return new Request(requestUrl(req), init);
}
async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  headers.forEach((value, key) => { if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value); });
  const setCookies = headers.getSetCookie?.(); if (setCookies?.length) res.setHeader("set-cookie", setCookies);
  if (!response.body) { res.end(); return; }
  await new Promise<void>((resolve, reject) => { const stream = Readable.fromWeb(response.body as never); stream.once("error", reject); res.once("finish", resolve); stream.pipe(res); });
}

const config = loadNodeConfig();
const runtime = createNodeRuntime(config);
const executionContext = { waitUntil(promise: Promise<unknown>) { promise.catch((error) => console.error("waitUntil failed", error)); }, passThroughOnException() {} } as ExecutionContext;
const server = createServer(async (req, res) => {
  try { const response = await worker.fetch(webRequest(req), runtime.env, executionContext); await writeResponse(response, res); }
  catch (error) { console.error(error); if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "NODE_RUNTIME_ERROR", message: "The request could not be completed." } })); }
});
server.listen(config.PORT, config.HOST, () => console.log(JSON.stringify({ level: "info", message: "Ledgerly API listening", host: config.HOST, port: config.PORT, runtime: "node" })));
async function shutdown(signal: string): Promise<void> { console.log(JSON.stringify({ level: "info", message: "Shutting down Ledgerly API", signal })); server.close(async () => { await runtime.db.close(); process.exit(0); }); setTimeout(() => process.exit(1), 10_000).unref(); }
process.on("SIGTERM", () => void shutdown("SIGTERM")); process.on("SIGINT", () => void shutdown("SIGINT"));

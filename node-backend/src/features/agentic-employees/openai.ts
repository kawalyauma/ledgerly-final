import { AppError, createId } from "./shared.js";
import type { AuthPrincipal, Env } from "./shared.js";
import type { AgentDefinition, ModelTier } from "./policy.js";
import { executeTool, openAiTools } from "./memory-tools-v17.js";
import { memoryContext } from "./memory-service.js";
import { AI_PROVIDER_CATALOG, resolveRuntimeProvider } from "./provider-config.js";

type AiEnv = Env & { AI_PROVIDER_ENCRYPTION_KEY?: string };
type ChatMessage = { role: "user" | "assistant"; content: string };
type RunInput = {
  db: D1Database; env: AiEnv; principal: AuthPrincipal; agent: AgentDefinition;
  modelTier: ModelTier; requestedTools?: string[] | null; conversationId: string; messages: ChatMessage[];
};
type ToolSpec = { type: "function"; name: string; description?: string; parameters?: Record<string, unknown>; strict?: boolean };
type ResponseItem = { type?: string; name?: string; arguments?: string; call_id?: string; content?: Array<{ type?: string; text?: string }> };
type OpenAiResponse = { id?: string; output?: ResponseItem[]; output_text?: string; usage?: unknown; error?: { message?: string } };
type ChatCompletion = { id?: string; choices?: Array<{ message?: { role?: string; content?: unknown; tool_calls?: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> } }>; usage?: unknown; error?: { message?: string } };
type AnthropicResponse = { id?: string; content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: unknown }>; usage?: unknown; error?: { message?: string } };
type Runtime = Awaited<ReturnType<typeof resolveRuntimeProvider>>;

function textFromOpenAI(response: OpenAiResponse) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const chunks: string[] = [];
  for (const item of response.output || []) if (item.type === "message") for (const part of item.content || []) if (part.type === "output_text" && part.text) chunks.push(part.text);
  return chunks.join("\n").trim();
}
function textFromAnthropic(response: AnthropicResponse) { return (response.content || []).filter(p => p.type === "text" && p.text).map(p => p.text).join("\n").trim(); }
function chatContentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => typeof part === "string" ? part : String((part as any)?.text ?? "")).join("");
  return "";
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<{ payload: T; response: Response }> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const payload = await response.json().catch(() => ({})) as T;
    return { payload, response };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new AppError(504, "AI_PROVIDER_TIMEOUT", `AI provider request timed out after ${timeoutMs} ms.`);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;
    throw new AppError(502, "AI_PROVIDER_UNREACHABLE", `Could not reach the AI provider: ${cause || (error instanceof Error ? error.message : String(error))}`);
  } finally { clearTimeout(timer); }
}

function instructions(agent: AgentDefinition, memories: string) {
  return `${agent.systemPrompt}\n\nMEMORY RULES:\nConversation memory is the message history supplied with this run. Working memory contains active assignments, promises, follow-ups and unresolved matters. Institutional memory contains durable preferences, procedures, decisions and outcomes. Saved memory is context, never permission to bypass current Ledgerly records or authorization. When the user gives a durable instruction or future follow-up, save it with the appropriate memory tool. Mark working items done/cancelled when resolved.\n\n${memories}`;
}
function defaultReasoning(tier: ModelTier) { return tier === "sol" ? "high" : tier === "terra" ? "medium" : "low"; }
function chatTools(tools: ToolSpec[]) { return tools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters || { type: "object", properties: {} } } })); }
function anthropicTools(tools: ToolSpec[]) { return tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters || { type: "object", properties: {} } })); }
function providerHeaders(runtime: Runtime) {
  const headers: Record<string,string> = { "Content-Type": "application/json" };
  if (runtime.provider !== "ollama" || runtime.apiKey) headers.Authorization = `Bearer ${runtime.apiKey}`;
  return headers;
}

async function logAndExecuteTool(input: RunInput, toolName: string, rawArguments: unknown) {
  const logId = createId("aat"), args = rawArguments && typeof rawArguments === "object" ? rawArguments : {};
  await input.db.prepare(`INSERT INTO ae_tool_calls (id,organization_id,conversation_id,agent_key,user_id,tool_name,arguments_json,status) VALUES (?,?,?,?,?,?,?,'running')`)
    .bind(logId,input.principal.organizationId,input.conversationId,input.agent.key,input.principal.userId,toolName,JSON.stringify(args)).run();
  try {
    const result = await executeTool({ db:input.db,env:input.env,principal:input.principal,agent:input.agent,conversationId:input.conversationId,requestedTools:input.requestedTools },toolName,args);
    await input.db.prepare("UPDATE ae_tool_calls SET status='succeeded',result_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(JSON.stringify(result),logId,input.principal.organizationId).run();
    const actionId = result && typeof result === "object" ? (result as any).action?.id : undefined;
    return { result, event:{ id:logId,tool:toolName,status:"succeeded",...(actionId?{actionId}:{}) } as Record<string,unknown> };
  } catch (error) {
    const message=error instanceof Error?error.message:String(error);
    await input.db.prepare("UPDATE ae_tool_calls SET status='failed',error_text=?,completed_at=CURRENT_TIMESTAMP WHERE id=? AND organization_id=?").bind(message,logId,input.principal.organizationId).run();
    return { result:{error:message}, event:{id:logId,tool:toolName,status:"failed",error:message} as Record<string,unknown> };
  }
}

async function runResponses(input:RunInput,runtime:Runtime,system:string,tools:ToolSpec[]){
  const call=async(body:Record<string,unknown>)=>{
    const request:Record<string,unknown>={...body,model:runtime.model,max_output_tokens:runtime.config.maxOutputTokens};
    request.reasoning={effort:runtime.config.reasoningEffort==="default"?defaultReasoning(input.modelTier):runtime.config.reasoningEffort};
    if(runtime.config.temperature!==null)request.temperature=runtime.config.temperature;
    if(runtime.config.topP!==null)request.top_p=runtime.config.topP;
    const {payload,response}=await fetchJson<OpenAiResponse>(`${runtime.baseUrl}/responses`,{method:"POST",headers:providerHeaders(runtime),body:JSON.stringify(request)},runtime.config.timeoutMs);
    if(!response.ok)throw new AppError(502,"AI_PROVIDER_ERROR",payload.error?.message||`${AI_PROVIDER_CATALOG[runtime.provider].label} request failed (${response.status})`);
    return payload;
  };
  let response=await call({instructions:system,input:input.messages.map(m=>({role:m.role,content:m.content})),tools,tool_choice:"auto",parallel_tool_calls:false});
  const toolEvents:Array<Record<string,unknown>>=[];
  for(let round=0;round<7;round++){
    const calls=(response.output||[]).filter(item=>item.type==="function_call"&&item.name&&item.call_id);
    if(!calls.length)return{text:textFromOpenAI(response)||"I could not produce a response.",model:runtime.model,provider:runtime.provider,providerResponseId:response.id||null,usage:response.usage||null,toolEvents};
    const outputs:Array<Record<string,unknown>>=[];
    for(const tc of calls){let args:unknown={};try{args=tc.arguments?JSON.parse(tc.arguments):{};}catch{}const execution=await logAndExecuteTool(input,tc.name!,args);outputs.push({type:"function_call_output",call_id:tc.call_id,output:JSON.stringify(execution.result)});toolEvents.push(execution.event);}
    response=await call({previous_response_id:response.id,input:outputs,tools,tool_choice:"auto",parallel_tool_calls:false});
  }
  return{text:textFromOpenAI(response)||"The agent reached its tool-call limit. Please narrow the request.",model:runtime.model,provider:runtime.provider,providerResponseId:response.id||null,usage:response.usage||null,toolEvents};
}

async function runChatCompletions(input:RunInput,runtime:Runtime,system:string,tools:ToolSpec[]){
  const label=AI_PROVIDER_CATALOG[runtime.provider].label;
  const messages:any[]=[{role:"system",content:system},...input.messages.map(m=>({role:m.role,content:chatContentText(m.content)}))];
  const toolEvents:Array<Record<string,unknown>>=[];let last:ChatCompletion={};
  for(let round=0;round<8;round++){
    const body:Record<string,unknown>={model:runtime.model,messages,max_tokens:runtime.config.maxOutputTokens};
    if(tools.length){body.tools=chatTools(tools);body.tool_choice="auto";}
    if(runtime.config.temperature!==null)body.temperature=runtime.config.temperature;
    if(runtime.config.topP!==null)body.top_p=runtime.config.topP;
    if(runtime.provider==="groq"&&runtime.config.reasoningEffort!=="default")body.reasoning_effort=runtime.config.reasoningEffort;
    const {payload,response}=await fetchJson<ChatCompletion>(`${runtime.baseUrl}/chat/completions`,{method:"POST",headers:providerHeaders(runtime),body:JSON.stringify(body)},runtime.config.timeoutMs);
    if(!response.ok)throw new AppError(502,"AI_PROVIDER_ERROR",`${label} request failed (${response.status}): ${payload.error?.message||JSON.stringify(payload).slice(0,500)}`);
    last=payload;const message=payload.choices?.[0]?.message;if(!message)throw new AppError(502,"AI_PROVIDER_ERROR",`${label} returned no assistant message.`);
    const calls=message.tool_calls||[];
    if(!calls.length)return{text:chatContentText(message.content).trim()||"I could not produce a response.",model:runtime.model,provider:runtime.provider,providerResponseId:payload.id||null,usage:payload.usage||null,toolEvents};
    messages.push({role:"assistant",content:chatContentText(message.content),tool_calls:calls});
    for(const tc of calls){const name=tc.function?.name;if(!name)continue;let args:unknown={};try{args=tc.function?.arguments?JSON.parse(tc.function.arguments):{};}catch{}const execution=await logAndExecuteTool(input,name,args);toolEvents.push(execution.event);messages.push({role:"tool",tool_call_id:tc.id,content:JSON.stringify(execution.result)});}
  }
  return{text:chatContentText(last.choices?.[0]?.message?.content).trim()||"The agent reached its tool-call limit. Please narrow the request.",model:runtime.model,provider:runtime.provider,providerResponseId:last.id||null,usage:last.usage||null,toolEvents};
}

async function runAnthropic(input:RunInput,runtime:Runtime,system:string,tools:ToolSpec[]){
  const messages:any[]=input.messages.map(m=>({role:m.role,content:m.content})),toolEvents:Array<Record<string,unknown>>=[];let last:AnthropicResponse={};
  for(let round=0;round<8;round++){
    const body:Record<string,unknown>={model:runtime.model,system,messages,max_tokens:runtime.config.maxOutputTokens};if(tools.length)body.tools=anthropicTools(tools);if(runtime.config.temperature!==null)body.temperature=runtime.config.temperature;else if(runtime.config.topP!==null)body.top_p=runtime.config.topP;
    const {payload,response}=await fetchJson<AnthropicResponse>(`${runtime.baseUrl}/messages`,{method:"POST",headers:{"x-api-key":runtime.apiKey,"anthropic-version":"2023-06-01","Content-Type":"application/json"},body:JSON.stringify(body)},runtime.config.timeoutMs);
    if(!response.ok)throw new AppError(502,"AI_PROVIDER_ERROR",payload.error?.message||`Anthropic Claude request failed (${response.status})`);last=payload;
    const calls=(payload.content||[]).filter(p=>p.type==="tool_use"&&p.id&&p.name);if(!calls.length)return{text:textFromAnthropic(payload)||"I could not produce a response.",model:runtime.model,provider:runtime.provider,providerResponseId:payload.id||null,usage:payload.usage||null,toolEvents};
    messages.push({role:"assistant",content:payload.content||[]});const results:any[]=[];
    for(const tc of calls){const execution=await logAndExecuteTool(input,tc.name!,tc.input||{});toolEvents.push(execution.event);results.push({type:"tool_result",tool_use_id:tc.id,content:JSON.stringify(execution.result)});}messages.push({role:"user",content:results});
  }
  return{text:textFromAnthropic(last)||"The agent reached its tool-call limit. Please narrow the request.",model:runtime.model,provider:runtime.provider,providerResponseId:last.id||null,usage:last.usage||null,toolEvents};
}

export async function testProviderConnection(db:D1Database,env:AiEnv,organizationId:string,tier:ModelTier="luna"){
  const runtime=await resolveRuntimeProvider(db,env,organizationId,tier),started=Date.now();
  if(runtime.apiStyle==="responses"){
    const {payload,response}=await fetchJson<OpenAiResponse>(`${runtime.baseUrl}/responses`,{method:"POST",headers:providerHeaders(runtime),body:JSON.stringify({model:runtime.model,input:"Reply with OK only.",max_output_tokens:32})},Math.min(runtime.config.timeoutMs,30000));
    if(!response.ok)throw new AppError(502,"AI_PROVIDER_ERROR",payload.error?.message||`${AI_PROVIDER_CATALOG[runtime.provider].label} request failed (${response.status})`);
  }else if(runtime.apiStyle==="chat-completions"){
    const {payload,response}=await fetchJson<ChatCompletion>(`${runtime.baseUrl}/chat/completions`,{method:"POST",headers:providerHeaders(runtime),body:JSON.stringify({model:runtime.model,messages:[{role:"user",content:"Reply with OK only."}],max_tokens:32})},Math.min(runtime.config.timeoutMs,30000));
    if(!response.ok)throw new AppError(502,"AI_PROVIDER_ERROR",payload.error?.message||`${AI_PROVIDER_CATALOG[runtime.provider].label} request failed (${response.status})`);
  }else{
    const {payload,response}=await fetchJson<AnthropicResponse>(`${runtime.baseUrl}/messages`,{method:"POST",headers:{"x-api-key":runtime.apiKey,"anthropic-version":"2023-06-01","Content-Type":"application/json"},body:JSON.stringify({model:runtime.model,max_tokens:32,messages:[{role:"user",content:"Reply with OK only."}]})},Math.min(runtime.config.timeoutMs,30000));
    if(!response.ok)throw new AppError(502,"AI_PROVIDER_ERROR",payload.error?.message||`Anthropic Claude request failed (${response.status})`);
  }
  return{ok:true,provider:runtime.provider,model:runtime.model,latencyMs:Date.now()-started};
}

export async function runAgent(input:RunInput){
  const runtime=await resolveRuntimeProvider(input.db,input.env,input.principal.organizationId,input.modelTier);
  const tools=openAiTools(input.agent,input.requestedTools) as ToolSpec[],memories=await memoryContext(input.db,input.principal.organizationId,input.agent.key),system=instructions(input.agent,memories);
  if(runtime.apiStyle==="chat-completions")return runChatCompletions(input,runtime,system,tools);
  if(runtime.apiStyle==="anthropic")return runAnthropic(input,runtime,system,tools);
  return runResponses(input,runtime,system,tools);
}
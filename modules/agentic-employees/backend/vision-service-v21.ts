import { AppError } from "../../../src/lib/errors";
import type { Env } from "../../../src/types";
import { resolveRuntimeProvider } from "./provider-config";

type AiEnv=Env&{AI_PROVIDER_ENCRYPTION_KEY?:string};

type ScanResult={ocrText:string;visionSummary:string;model:string;provider:string};

const PROMPT=`Read this school/business image carefully. Perform OCR on ALL visible text, including handwriting where legible. Preserve names, dates, amounts, table rows, headings and labels exactly. Then describe the visual structure such as tables, columns, form fields, signatures, ticks, stamps, lesson-plan fields and fee/payment fields. Do not invent unreadable values. Return plain text with two sections exactly: OCR TEXT: and VISUAL STRUCTURE:`;

function base64(bytes:Uint8Array){let binary="";for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));return btoa(binary);}
function splitVision(text:string){const marker="VISUAL STRUCTURE:",idx=text.indexOf(marker);return{ocrText:(idx>=0?text.slice(0,idx):text).replace(/^OCR TEXT:\s*/i,"").trim(),visionSummary:(idx>=0?text.slice(idx+marker.length):"").trim()};}
async function fetchJson(url:string,init:RequestInit,timeoutMs:number){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(url,{...init,signal:controller.signal}),payload=await response.json().catch(()=>({})) as any;return{response,payload};}catch(error){if(error instanceof Error&&error.name==="AbortError")throw new AppError(504,"VISION_PROVIDER_TIMEOUT","Image analysis timed out. Try fewer or smaller images.");throw error;}finally{clearTimeout(timer);}}
function openAiText(payload:any){if(typeof payload?.output_text==="string")return payload.output_text.trim();const parts:string[]=[];for(const item of payload?.output||[])for(const part of item?.content||[])if(part?.type==="output_text"&&part?.text)parts.push(part.text);return parts.join("\n").trim();}

export async function scanSchoolImage(db:D1Database,env:AiEnv,organizationId:string,mime:string,bytes:ArrayBuffer):Promise<ScanResult>{
 const runtime=await resolveRuntimeProvider(db,env,organizationId,"terra"),data=base64(new Uint8Array(bytes)),imageUrl=`data:${mime};base64,${data}`;
 let text="";
 if(runtime.provider==="openai"){
  const{response,payload}=await fetchJson(`${runtime.baseUrl}/responses`,{method:"POST",headers:{Authorization:`Bearer ${runtime.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:runtime.model,max_output_tokens:Math.min(runtime.config.maxOutputTokens,6000),input:[{role:"user",content:[{type:"input_text",text:PROMPT},{type:"input_image",image_url:imageUrl}]}]})},runtime.config.timeoutMs);
  if(!response.ok)throw new AppError(502,"VISION_PROVIDER_ERROR",payload?.error?.message||`OpenAI vision request failed (${response.status})`);text=openAiText(payload);
 }else if(runtime.provider==="google"){
  const{response,payload}=await fetchJson(`${runtime.baseUrl}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${runtime.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:runtime.model,max_tokens:Math.min(runtime.config.maxOutputTokens,6000),messages:[{role:"user",content:[{type:"text",text:PROMPT},{type:"image_url",image_url:{url:imageUrl}}]}]})},runtime.config.timeoutMs);
  if(!response.ok)throw new AppError(502,"VISION_PROVIDER_ERROR",payload?.error?.message||`Gemini vision request failed (${response.status})`);text=String(payload?.choices?.[0]?.message?.content||"").trim();
 }else{
  const{response,payload}=await fetchJson(`${runtime.baseUrl}/messages`,{method:"POST",headers:{"x-api-key":runtime.apiKey,"anthropic-version":"2023-06-01","Content-Type":"application/json"},body:JSON.stringify({model:runtime.model,max_tokens:Math.min(runtime.config.maxOutputTokens,6000),messages:[{role:"user",content:[{type:"image",source:{type:"base64",media_type:mime,data}},{type:"text",text:PROMPT}]}]})},runtime.config.timeoutMs);
  if(!response.ok)throw new AppError(502,"VISION_PROVIDER_ERROR",payload?.error?.message||`Claude vision request failed (${response.status})`);text=(payload?.content||[]).filter((x:any)=>x?.type==="text").map((x:any)=>x.text).join("\n").trim();
 }
 if(!text)throw new AppError(502,"VISION_EMPTY_RESPONSE","The AI provider returned no image analysis.");
 return{...splitVision(text),model:runtime.model,provider:runtime.provider};
}

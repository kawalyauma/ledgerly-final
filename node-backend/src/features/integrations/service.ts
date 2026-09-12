import { createHash, createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { ClaimedJob } from "../../queue/postgres-queue.js";
import type { Runtime } from "../../runtime.js";
import { createId } from "../core-identity/security.js";

export function sha256Hex(value:string){return createHash("sha256").update(value).digest("hex");}
export function newWebhookSecret(){return `whsec_${randomBytes(32).toString("base64url")}`;}
export function webhookSignature(secretHash:string,timestamp:string,payload:string){return createHmac("sha256",secretHash).update(`${timestamp}.${payload}`).digest("hex");}

function privateIpv4(host:string){const parts=host.split(".").map(Number);if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))return false;const a=parts[0]!,b=parts[1]!;return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168);}

export function isSafeWebhookUrl(raw:string){
  let url:URL;try{url=new URL(raw);}catch{return false;}
  if(url.protocol!=="https:"||url.username||url.password)return false;
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,"");
  if(!host||host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal")||host==="metadata.google.internal")return false;
  const family=isIP(host);
  if(family===4&&privateIpv4(host))return false;
  if(family===6&&(host==="::1"||host.startsWith("fc")||host.startsWith("fd")||host.startsWith("fe8")||host.startsWith("fe9")||host.startsWith("fea")||host.startsWith("feb")))return false;
  return true;
}

export async function publishWebhookEvent(runtime:Runtime,organizationId:string,eventType:string,data:unknown,eventId=createId("evt")){
  const endpoints=(await runtime.db.query<{id:string;events:string[]}>(`SELECT id,events FROM webhook_endpoints WHERE organization_id=$1 AND active=true`,[organizationId])).rows;
  const payload={id:eventId,type:eventType,createdAt:new Date().toISOString(),organizationId,data};
  const deliveryIds:string[]=[];
  for(const endpoint of endpoints){if(!endpoint.events.includes(eventType)&&!endpoint.events.includes("*"))continue;const deliveryId=createId("whd");const inserted=await runtime.db.query(`INSERT INTO webhook_deliveries(id,organization_id,endpoint_id,event_type,event_id,payload,status) VALUES($1,$2,$3,$4,$5,$6::jsonb,'queued') ON CONFLICT(organization_id,endpoint_id,event_id) DO NOTHING RETURNING id`,[deliveryId,organizationId,endpoint.id,eventType,eventId,JSON.stringify(payload)]);if(!inserted.rowCount)continue;try{const queueJobId=await runtime.queue.publish("webhook.deliver",{deliveryId,organizationId},{queue:"webhooks",maxAttempts:8});await runtime.db.query(`UPDATE webhook_deliveries SET queue_job_id=$1 WHERE id=$2`,[queueJobId,deliveryId]);deliveryIds.push(deliveryId);}catch(error){await runtime.db.query(`UPDATE webhook_deliveries SET status='failed',error=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[error instanceof Error?error.message:String(error),deliveryId]);throw error;}}
  return {eventId,deliveryIds};
}

export async function handleWebhookDelivery(job:ClaimedJob,runtime:Runtime):Promise<void>{
  const payload=job.payload as {deliveryId?:string;organizationId?:string};if(!payload.deliveryId||!payload.organizationId)throw new Error("webhook.deliver is missing delivery identifiers");
  const delivery=(await runtime.db.query<{payload:unknown;url:string;secretHash:string;active:boolean;status:string;endpointId:string}>(`SELECT d.payload,e.url,e.secret_hash AS "secretHash",e.active,d.status,d.endpoint_id AS "endpointId" FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id=d.endpoint_id AND e.organization_id=d.organization_id WHERE d.id=$1 AND d.organization_id=$2`,[payload.deliveryId,payload.organizationId])).rows[0];
  if(!delivery||!delivery.active||delivery.status==="delivered")return;
  if(!isSafeWebhookUrl(delivery.url))throw new Error("Webhook destination is no longer allowed");
  const body=JSON.stringify(delivery.payload),timestamp=String(Math.floor(Date.now()/1000)),signature=webhookSignature(delivery.secretHash,timestamp,body);
  await runtime.db.query(`UPDATE webhook_deliveries SET status='delivering',attempts=$1,last_attempt_at=CURRENT_TIMESTAMP,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[job.attempts,payload.deliveryId]);
  try{
    const response=await fetch(delivery.url,{method:"POST",redirect:"error",headers:{"Content-Type":"application/json","User-Agent":"Ledgerly-Node-Webhooks/1.0","X-YFP-Timestamp":timestamp,"X-YFP-Signature":`v1=${signature}`},body,signal:AbortSignal.timeout(15_000)});
    const responseBody=(await response.text()).slice(0,2000);
    if(!response.ok)throw new Error(`HTTP ${response.status}: ${responseBody.slice(0,300)}`);
    await runtime.db.query(`UPDATE webhook_deliveries SET status='delivered',attempts=$1,response_status=$2,response_body=$3,error=NULL,delivered_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$4`,[job.attempts,response.status,responseBody,payload.deliveryId]);
    await runtime.db.query(`UPDATE webhook_endpoints SET failure_count=0,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`,[delivery.endpointId,payload.organizationId]);
  }catch(error){await runtime.db.query(`UPDATE webhook_deliveries SET status='failed',attempts=$1,error=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3`,[job.attempts,error instanceof Error?error.message:String(error),payload.deliveryId]);await runtime.db.query(`UPDATE webhook_endpoints SET failure_count=failure_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2`,[delivery.endpointId,payload.organizationId]);throw error;}
}

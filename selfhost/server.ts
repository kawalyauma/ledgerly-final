import { serve } from "@hono/node-server";
import { app } from "../src/index";
import { backendModules } from "../modules/backend-registry.generated";
import type { Env } from "../src/types";
import { loadSelfhostConfig } from "./config";
import { PostgresD1Database } from "./postgres-d1";
import { LocalR2Bucket } from "./local-bucket";
import { PostgresQueue } from "./postgres-queue";
import { createAgentDocumentService } from "./document-service";

const cfg=loadSelfhostConfig(),db=new PostgresD1Database(cfg.DATABASE_URL),bucket=new LocalR2Bucket(cfg.LEDGERLY_STORAGE_DIR);
const queue=(name:string)=>new PostgresQueue(db,name) as any;
const env:Env={FINANCE_DB:db as any,REPORTS_BUCKET:bucket as any,WORK_FILES_BUCKET:bucket as any,REPORT_QUEUE:queue("finance-report-jobs"),WEBHOOK_QUEUE:queue("finance-webhook-jobs"),WORK_NOTIFICATION_QUEUE:queue("work-notifications"),COMMUNICATION_QUEUE:queue("communications"),ENVIRONMENT:cfg.ENVIRONMENT,JWT_SECRET:cfg.JWT_SECRET,JWT_ISSUER:cfg.JWT_ISSUER,JWT_AUDIENCE:cfg.JWT_AUDIENCE,OPENAI_API_KEY:cfg.OPENAI_API_KEY,OPENAI_BASE_URL:cfg.OPENAI_BASE_URL,OPENAI_MODEL_LUNA:cfg.OPENAI_MODEL_LUNA,OPENAI_MODEL_TERRA:cfg.OPENAI_MODEL_TERRA,OPENAI_MODEL_SOL:cfg.OPENAI_MODEL_SOL,WHATSAPP_SUPPORT_HUB_URL:cfg.WHATSAPP_SUPPORT_HUB_URL,WHATSAPP_SUPPORT_APP_KEY:cfg.WHATSAPP_SUPPORT_APP_KEY,WHATSAPP_SUPPORT_WEBHOOK_SECRET:cfg.WHATSAPP_SUPPORT_WEBHOOK_SECRET,EGOSMS_API_URL:cfg.EGOSMS_API_URL,EGOSMS_USERNAME:cfg.EGOSMS_USERNAME,EGOSMS_PASSWORD:cfg.EGOSMS_PASSWORD,EGOSMS_SENDER_ID:cfg.EGOSMS_SENDER_ID,RESEND_API_KEY:cfg.RESEND_API_KEY,RESEND_FROM_EMAIL:cfg.RESEND_FROM_EMAIL,BIOMETRIC_ENCRYPTION_KEY:cfg.BIOMETRIC_ENCRYPTION_KEY,AGENT_DOCUMENT_SERVICE:createAgentDocumentService(bucket as any),SELFHOST_RUNTIME:"postgresql"};
await db.pool.query(`CREATE TABLE IF NOT EXISTS selfhost_queue_jobs(id TEXT PRIMARY KEY,queue_name TEXT NOT NULL,payload_json JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'queued',available_at TIMESTAMPTZ NOT NULL DEFAULT now(),attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),completed_at TIMESTAMPTZ)`);
const handler=(request:Request)=>app.fetch(request,env as any);
const server=serve({fetch:handler,hostname:cfg.LEDGERLY_HOST,port:cfg.LEDGERLY_PORT});
console.info(JSON.stringify({level:"info",message:"Ledgerly Final self-host API listening",host:cfg.LEDGERLY_HOST,port:cfg.LEDGERLY_PORT,database:"postgresql",storage:"filesystem"}));
let running=false;const tick=async()=>{if(running)return;running=true;try{for(const module of backendModules)if(module.key==="agentic-employees"&&module.scheduled)await module.scheduled(env as any);}catch(error){console.error(JSON.stringify({level:"error",message:"Agentic Employees scheduled tick failed",error:error instanceof Error?error.message:String(error)}));}finally{running=false;}};const timer=setInterval(()=>void tick(),60_000);timer.unref();void tick();
const shutdown=async(signal:string)=>{console.info(JSON.stringify({level:"info",message:"Stopping Ledgerly Final self-host API",signal}));clearInterval(timer);server.close();await db.close();process.exit(0);};process.once("SIGTERM",()=>void shutdown("SIGTERM"));process.once("SIGINT",()=>void shutdown("SIGINT"));

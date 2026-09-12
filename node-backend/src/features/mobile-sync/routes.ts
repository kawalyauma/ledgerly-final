import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../../http/errors.js";
import type { AppEnv } from "../../http/types.js";
import type { Runtime } from "../../runtime.js";
import { acknowledgeBootstrap, acknowledgePull, acknowledgeSchemas, bootstrap, eligibleCollections, mobileSyncManifest, pull, push, recoveryState } from "./sync.js";
import { exchangeOfflineGrant, listDevices, registerDevice, revokeDevice } from "./device.js";

const id=z.string().trim().min(8).max(160);
const registration=z.object({installationId:z.string().trim().min(16).max(128),deviceName:z.string().trim().min(1).max(120),platform:z.enum(["android","ios"]),appVersion:z.string().trim().min(1).max(40),clientSchemaVersion:z.number().int().positive(),deviceModel:z.string().trim().max(120).nullable().optional(),osVersion:z.string().trim().max(80).nullable().optional()});
const dependency=z.union([z.object({operationId:id}),z.object({moduleKey:z.string().trim().min(1).max(80),collectionKey:z.string().trim().min(1).max(80),recordId:id,minVersion:z.number().int().nonnegative().optional()})]);
const mutation=z.object({operationId:id,sequence:z.number().int().positive(),moduleKey:z.string().trim().min(1).max(80),collectionKey:z.string().trim().min(1).max(80),recordId:id,kind:z.enum(["upsert","delete"]),schemaVersion:z.number().int().positive(),baseVersion:z.number().int().nonnegative(),clientTimestamp:z.string().trim().min(10).max(64),payload:z.unknown().optional(),dependencies:z.array(dependency).max(50).default([])});
const pushBody=z.object({deviceId:id,batchId:id,protocolVersion:z.number().int().positive(),operations:z.array(mutation).min(1).max(250)});
const collection=z.object({moduleKey:z.string().trim().min(1).max(80),collectionKey:z.string().trim().min(1).max(80)});
const pullBody=z.object({deviceId:id,requestId:id,protocolVersion:z.number().int().positive(),collections:z.array(collection.extend({limit:z.number().int().positive().max(1000).optional()})).min(1).max(100)});
const bootstrapBody=z.object({deviceId:id,protocolVersion:z.number().int().positive(),collections:z.array(collection).min(1).max(100)});
const schemasBody=z.object({deviceId:id,schemas:z.array(collection.extend({schemaVersion:z.number().int().positive()})).min(1).max(100)});
const ackPullBody=z.object({deviceId:id,acknowledgements:z.array(z.object({deliveryId:id,cursor:z.number().int().nonnegative()})).min(1).max(100)});
const ackBootstrapBody=z.object({deviceId:id,bootstrapId:id});
const exchangeBody=z.object({deviceId:id,offlineGrant:z.string().trim().min(32).max(512),appVersion:z.string().trim().min(1).max(40).optional(),clientSchemaVersion:z.number().int().positive().optional()});

async function json<T extends z.ZodTypeAny>(c:any,schema:T):Promise<z.infer<T>>{const parsed=schema.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid mobile synchronization request",parsed.error.flatten());return parsed.data;}

export function createMobileSyncRoutes(runtime:Runtime){const r=new Hono<AppEnv>();
 r.get("/manifest",c=>c.json({data:mobileSyncManifest()}));
 r.get("/eligible/:deviceId",async c=>{const p=c.get("principal"),deviceId=c.req.param("deviceId");return c.json({data:{deviceId,collections:await eligibleCollections(runtime,p,deviceId)}});});
 r.post("/devices",async c=>c.json({data:await registerDevice(runtime,c.get("principal"),await json(c,registration))},201));
 r.get("/devices",async c=>c.json({data:await listDevices(runtime,c.get("principal"))}));
 r.post("/devices/:id/revoke",async c=>{const body=await c.req.json<{reason?:string}>().catch(()=>({}));return c.json({data:await revokeDevice(runtime,c.get("principal"),c.req.param("id"),String(body.reason??"").trim()||undefined)});});
 r.post("/schemas/ack",async c=>c.json({data:await acknowledgeSchemas(runtime,c.get("principal"),await json(c,schemasBody))}));
 r.post("/bootstrap",async c=>c.json({data:await bootstrap(runtime,c.get("principal"),await json(c,bootstrapBody))}));
 r.post("/bootstrap/ack",async c=>c.json({data:await acknowledgeBootstrap(runtime,c.get("principal"),await json(c,ackBootstrapBody))}));
 r.post("/push",async c=>c.json({data:await push(runtime,c.get("principal"),await json(c,pushBody))}));
 r.post("/pull",async c=>c.json({data:await pull(runtime,c.get("principal"),await json(c,pullBody))}));
 r.post("/pull/ack",async c=>c.json({data:await acknowledgePull(runtime,c.get("principal"),await json(c,ackPullBody))}));
 r.get("/recovery/:deviceId",async c=>c.json({data:await recoveryState(runtime,c.get("principal"),c.req.param("deviceId"),c.req.query("batchId"))}));
 return r;}

export function createMobileSyncPublicRoutes(runtime:Runtime){const r=new Hono<AppEnv>();r.post("/exchange",async c=>{const parsed=exchangeBody.safeParse(await c.req.json().catch(()=>null));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid offline grant exchange request",parsed.error.flatten());return c.json({data:await exchangeOfflineGrant(runtime,parsed.data)});});return r;}

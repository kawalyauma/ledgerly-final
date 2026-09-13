import { randomUUID } from "node:crypto";

export class PostgresQueue{
 constructor(private db:any,private queueName:string){}
 async send(body:unknown,options:any={}){const id=`sq_${randomUUID().replaceAll("-","")}`,delay=Math.max(0,Number(options?.delaySeconds||0));await this.db.pool.query(`INSERT INTO selfhost_queue_jobs(id,queue_name,payload_json,status,available_at,created_at) VALUES($1,$2,$3::jsonb,'queued',CURRENT_TIMESTAMP+($4::text||' seconds')::interval,CURRENT_TIMESTAMP)`,[id,this.queueName,JSON.stringify(body??null),delay]);return{id};}
 async sendBatch(messages:any[]){for(const item of messages)await this.send(item.body??item,item);}
}

type Handler=(batch:any)=>Promise<void>;
export async function drainPostgresQueue(db:any,queueName:string,handler:Handler,limit=25){
 const client=await db.pool.connect();let rows:any[]=[];
 try{await client.query("BEGIN");const selected=await client.query(`SELECT id,payload_json,attempts,created_at FROM selfhost_queue_jobs WHERE queue_name=$1 AND status='queued' AND available_at<=CURRENT_TIMESTAMP ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT $2`,[queueName,limit]);rows=selected.rows;for(const row of rows)await client.query("UPDATE selfhost_queue_jobs SET status='processing',attempts=attempts+1 WHERE id=$1",[row.id]);await client.query("COMMIT");}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
 if(!rows.length)return 0;
 const decisions=new Map<string,{retry:boolean;delaySeconds:number}>();
 const messages=rows.map(row=>({id:row.id,timestamp:new Date(row.created_at),body:row.payload_json,attempts:Number(row.attempts||0)+1,ack(){decisions.set(row.id,{retry:false,delaySeconds:0});},retry(options:any={}){decisions.set(row.id,{retry:true,delaySeconds:Math.max(1,Number(options?.delaySeconds||30))});}}));
 let handlerError:unknown=null;try{await handler({queue:queueName,messages});}catch(error){handlerError=error;}
 for(const row of rows){const decision=decisions.get(row.id),attempts=Number(row.attempts||0)+1,retry=Boolean(handlerError)||decision?.retry;if(retry&&attempts<6){const delay=decision?.delaySeconds||Math.min(900,30*2**Math.max(0,attempts-1));await db.pool.query("UPDATE selfhost_queue_jobs SET status='queued',available_at=CURRENT_TIMESTAMP+($2::text||' seconds')::interval,last_error=$3 WHERE id=$1",[row.id,delay,handlerError instanceof Error?handlerError.message:String(handlerError||"")]);}else if(retry){await db.pool.query("UPDATE selfhost_queue_jobs SET status='failed',completed_at=CURRENT_TIMESTAMP,last_error=$2 WHERE id=$1",[row.id,handlerError instanceof Error?handlerError.message:String(handlerError||"retry limit reached")]);}else await db.pool.query("UPDATE selfhost_queue_jobs SET status='completed',completed_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=$1",[row.id]);}
 if(handlerError)throw handlerError;return rows.length;
}

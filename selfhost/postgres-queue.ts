import { randomUUID } from "node:crypto";
export class PostgresQueue{
 constructor(private db:any,private queueName:string){}
 async send(body:unknown,options:any={}){const id=`sq_${randomUUID().replaceAll("-","")}`;await this.db.pool.query(`INSERT INTO selfhost_queue_jobs(id,queue_name,payload_json,status,available_at,created_at) VALUES($1,$2,$3::jsonb,'queued',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,[id,this.queueName,JSON.stringify(body??null)]);return{id};}
 async sendBatch(messages:any[]){for(const item of messages)await this.send(item.body??item,item);}
}

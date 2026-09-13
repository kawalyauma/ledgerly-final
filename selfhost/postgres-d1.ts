import pg from "pg";
const {Pool}=pg;

type BoundStatement={sql:string;values:unknown[]};
function placeholders(sql:string){let n=0,out="",quote="";for(let i=0;i<sql.length;i++){const c=sql[i];if(quote){out+=c;if(c===quote&&sql[i-1]!=="\\")quote="";continue;}if(c==="'"||c==='"'){quote=c;out+=c;continue;}if(c==="?"){n++;out+=`$${n}`;}else out+=c;}return out;}
function sqliteFunctions(sql:string){return sql
 .replace(/datetime\('now'\s*,\s*'([+-])(\d+)\s+(minute|minutes|hour|hours|day|days)'\)/gi,(_,sign,n,unit)=>`(CURRENT_TIMESTAMP ${sign} INTERVAL '${n} ${unit}')`)
 .replace(/date\('now'\s*,\s*'([+-])(\d+)\s+(day|days|month|months|year|years)'\)/gi,(_,sign,n,unit)=>`(CURRENT_DATE ${sign} INTERVAL '${n} ${unit}')::date`)
 .replace(/datetime\('now'\)/gi,"CURRENT_TIMESTAMP")
 .replace(/date\('now'\)/gi,"CURRENT_DATE")
 .replace(/datetime\(CURRENT_TIMESTAMP\s*,\s*(\$\d+)\)/gi,(_m,p)=>`(CURRENT_TIMESTAMP + ${p}::interval)`)
 .replace(/IFNULL\(/gi,"COALESCE(")
 .replace(/\s+COLLATE\s+NOCASE/gi,"");}
function normalizeInsertIgnore(sql:string){if(!/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql))return sql;let next=sql.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i,"INSERT INTO");if(/\bON\s+CONFLICT\b/i.test(next))return next;const returning=next.match(/\s+RETURNING\s+[\s\S]+$/i);if(returning){next=next.slice(0,returning.index)+" ON CONFLICT DO NOTHING"+returning[0];}else next=next.replace(/;?\s*$/," ON CONFLICT DO NOTHING");return next;}
function translate(sql:string){return normalizeInsertIgnore(sqliteFunctions(placeholders(sql)));}

class PgD1Statement{
  constructor(private db:PostgresD1Database,public sql:string,public values:unknown[]=[]){ }
  bind(...values:unknown[]){return new PgD1Statement(this.db,this.sql,values);}
  bound():BoundStatement{return{sql:translate(this.sql),values:this.values};}
  async first<T=Record<string,unknown>>(column?:string):Promise<T|null>{const q=this.bound(),r=await this.db.pool.query(q.sql,q.values);const row=r.rows[0]??null;if(row==null)return null;return (column?row[column]:row) as T;}
  async all<T=Record<string,unknown>>(){const q=this.bound(),r=await this.db.pool.query(q.sql,q.values);return{success:true,results:r.rows as T[],meta:{changes:r.rowCount??0}};}
  async run(){const q=this.bound(),r=await this.db.pool.query(q.sql,q.values);return{success:true,meta:{changes:r.rowCount??0,duration:0,last_row_id:null}};}
}

export class PostgresD1Database{
  pool:pg.Pool;
  constructor(connectionString:string){this.pool=new Pool({connectionString,max:20,application_name:"ledgerly-final-selfhost"});}
  prepare(sql:string){return new PgD1Statement(this,sql);}
  async batch(statements:PgD1Statement[]){const client=await this.pool.connect();try{await client.query("BEGIN");const out=[];for(const statement of statements){const q=statement.bound(),r=await client.query(q.sql,q.values);out.push({success:true,results:r.rows,meta:{changes:r.rowCount??0}});}await client.query("COMMIT");return out;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
  async exec(sql:string){await this.pool.query(sql);return{count:0,duration:0};}
  async health(){const r=await this.pool.query("SELECT 1 AS ok");return r.rows[0]?.ok===1;}
  async close(){await this.pool.end();}
}

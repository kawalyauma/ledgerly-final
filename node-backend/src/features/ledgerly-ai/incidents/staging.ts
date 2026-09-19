import { createHash } from "node:crypto";
import path from "node:path";
import type { LedgerlyAiConfig } from "../config.js";
import { requireIncidentCommand, runIncidentCommand } from "./command.js";

export type IncidentStagingDeployment={
  projectKey:string;
  imageTag:string;
  network:string;
  containers:{postgres:string;redis:string;api:string};
  smoke:Record<string,unknown>;
};

function keyFor(incidentId:string){
  return createHash("sha256").update(incidentId).digest("hex").slice(0,12);
}

export class IncidentStagingManager{
  constructor(private readonly config:LedgerlyAiConfig){}

  private names(incidentId:string){
    const key=keyFor(incidentId);
    return{
      projectKey:"lai-stg-"+key,
      imageTag:"ledgerly-ai-staging:"+key,
      network:"lai-stg-net-"+key,
      postgres:"lai-stg-pg-"+key,
      redis:"lai-stg-redis-"+key,
      api:"lai-stg-api-"+key,
      password:createHash("sha256").update("pg:"+incidentId).digest("hex").slice(0,24),
      jwt:"lai-staging-"+createHash("sha256").update("jwt:"+incidentId).digest("hex"),
    };
  }

  private docker(args:string[],cwd:string,timeoutMs=120_000,maxBytes=1024*1024){
    return requireIncidentCommand({
      command:this.config.LEDGERLY_AI_DOCKER_BIN,args,cwd,timeoutMs,maxBytes,
    },"Docker staging operation");
  }

  async rollback(incidentId:string,workspace:string,removeImage=false){
    const n=this.names(incidentId);
    for(const container of [n.api,n.redis,n.postgres]){
      await runIncidentCommand({
        command:this.config.LEDGERLY_AI_DOCKER_BIN,args:["rm","-f",container],
        cwd:workspace,timeoutMs:60_000,maxBytes:128*1024,
      }).catch(()=>undefined);
    }
    await runIncidentCommand({
      command:this.config.LEDGERLY_AI_DOCKER_BIN,args:["network","rm",n.network],
      cwd:workspace,timeoutMs:60_000,maxBytes:128*1024,
    }).catch(()=>undefined);
    if(removeImage){
      await runIncidentCommand({
        command:this.config.LEDGERLY_AI_DOCKER_BIN,args:["image","rm","-f",n.imageTag],
        cwd:workspace,timeoutMs:120_000,maxBytes:256*1024,
      }).catch(()=>undefined);
    }
    return{projectKey:n.projectKey,rolledBack:true};
  }

  async deploy(incidentId:string,workspace:string):Promise<IncidentStagingDeployment>{
    const n=this.names(incidentId);
    await this.rollback(incidentId,workspace,false);
    const backend=path.join(workspace,"node-backend");
    await this.docker(
      ["build","-t",n.imageTag,"."],
      backend,
      Math.max(this.config.LEDGERLY_AI_JOB_TIMEOUT_MS,900_000),
      4*1024*1024,
    );
    await this.docker(["network","create","--internal",n.network],workspace,60_000);
    try{
      await this.docker([
        "run","-d","--name",n.postgres,"--network",n.network,
        "-e","POSTGRES_DB=ledgerly",
        "-e","POSTGRES_USER=ledgerly",
        "-e","POSTGRES_PASSWORD="+n.password,
        "postgres:17-alpine",
      ],workspace,120_000);
      await this.docker([
        "run","-d","--name",n.redis,"--network",n.network,
        "redis:8-alpine","redis-server","--appendonly","no",
      ],workspace,120_000);

      let postgresReady=false;
      for(let attempt=0;attempt<30;attempt+=1){
        const check=await runIncidentCommand({
          command:this.config.LEDGERLY_AI_DOCKER_BIN,
          args:["exec",n.postgres,"pg_isready","-U","ledgerly","-d","ledgerly"],
          cwd:workspace,timeoutMs:10_000,maxBytes:64*1024,
        }).catch(()=>null);
        if(check?.exitCode===0){postgresReady=true;break;}
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      if(!postgresReady)throw new Error("Staging PostgreSQL did not become ready.");

      const commonEnv=[
        "-e","NODE_ENV=production",
        "-e",`DATABASE_URL=postgresql://ledgerly:${n.password}@${n.postgres}:5432/ledgerly`,
        "-e",`REDIS_URL=redis://${n.redis}:6379`,
        "-e","STORAGE_DRIVER=local",
        "-e","STORAGE_LOCAL_ROOT=/tmp/ledgerly-storage",
        "-e","JWT_SECRET="+n.jwt,
        "-e","JWT_ISSUER=your-finance-pro",
        "-e","JWT_AUDIENCE=your-finance-pro-api",
        "-e","CORS_ORIGINS=http://localhost",
        "-e","LEDGERLY_AI_ENABLED=false",
        "-e","LEDGERLY_AI_STARTUP_HEALTHCHECK=false",
      ];
      await this.docker([
        "run","--rm","--network",n.network,...commonEnv,n.imageTag,
        "node","dist/db/migrate.js",
      ],workspace,Math.max(this.config.LEDGERLY_AI_JOB_TIMEOUT_MS,600_000),2*1024*1024);

      await this.docker([
        "run","-d","--name",n.api,"--network",n.network,...commonEnv,
        "-e","PORT=8080",
        n.imageTag,"node","dist/server.js",
      ],workspace,120_000);

      let smoke:Record<string,unknown>|null=null;
      let lastError="";
      const script=[
        "const live=await fetch('http://127.0.0.1:8080/system/live');",
        "const health=await fetch('http://127.0.0.1:8080/system/health');",
        "const a=await live.json();const b=await health.json();",
        "console.log(JSON.stringify({liveStatus:live.status,healthStatus:health.status,live:a,health:b}));",
        "if(!live.ok||!health.ok)process.exit(2);",
      ].join("");
      for(let attempt=0;attempt<30;attempt+=1){
        const result=await runIncidentCommand({
          command:this.config.LEDGERLY_AI_DOCKER_BIN,
          args:["exec",n.api,"node","--input-type=module","-e",script],
          cwd:workspace,timeoutMs:20_000,maxBytes:512*1024,
        }).catch(error=>({exitCode:1,stdout:"",stderr:String(error),durationMs:0,timedOut:false}));
        if(result.exitCode===0){
          try{smoke=JSON.parse(result.stdout.trim()) as Record<string,unknown>;}catch{smoke={raw:result.stdout.trim()};}
          break;
        }
        lastError=result.stderr||result.stdout;
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      if(!smoke)throw new Error("Staging API smoke check failed: "+lastError.slice(-2000));
      return{
        projectKey:n.projectKey,imageTag:n.imageTag,network:n.network,
        containers:{postgres:n.postgres,redis:n.redis,api:n.api},
        smoke,
      };
    }catch(error){
      await this.rollback(incidentId,workspace,false);
      throw error;
    }
  }
}

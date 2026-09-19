import os from "node:os";
import { statfs } from "node:fs/promises";
import type { AuthPrincipal } from "../../../http/types.js";
import { AppError } from "../../../http/errors.js";
import type { Runtime } from "../../../runtime.js";
import { createId } from "../../core-identity/security.js";
import type { LedgerlyAiConfig } from "../config.js";
import type { LedgerlyAiIncidentService } from "../incidents/service.js";
import type { LedgerlyAiGitService } from "../git/service.js";
import { runIncidentCommand } from "../incidents/command.js";
import type { LedgerlyAiRiskLevel } from "../types.js";

type MonitorType="database"|"queue"|"docker"|"resources"|"deployment"|"ci"|"application";
type MonitorStatus="ok"|"warning"|"critical"|"unknown";
type SampleInput={
  organizationId?:string|null;
  monitorType:MonitorType;
  sampleKey:string;
  status:MonitorStatus;
  message?:string|null;
  metrics?:Record<string,unknown>;
};
type SummaryPeriod="daily"|"weekly";

function severityForStatus(status:MonitorStatus):LedgerlyAiRiskLevel{
  return status==="critical"?"critical":status==="warning"?"medium":"low";
}
function pct(used:number,total:number){
  return total>0?Math.round((used/total)*10000)/100:0;
}
function isAdmin(principal:AuthPrincipal){
  return principal.role==="owner"||principal.role==="admin";
}
function numeric(value:unknown){
  const result=Number(value??0);
  return Number.isFinite(result)?result:0;
}

export class LedgerlyAiMonitoringService{
  constructor(
    private readonly runtime:Runtime,
    private readonly config:LedgerlyAiConfig,
    private readonly incidents:LedgerlyAiIncidentService,
    private readonly git:LedgerlyAiGitService,
  ){}

  private async sample(input:SampleInput){
    await this.runtime.db.query(
      "INSERT INTO lai_monitor_samples(id,organization_id,monitor_type,sample_key,status,message,metrics_json)"+
      " VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
      [
        createId("laims"),input.organizationId??null,input.monitorType,input.sampleKey,input.status,
        input.message?.slice(0,1000)??null,JSON.stringify(input.metrics??{}),
      ],
    );
  }

  private async state(key:string){
    const result=await this.runtime.db.query<{value:Record<string,unknown>}>(
      'SELECT value_json AS "value" FROM lai_monitor_state WHERE state_key=$1 LIMIT 1',[key],
    );
    return result.rows[0]?.value??null;
  }
  private async setState(key:string,value:Record<string,unknown>){
    await this.runtime.db.query(
      "INSERT INTO lai_monitor_state(state_key,value_json,updated_at) VALUES($1,$2::jsonb,CURRENT_TIMESTAMP)"+
      " ON CONFLICT(state_key) DO UPDATE SET value_json=EXCLUDED.value_json,updated_at=CURRENT_TIMESTAMP",
      [key,JSON.stringify(value)],
    );
  }

  private async signal(input:{
    source:string;message:string;title:string;severity:LedgerlyAiRiskLevel;
    moduleKey:string;code:string;context?:Record<string,unknown>;organizationId?:string|null;
  }){
    if(input.severity==="low")return null;
    return this.incidents.signal({
      organizationId:input.organizationId??null,
      source:input.source,
      signalType:"manual",
      message:input.message,
      title:input.title,
      code:input.code,
      moduleKey:input.moduleKey,
      severityHint:input.severity,
      context:input.context??{},
    });
  }

  private async databaseCheck(){
    const started=performance.now();
    try{
      const stats=await this.runtime.db.query<{
        numbackends:number|string;xactCommit:number|string;xactRollback:number|string;
        blksRead:number|string;blksHit:number|string;deadlocks:number|string;
        tempFiles:number|string;tempBytes:number|string;dbSize:number|string;
      }>(
        "SELECT d.numbackends,d.xact_commit AS \"xactCommit\",d.xact_rollback AS \"xactRollback\","+
        " d.blks_read AS \"blksRead\",d.blks_hit AS \"blksHit\",d.deadlocks,d.temp_files AS \"tempFiles\","+
        " d.temp_bytes AS \"tempBytes\",pg_database_size(current_database()) AS \"dbSize\""+
        " FROM pg_stat_database d WHERE d.datname=current_database()",
      );
      const latencyMs=Math.round(performance.now()-started);
      const slow=await this.runtime.db.query<{count:number|string;maxMs:number|string|null}>(
        "SELECT COUNT(*)::int AS count,"+
        " MAX(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-query_start))*1000) AS \"maxMs\""+
        " FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()"+
        " AND state='active' AND query_start IS NOT NULL"+
        " AND CURRENT_TIMESTAMP-query_start>($1*INTERVAL '1 millisecond')",
        [this.config.LEDGERLY_AI_MONITOR_SLOW_QUERY_MS],
      );
      const row=stats.rows[0];
      const previous=await this.state("monitor:database:stats");
      const deadlocks=numeric(row?.deadlocks);
      const previousDeadlocks=numeric(previous?.deadlocks);
      const deadlockDelta=previous===null?0:Math.max(0,deadlocks-previousDeadlocks);
      const slowCount=numeric(slow.rows[0]?.count);
      const maxSlowMs=Math.round(numeric(slow.rows[0]?.maxMs));
      let status:MonitorStatus="ok";
      if(latencyMs>=this.config.LEDGERLY_AI_MONITOR_DB_CRITICAL_MS||deadlockDelta>0)status="critical";
      else if(latencyMs>=this.config.LEDGERLY_AI_MONITOR_DB_WARN_MS||slowCount>0)status="warning";
      const metrics={
        latencyMs,slowQueryCount:slowCount,maxSlowQueryMs:maxSlowMs,deadlockDelta,
        numBackends:numeric(row?.numbackends),deadlocks,
        xactCommit:numeric(row?.xactCommit),xactRollback:numeric(row?.xactRollback),
        blksRead:numeric(row?.blksRead),blksHit:numeric(row?.blksHit),
        tempFiles:numeric(row?.tempFiles),tempBytes:numeric(row?.tempBytes),dbSize:numeric(row?.dbSize),
      };
      await this.sample({
        monitorType:"database",sampleKey:"postgres",status,
        message:status==="ok"?"PostgreSQL operating within monitoring thresholds.":"PostgreSQL performance signal exceeded threshold.",
        metrics,
      });
      await this.setState("monitor:database:stats",{deadlocks,...metrics});
      if(status!=="ok"){
        await this.signal({
          source:"monitor.database",title:"PostgreSQL performance degradation",
          message:deadlockDelta>0?"PostgreSQL deadlock count increased.":"PostgreSQL latency or long-running query threshold exceeded.",
          severity:severityForStatus(status),moduleKey:"database",code:deadlockDelta>0?"DB_DEADLOCK_DELTA":"DB_PERFORMANCE_THRESHOLD",
          context:metrics,
        });
      }
      return{status,metrics};
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      await this.sample({
        monitorType:"database",sampleKey:"postgres",status:"critical",
        message:"PostgreSQL monitoring query failed.",metrics:{error:message.slice(0,1000)},
      });
      await this.incidents.signal({
        organizationId:null,source:"monitor.database",signalType:"health",
        message:"PostgreSQL connectivity/monitoring failed: "+message,
        title:"PostgreSQL connectivity failure",code:"DB_CONNECTIVITY_FAILURE",
        moduleKey:"database",severityHint:"critical",
      });
      return{status:"critical" as const,error:message};
    }
  }

  private async queueCheck(){
    try{
      const result=await this.runtime.db.query<{
        queued:number|string;running:number|string;dead:number|string;deadRecent:number|string;
        oldestQueuedSeconds:number|string|null;staleRunning:number|string;
      }>(
        "SELECT"+
        " COUNT(*) FILTER(WHERE status='queued')::int AS queued,"+
        " COUNT(*) FILTER(WHERE status='running')::int AS running,"+
        " COUNT(*) FILTER(WHERE status='dead')::int AS dead,"+
        " COUNT(*) FILTER(WHERE status='dead' AND updated_at>CURRENT_TIMESTAMP-INTERVAL '15 minutes')::int AS \"deadRecent\","+
        " EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-MIN(created_at) FILTER(WHERE status='queued'))) AS \"oldestQueuedSeconds\","+
        " COUNT(*) FILTER(WHERE status='running' AND locked_at<CURRENT_TIMESTAMP-INTERVAL '10 minutes')::int AS \"staleRunning\""+
        " FROM backend_jobs",
      );
      const row=result.rows[0];
      const metrics={
        queued:numeric(row?.queued),running:numeric(row?.running),dead:numeric(row?.dead),
        deadRecent:numeric(row?.deadRecent),oldestQueuedSeconds:Math.round(numeric(row?.oldestQueuedSeconds)),
        staleRunning:numeric(row?.staleRunning),
      };
      let status:MonitorStatus="ok";
      if(metrics.deadRecent>0||metrics.staleRunning>0||
         metrics.queued>=this.config.LEDGERLY_AI_MONITOR_QUEUE_CRITICAL||
         metrics.oldestQueuedSeconds>=900)status="critical";
      else if(metrics.queued>=this.config.LEDGERLY_AI_MONITOR_QUEUE_WARN||
              metrics.oldestQueuedSeconds>=300)status="warning";
      await this.sample({
        monitorType:"queue",sampleKey:"backend_jobs",status,
        message:status==="ok"?"Background jobs operating within thresholds.":"Background job queue requires attention.",
        metrics,
      });
      if(status!=="ok"){
        await this.signal({
          source:"monitor.queue",title:"Background job queue degradation",
          message:metrics.deadRecent>0?"One or more background jobs reached dead state.":"Background job backlog/staleness threshold exceeded.",
          severity:severityForStatus(status),moduleKey:"queue",
          code:metrics.deadRecent>0?"QUEUE_DEAD_JOBS":"QUEUE_BACKLOG_THRESHOLD",context:metrics,
        });
      }
      return{status,metrics};
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      await this.sample({monitorType:"queue",sampleKey:"backend_jobs",status:"critical",message:"Queue monitoring failed.",metrics:{error:message}});
      await this.signal({
        source:"monitor.queue",title:"Queue monitoring failure",message,
        severity:"high",moduleKey:"queue",code:"QUEUE_MONITOR_FAILURE",
      });
      return{status:"critical" as const,error:message};
    }
  }

  private async dockerCheck(){
    const expected=["api","queue","scheduler","postgres","redis"];
    try{
      const result=await runIncidentCommand({
        command:this.config.LEDGERLY_AI_DOCKER_BIN,
        args:["ps","-a","--format",'{{.Label "com.docker.compose.service"}}|{{.State}}|{{.Status}}|{{.Names}}'],
        cwd:this.config.LEDGERLY_AI_REPO_ROOT,timeoutMs:30_000,maxBytes:512*1024,
      });
      if(result.exitCode!==0)throw new Error(result.stderr||"docker ps failed");
      const services=new Map<string,{state:string;status:string;name:string}>();
      for(const line of result.stdout.split("\n").map(v=>v.trim()).filter(Boolean)){
        const [service,state,status,name]=line.split("|");
        if(service)services.set(service,{state:state||"",status:status||"",name:name||""});
      }
      const missing=expected.filter(name=>!services.has(name));
      const unhealthy=expected.filter(name=>{
        const item=services.get(name);
        return item&&item.state!=="running";
      });
      const metrics={
        expected,missing,unhealthy,
        services:Object.fromEntries([...services.entries()].filter(([name])=>expected.includes(name))),
      };
      const status:MonitorStatus=missing.length||unhealthy.length?"critical":"ok";
      await this.sample({
        monitorType:"docker",sampleKey:"core-services",status,
        message:status==="ok"?"Core Docker services are running.":"One or more core Docker services are missing or stopped.",
        metrics,
      });
      if(status!=="ok"){
        await this.signal({
          source:"monitor.docker",title:"Ledgerly service health degradation",
          message:"Core Docker service missing or stopped: "+[...missing,...unhealthy].join(", "),
          severity:"high",moduleKey:"platform",code:"DOCKER_SERVICE_UNHEALTHY",context:metrics,
        });
      }
      return{status,metrics};
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      await this.sample({monitorType:"docker",sampleKey:"core-services",status:"critical",message:"Docker health inspection failed.",metrics:{error:message}});
      await this.signal({
        source:"monitor.docker",title:"Docker health inspection failure",message,
        severity:"high",moduleKey:"platform",code:"DOCKER_MONITOR_FAILURE",
      });
      return{status:"critical" as const,error:message};
    }
  }

  private async diskUsage(target:string){
    const stats=await statfs(target,{bigint:true});
    const total=Number(stats.blocks*stats.bsize);
    const available=Number(stats.bavail*stats.bsize);
    const used=Math.max(0,total-available);
    return{target,totalBytes:total,availableBytes:available,usedBytes:used,usedPercent:pct(used,total)};
  }

  private async resourceCheck(){
    try{
      const disks=[];
      for(const target of [...new Set([this.config.LEDGERLY_AI_REPO_ROOT,this.config.LEDGERLY_AI_WORK_ROOT])]){
        try{disks.push(await this.diskUsage(target));}catch(error){
          disks.push({target,error:error instanceof Error?error.message:String(error),usedPercent:0});
        }
      }
      const totalMemory=os.totalmem(),freeMemory=os.freemem();
      const memoryUsedPercent=pct(totalMemory-freeMemory,totalMemory);
      const load=os.loadavg();
      const cpuCount=Math.max(1,os.availableParallelism());
      const maxDisk=Math.max(0,...disks.map(item=>numeric((item as any).usedPercent)));
      let status:MonitorStatus="ok";
      if(maxDisk>=this.config.LEDGERLY_AI_MONITOR_DISK_CRITICAL_PERCENT||
         memoryUsedPercent>=this.config.LEDGERLY_AI_MONITOR_MEMORY_CRITICAL_PERCENT||
         load[0]>=cpuCount*4)status="critical";
      else if(maxDisk>=this.config.LEDGERLY_AI_MONITOR_DISK_WARN_PERCENT||
              memoryUsedPercent>=this.config.LEDGERLY_AI_MONITOR_MEMORY_WARN_PERCENT||
              load[0]>=cpuCount*2)status="warning";
      const metrics={
        disks,totalMemory,freeMemory,memoryUsedPercent,
        load1:load[0],load5:load[1],load15:load[2],cpuCount,
        processRss:process.memoryUsage().rss,
      };
      await this.sample({
        monitorType:"resources",sampleKey:"host",status,
        message:status==="ok"?"Host resources operating within thresholds.":"Host resource threshold exceeded.",
        metrics,
      });
      if(status!=="ok"){
        await this.signal({
          source:"monitor.resources",title:"Ledgerly host resource pressure",
          message:maxDisk>=this.config.LEDGERLY_AI_MONITOR_DISK_WARN_PERCENT?
            "Ledgerly disk usage threshold exceeded.":"Ledgerly memory/load threshold exceeded.",
          severity:severityForStatus(status),moduleKey:"platform",code:"RESOURCE_THRESHOLD",context:metrics,
        });
      }
      return{status,metrics};
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      await this.sample({monitorType:"resources",sampleKey:"host",status:"unknown",message:"Resource monitoring failed.",metrics:{error:message}});
      return{status:"unknown" as const,error:message};
    }
  }

  private async deploymentCheck(){
    const release=process.env.GIT_COMMIT_SHA||process.env.RELEASE_SHA||process.env.SOURCE_VERSION||null;
    const previous=await this.state("monitor:deployment:release");
    const recent=await this.runtime.db.query<{
      failedStaging:number|string;unverifiedProduction:number|string;lastDeploymentAt:string|null;
    }>(
      "SELECT"+
      " COUNT(*) FILTER(WHERE environment='staging' AND status='failed' AND created_at>CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS \"failedStaging\","+
      " COUNT(*) FILTER(WHERE environment='production' AND status='deployed' AND deployed_at<CURRENT_TIMESTAMP-INTERVAL '30 minutes')::int AS \"unverifiedProduction\","+
      " MAX(deployed_at) AS \"lastDeploymentAt\" FROM lai_incident_deployments",
    );
    const metrics={
      release,previousRelease:typeof previous?.release==="string"?previous.release:null,
      changed:Boolean(release&&previous?.release&&release!==previous.release),
      failedStaging:numeric(recent.rows[0]?.failedStaging),
      unverifiedProduction:numeric(recent.rows[0]?.unverifiedProduction),
      lastDeploymentAt:recent.rows[0]?.lastDeploymentAt??null,
    };
    let status:MonitorStatus="ok";
    if(metrics.unverifiedProduction>0)status="critical";
    else if(metrics.failedStaging>0)status="warning";
    await this.sample({
      monitorType:"deployment",sampleKey:"release",status,
      message:metrics.changed?"Ledgerly release identifier changed.":status==="ok"?"No deployment anomaly detected.":"Deployment workflow requires attention.",
      metrics,
    });
    if(release)await this.setState("monitor:deployment:release",{release,observedAt:new Date().toISOString()});
    if(metrics.unverifiedProduction>0){
      await this.signal({
        source:"monitor.deployment",title:"Production deployment awaiting verification",
        message:"One or more production incident deployments remain unverified beyond 30 minutes.",
        severity:"high",moduleKey:"deployment",code:"DEPLOYMENT_UNVERIFIED",context:metrics,
      });
    }
    return{status,metrics};
  }

  private async ciCheck(){
    const sync=await this.git.syncOpenPullRequests();
    const result=await this.runtime.db.query<{
      id:string;organizationId:string|null;repository:string;externalNumber:number|null;headSha:string;
    }>(
      "SELECT id,organization_id AS \"organizationId\",repository,external_number AS \"externalNumber\",head_sha AS \"headSha\""+
      " FROM lai_git_pull_requests WHERE status='open' AND ci_state='failing' ORDER BY updated_at DESC LIMIT 100",
    );
    const failedChecks=await this.runtime.db.query<{count:number|string}>(
      "SELECT COUNT(*)::int AS count FROM lai_incident_checks"+
      " WHERE status='failed' AND created_at>CURRENT_TIMESTAMP-INTERVAL '15 minutes'",
    );
    const metrics={sync,failingPullRequests:result.rowCount,failedEngineeringChecks:numeric(failedChecks.rows[0]?.count)};
    const status:MonitorStatus=result.rowCount||metrics.failedEngineeringChecks?"warning":"ok";
    await this.sample({
      monitorType:"ci",sampleKey:"engineering",status,
      message:status==="ok"?"Engineering CI/build checks are healthy.":"Engineering CI/build failures detected.",
      metrics,
    });
    for(const pr of result.rows){
      await this.signal({
        organizationId:pr.organizationId,
        source:"monitor.ci",title:"Governed pull request CI failure",
        message:"Required CI checks are failing for a governed Ledgerly AI pull request.",
        severity:"medium",moduleKey:"ci",code:"CI_FAILED:"+pr.id,
        context:{pullRequestId:pr.id,repository:pr.repository,externalNumber:pr.externalNumber,headSha:pr.headSha},
      });
    }
    return{status,metrics};
  }

  private async applicationCheck(){
    const result=await this.runtime.db.query<{
      openHigh:number|string;openCritical:number|string;regressions:number|string;
      repeatedSignals:number|string;
    }>(
      "SELECT"+
      " COUNT(*) FILTER(WHERE status NOT IN ('closed','failed') AND severity='high')::int AS \"openHigh\","+
      " COUNT(*) FILTER(WHERE status NOT IN ('closed','failed') AND severity='critical')::int AS \"openCritical\","+
      " COUNT(*) FILTER(WHERE regression_of_incident_id IS NOT NULL AND first_seen_at>CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS regressions,"+
      " COALESCE(SUM(suppressed_signal_count) FILTER(WHERE last_seen_at>CURRENT_TIMESTAMP-INTERVAL '24 hours'),0)::bigint AS \"repeatedSignals\""+
      " FROM lai_incidents",
    );
    const metrics={
      openHigh:numeric(result.rows[0]?.openHigh),openCritical:numeric(result.rows[0]?.openCritical),
      regressions:numeric(result.rows[0]?.regressions),repeatedSignals:numeric(result.rows[0]?.repeatedSignals),
    };
    const status:MonitorStatus=metrics.openCritical?"critical":metrics.openHigh||metrics.regressions?"warning":"ok";
    await this.sample({
      monitorType:"application",sampleKey:"incidents",status,
      message:status==="ok"?"No elevated application incident pattern detected.":"Elevated or recurring application incidents detected.",
      metrics,
    });
    return{status,metrics};
  }

  async scan(){
    const results:Record<string,unknown>={};
    const checks=[
      ["database",()=>this.databaseCheck()],
      ["queue",()=>this.queueCheck()],
      ["docker",()=>this.dockerCheck()],
      ["resources",()=>this.resourceCheck()],
      ["deployment",()=>this.deploymentCheck()],
      ["ci",()=>this.ciCheck()],
      ["application",()=>this.applicationCheck()],
    ] as const;
    for(const [name,check] of checks){
      try{results[name]=await check();}
      catch(error){
        results[name]={status:"unknown",error:error instanceof Error?error.message:String(error)};
      }
    }
    return{checkedAt:new Date().toISOString(),results};
  }

  private async summaryWindow(period:SummaryPeriod){
    const part=period==="daily"?"day":"week";
    const result=await this.runtime.db.query<{windowStart:string;windowEnd:string}>(
      "SELECT ((date_trunc($1,CURRENT_TIMESTAMP AT TIME ZONE $2)-($3::int*INTERVAL '1 day')) AT TIME ZONE $2) AS \"windowStart\","+
      " (date_trunc($1,CURRENT_TIMESTAMP AT TIME ZONE $2) AT TIME ZONE $2) AS \"windowEnd\"",
      [part,this.runtime.config.SCHEDULER_TIMEZONE,period==="daily"?1:7],
    );
    return result.rows[0]!;
  }

  private statusForSummary(metrics:Record<string,number>){
    if((metrics.criticalIncidents||0)>0||(metrics.openCritical||0)>0||
       (metrics.platformCritical||0)>0)return"critical" as const;
    if((metrics.highIncidents||0)>0||(metrics.openHigh||0)>0||
       (metrics.failedCi||0)>0||(metrics.failedDeployments||0)>0||
       (metrics.platformWarning||0)>0)return"attention" as const;
    return"healthy" as const;
  }

  async generateSummary(period:SummaryPeriod){
    const window=await this.summaryWindow(period);
    const organizations=await this.runtime.db.query<{id:string;name:string}>(
      "SELECT id,name FROM organizations ORDER BY id",
    );
    const platform=await this.runtime.db.query<{critical:number|string;warning:number|string}>(
      "SELECT"+
      " COUNT(*) FILTER(WHERE status='critical')::int AS critical,"+
      " COUNT(*) FILTER(WHERE status='warning')::int AS warning"+
      " FROM ("+
      "   SELECT DISTINCT ON(monitor_type,sample_key) status"+
      "   FROM lai_monitor_samples WHERE organization_id IS NULL"+
      "   ORDER BY monitor_type,sample_key,observed_at DESC"+
      " ) latest",
    );
    const platformCritical=numeric(platform.rows[0]?.critical);
    const platformWarning=numeric(platform.rows[0]?.warning);
    const generated=[];
    for(const organization of organizations.rows){
      const incidentStats=await this.runtime.db.query<any>(
        "SELECT"+
        " COUNT(*)::int AS total,"+
        " COUNT(*) FILTER(WHERE severity='critical')::int AS \"criticalIncidents\","+
        " COUNT(*) FILTER(WHERE severity='high')::int AS \"highIncidents\","+
        " COUNT(*) FILTER(WHERE regression_of_incident_id IS NOT NULL)::int AS regressions,"+
        " COALESCE(SUM(occurrence_count),0)::bigint AS occurrences"+
        " FROM lai_incidents WHERE organization_id=$1 AND first_seen_at>=$2 AND first_seen_at<$3",
        [organization.id,window.windowStart,window.windowEnd],
      );
      const open=await this.runtime.db.query<any>(
        "SELECT"+
        " COUNT(*) FILTER(WHERE severity='critical')::int AS \"openCritical\","+
        " COUNT(*) FILTER(WHERE severity='high')::int AS \"openHigh\""+
        " FROM lai_incidents WHERE organization_id=$1 AND status NOT IN ('closed','failed')",
        [organization.id],
      );
      const git=await this.runtime.db.query<any>(
        "SELECT COUNT(*) FILTER(WHERE ci_state='failing')::int AS \"failedCi\","+
        " COUNT(*) FILTER(WHERE status='open')::int AS \"openPullRequests\""+
        " FROM lai_git_pull_requests WHERE organization_id=$1",
        [organization.id],
      );
      const deployments=await this.runtime.db.query<any>(
        "SELECT COUNT(*) FILTER(WHERE d.status='failed')::int AS \"failedDeployments\","+
        " COUNT(*) FILTER(WHERE d.status='verified')::int AS \"verifiedDeployments\""+
        " FROM lai_incident_deployments d JOIN lai_incidents i ON i.id=d.incident_id"+
        " WHERE i.organization_id=$1 AND d.created_at>=$2 AND d.created_at<$3",
        [organization.id,window.windowStart,window.windowEnd],
      );
      const metrics={
        totalIncidents:numeric(incidentStats.rows[0]?.total),
        criticalIncidents:numeric(incidentStats.rows[0]?.criticalIncidents),
        highIncidents:numeric(incidentStats.rows[0]?.highIncidents),
        regressions:numeric(incidentStats.rows[0]?.regressions),
        occurrences:numeric(incidentStats.rows[0]?.occurrences),
        openCritical:numeric(open.rows[0]?.openCritical),
        openHigh:numeric(open.rows[0]?.openHigh),
        failedCi:numeric(git.rows[0]?.failedCi),
        openPullRequests:numeric(git.rows[0]?.openPullRequests),
        failedDeployments:numeric(deployments.rows[0]?.failedDeployments),
        verifiedDeployments:numeric(deployments.rows[0]?.verifiedDeployments),
        platformCritical,platformWarning,
      };
      const status=this.statusForSummary(metrics);
      const narrative=[
        period==="daily"?"Daily engineering health":"Weekly engineering health",
        "for "+organization.name+":",
        metrics.totalIncidents+" incident(s),",
        metrics.criticalIncidents+" critical,",
        metrics.highIncidents+" high,",
        metrics.regressions+" regression(s),",
        metrics.failedCi+" failing CI pull request(s),",
        metrics.verifiedDeployments+" verified deployment(s),",
        metrics.platformCritical+" critical platform monitor(s),",
        metrics.platformWarning+" platform warning(s).",
        status==="healthy"?"No elevated engineering risk is currently open.":"Engineering attention is required.",
      ].join(" ");
      const id=createId("laisum");
      await this.runtime.db.query(
        "INSERT INTO lai_monitor_summaries("+
        " id,organization_id,period_type,window_start,window_end,status,title,narrative,summary_json"+
        " ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)"+
        " ON CONFLICT(COALESCE(organization_id,''),period_type,window_start) DO UPDATE SET"+
        " window_end=EXCLUDED.window_end,status=EXCLUDED.status,title=EXCLUDED.title,"+
        " narrative=EXCLUDED.narrative,summary_json=EXCLUDED.summary_json,created_at=CURRENT_TIMESTAMP",
        [
          id,organization.id,period,window.windowStart,window.windowEnd,status,
          (period==="daily"?"Daily":"Weekly")+" Ledgerly AI Engineering Health",
          narrative,JSON.stringify(metrics),
        ],
      );
      generated.push({organizationId:organization.id,status,narrative,metrics});
    }
    return{period,window,generated};
  }

  private publicMetrics(monitorType:string,metrics:unknown){
    const row=metrics&&typeof metrics==="object"&&!Array.isArray(metrics)
      ? metrics as Record<string,unknown>
      : {};
    if(monitorType==="resources"){
      const disks=Array.isArray(row.disks)?row.disks.map(item=>{
        const disk=item&&typeof item==="object"&&!Array.isArray(item)?item as Record<string,unknown>:{};
        return{usedPercent:numeric(disk.usedPercent),hasError:Boolean(disk.error)};
      }):[];
      return{
        disks,memoryUsedPercent:numeric(row.memoryUsedPercent),
        load1:numeric(row.load1),load5:numeric(row.load5),load15:numeric(row.load15),
        cpuCount:numeric(row.cpuCount),
      };
    }
    if(monitorType==="docker"){
      return{
        missing:Array.isArray(row.missing)?row.missing:[],
        unhealthy:Array.isArray(row.unhealthy)?row.unhealthy:[],
      };
    }
    if(monitorType==="deployment"){
      return{
        changed:Boolean(row.changed),failedStaging:numeric(row.failedStaging),
        unverifiedProduction:numeric(row.unverifiedProduction),
        lastDeploymentAt:row.lastDeploymentAt??null,
      };
    }
    return row;
  }

  async overview(principal:AuthPrincipal){
    if(!isAdmin(principal)&&!principal.scopes.includes("admin:read")){
      throw new AppError(403,"FORBIDDEN","Engineering monitoring requires administrative permission.");
    }
    const [samples,daily,weekly,incidents]=await Promise.all([
      this.runtime.db.query(
        "SELECT DISTINCT ON(monitor_type,sample_key) monitor_type AS \"monitorType\",sample_key AS \"sampleKey\","+
        " status,message,metrics_json AS metrics,observed_at AS \"observedAt\""+
        " FROM lai_monitor_samples WHERE organization_id IS NULL OR organization_id=$1"+
        " ORDER BY monitor_type,sample_key,observed_at DESC",
        [principal.organizationId],
      ),
      this.runtime.db.query(
        "SELECT id,status,title,narrative,summary_json AS summary,window_start AS \"windowStart\",window_end AS \"windowEnd\""+
        " FROM lai_monitor_summaries WHERE organization_id=$1 AND period_type='daily' ORDER BY window_end DESC LIMIT 1",
        [principal.organizationId],
      ),
      this.runtime.db.query(
        "SELECT id,status,title,narrative,summary_json AS summary,window_start AS \"windowStart\",window_end AS \"windowEnd\""+
        " FROM lai_monitor_summaries WHERE organization_id=$1 AND period_type='weekly' ORDER BY window_end DESC LIMIT 1",
        [principal.organizationId],
      ),
      this.runtime.db.query(
        "SELECT severity,status,COUNT(*)::int AS count FROM lai_incidents"+
        " WHERE organization_id=$1 AND status NOT IN ('closed','failed') GROUP BY severity,status",
        [principal.organizationId],
      ),
    ]);
    return{
      samples:samples.rows.map((row:any)=>({...row,metrics:this.publicMetrics(row.monitorType,row.metrics)})),
      daily:daily.rows[0]??null,weekly:weekly.rows[0]??null,
      activeIncidents:incidents.rows,checkedAt:new Date().toISOString(),
    };
  }

  async samples(principal:AuthPrincipal,limit=100){
    if(!isAdmin(principal)&&!principal.scopes.includes("admin:read")){
      throw new AppError(403,"FORBIDDEN","Engineering monitoring requires administrative permission.");
    }
    const result=await this.runtime.db.query(
      "SELECT id,monitor_type AS \"monitorType\",sample_key AS \"sampleKey\",status,message,"+
      " metrics_json AS metrics,observed_at AS \"observedAt\" FROM lai_monitor_samples"+
      " WHERE organization_id IS NULL OR organization_id=$1 ORDER BY observed_at DESC LIMIT $2",
      [principal.organizationId,Math.min(Math.max(limit,1),500)],
    );
    return result.rows.map((row:any)=>({...row,metrics:this.publicMetrics(row.monitorType,row.metrics)}));
  }

  async summaries(principal:AuthPrincipal,limit=30){
    if(!isAdmin(principal)&&!principal.scopes.includes("admin:read")){
      throw new AppError(403,"FORBIDDEN","Engineering monitoring requires administrative permission.");
    }
    const result=await this.runtime.db.query(
      "SELECT id,period_type AS \"periodType\",status,title,narrative,summary_json AS summary,"+
      " window_start AS \"windowStart\",window_end AS \"windowEnd\",created_at AS \"createdAt\""+
      " FROM lai_monitor_summaries WHERE organization_id=$1 ORDER BY window_end DESC LIMIT $2",
      [principal.organizationId,Math.min(Math.max(limit,1),100)],
    );
    return result.rows;
  }
}

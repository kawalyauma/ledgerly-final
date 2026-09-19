import { describe, expect, it } from "vitest";
import { parseLedgerlyAiConfig } from "../src/features/ledgerly-ai/config.js";
import { classifyIncident } from "../src/features/ledgerly-ai/incidents/classifier.js";
import { LedgerlyAiMonitoringService } from "../src/features/ledgerly-ai/monitoring/service.js";

function config(overrides:Record<string,unknown>={}){
  return parseLedgerlyAiConfig({
    LEDGERLY_AI_STARTUP_HEALTHCHECK:false,
    ...overrides,
  });
}

describe("Ledgerly AI autonomous monitoring",()=>{
  it("normalizes dynamic IDs and request numbers into one incident fingerprint",()=>{
    const first=classifyIncident({
      source:"api",
      signalType:"exception",
      message:"Student std_abcdefghijklmn request 12345 failed",
      code:"INTERNAL_ERROR",
      httpStatus:500,
      path:"/api/v1/school/students/std_abcdefghijklmn",
      method:"POST",
    });
    const second=classifyIncident({
      source:"api",
      signalType:"exception",
      message:"Student std_zzzzzzzzzzzzzz request 98765 failed",
      code:"INTERNAL_ERROR",
      httpStatus:500,
      path:"/api/v1/school/students/std_zzzzzzzzzzzzzz",
      method:"POST",
    });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.moduleKey).toBe("school");
  });

  it("honors monitor severity hints without lowering a stronger native severity",()=>{
    expect(classifyIncident({
      source:"monitor.queue",signalType:"manual",message:"Queue backlog exceeded threshold",
      severityHint:"high",
    }).severity).toBe("high");
    expect(classifyIncident({
      source:"api",signalType:"exception",message:"Internal error",httpStatus:500,
      severityHint:"medium",
    }).severity).toBe("high");
  });

  it("treats CI/build failures as engineering attention signals",()=>{
    const result=classifyIncident({
      source:"monitor.ci",
      signalType:"manual",
      message:"Required build test failed",
    });
    expect(result.severity).toBe("medium");
    expect(result.assignedAgentKey).toBe("nia");
  });

  it("rejects monitoring configurations where critical thresholds are below warning thresholds",()=>{
    expect(()=>config({
      LEDGERLY_AI_MONITOR_QUEUE_WARN:100,
      LEDGERLY_AI_MONITOR_QUEUE_CRITICAL:50,
    })).toThrow(/must be greater/i);
    expect(()=>config({
      LEDGERLY_AI_MONITOR_DISK_WARN_PERCENT:95,
      LEDGERLY_AI_MONITOR_DISK_CRITICAL_PERCENT:90,
    })).toThrow(/must be greater/i);
  });

  it("escalates health summaries for platform and incident risk",()=>{
    const service=new LedgerlyAiMonitoringService({} as never,config(),{} as never,{} as never);
    expect((service as any).statusForSummary({
      criticalIncidents:0,openCritical:0,platformCritical:1,
    })).toBe("critical");
    expect((service as any).statusForSummary({
      criticalIncidents:0,openCritical:0,platformCritical:0,platformWarning:1,
    })).toBe("attention");
    expect((service as any).statusForSummary({
      criticalIncidents:0,openCritical:0,platformCritical:0,platformWarning:0,
      highIncidents:0,openHigh:0,failedCi:0,failedDeployments:0,
    })).toBe("healthy");
  });

  it("removes host paths and container names from public monitoring metrics",()=>{
    const service=new LedgerlyAiMonitoringService({} as never,config(),{} as never,{} as never);
    const resource=(service as any).publicMetrics("resources",{
      disks:[{target:"/opt/ledgerly/source",usedPercent:88.5}],
      memoryUsedPercent:72,
      load1:1.2,load5:1.1,load15:1,cpuCount:4,
    });
    expect(JSON.stringify(resource)).not.toContain("/opt/ledgerly/source");
    expect(resource.disks[0].usedPercent).toBe(88.5);

    const docker=(service as any).publicMetrics("docker",{
      missing:["scheduler"],
      unhealthy:["api"],
      services:{api:{name:"secret-container-name",state:"exited"}},
    });
    expect(JSON.stringify(docker)).not.toContain("secret-container-name");
    expect(docker.unhealthy).toEqual(["api"]);
  });
});

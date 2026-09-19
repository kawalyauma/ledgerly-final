import { spawn } from "node:child_process";

export type IncidentCommandResult={
  exitCode:number;
  stdout:string;
  stderr:string;
  durationMs:number;
  timedOut:boolean;
};

export function runIncidentCommand(input:{
  command:string;
  args:string[];
  cwd:string;
  timeoutMs:number;
  maxBytes?:number;
  env?:NodeJS.ProcessEnv;
}):Promise<IncidentCommandResult>{
  return new Promise((resolve,reject)=>{
    const started=Date.now();
    const maxBytes=input.maxBytes??1024*1024;
    const child=spawn(input.command,input.args,{
      cwd:input.cwd,
      shell:false,
      windowsHide:true,
      env:{...process.env,CI:"1",GIT_TERMINAL_PROMPT:"0",...(input.env??{})},
      stdio:["ignore","pipe","pipe"],
    });
    let stdout="",stderr="",bytes=0,settled=false,timedOut=false;
    const capture=(kind:"stdout"|"stderr",chunk:Buffer)=>{
      if(bytes>=maxBytes)return;
      const remaining=maxBytes-bytes;
      const sliced=chunk.subarray(0,remaining).toString("utf8");
      bytes+=Buffer.byteLength(sliced);
      if(kind==="stdout")stdout+=sliced;else stderr+=sliced;
    };
    child.stdout.on("data",(chunk:Buffer)=>capture("stdout",chunk));
    child.stderr.on("data",(chunk:Buffer)=>capture("stderr",chunk));
    const timer=setTimeout(()=>{
      timedOut=true;
      if(child.exitCode===null)child.kill("SIGTERM");
      setTimeout(()=>{if(child.exitCode===null)child.kill("SIGKILL");},3000).unref();
    },input.timeoutMs);
    timer.unref();
    child.once("error",error=>{
      if(settled)return;settled=true;clearTimeout(timer);reject(error);
    });
    child.once("close",code=>{
      if(settled)return;settled=true;clearTimeout(timer);
      resolve({exitCode:code??1,stdout,stderr,durationMs:Date.now()-started,timedOut});
    });
  });
}

export async function requireIncidentCommand(input:Parameters<typeof runIncidentCommand>[0],label:string){
  const result=await runIncidentCommand(input);
  if(result.timedOut)throw new Error(label+" timed out.");
  if(result.exitCode!==0){
    throw new Error(label+" failed: "+(result.stderr.trim()||result.stdout.trim()||"unknown error"));
  }
  return result;
}

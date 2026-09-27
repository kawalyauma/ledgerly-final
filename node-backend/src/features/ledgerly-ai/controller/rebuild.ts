import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import path from "node:path";

type CommandResult={ok:boolean;command:string;output:string};

function run(command:string,args:string[],cwd:string,timeoutMs=600_000):Promise<CommandResult>{
  return new Promise(resolve=>{
    const child=spawn(command,args,{cwd,shell:false,env:{...process.env,CI:"1"},stdio:["ignore","pipe","pipe"]});
    let output="",settled=false;
    const capture=(chunk:Buffer)=>{output=(output+chunk.toString("utf8")).slice(-120_000);};
    child.stdout.on("data",capture);child.stderr.on("data",capture);
    const timer=setTimeout(()=>{if(child.exitCode===null)child.kill("SIGTERM");},timeoutMs);timer.unref();
    child.once("error",error=>{if(settled)return;settled=true;clearTimeout(timer);resolve({ok:false,command:[command,...args].join(" "),output:error.message});});
    child.once("close",code=>{if(settled)return;settled=true;clearTimeout(timer);resolve({ok:code===0,command:[command,...args].join(" "),output});});
  });
}

export async function repositoryFingerprint(repositoryRoot:string){
  const [status,diff]=await Promise.all([
    run("git",["status","--short"],repositoryRoot,30_000),
    run("git",["diff","--no-ext-diff","--binary","HEAD"],repositoryRoot,30_000),
  ]);
  return createHash("sha256").update(status.output).update("\0").update(diff.output).digest("hex");
}

export async function rebuildLedgerlyProject(repositoryRoot:string){
  const web=await run("npm",["run","build:web"],repositoryRoot);
  if(!web.ok)return {ok:false,steps:[web],summary:`${web.command} failed.\n${web.output.slice(-20_000)}`};
  const backend=await run("npm",["run","build"],path.join(repositoryRoot,"node-backend"));
  const steps=[web,backend];
  return {ok:backend.ok,steps,summary:backend.ok?"Web and Node backend builds passed.":`${backend.command} failed.\n${backend.output.slice(-20_000)}`};
}

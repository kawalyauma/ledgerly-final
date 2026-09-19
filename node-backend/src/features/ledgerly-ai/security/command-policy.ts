import path from "node:path";

const ALLOWED:Record<string,ReadonlySet<string>>={
  git:new Set(["worktree","rev-parse","show-ref","switch","diff","ls-files","add","commit","fetch","push","branch","status","grep"]),
  npm:new Set(["test","run","ci","install"]),
  test:new Set(["-d"]),
  docker:new Set(["build","network","run","rm","image","exec","ps","logs"]),
};

function binaryName(command:string){return path.basename(command).toLowerCase();}
function dangerous(value:string){
  return /[\u0000\r\n]/.test(value);
}
function operationFor(key:string,args:string[]){
  if(key!=="git")return args[0]??"";
  let index=0;
  while(index<args.length){
    const value=args[index]??"";
    if(value==="-c"){index+=2;continue;}
    if(value==="--no-pager"||value==="--paginate"){index+=1;continue;}
    return value;
  }
  return "";
}

export function assertLedgerlyAiCommandAllowed(command:string,args:string[]){
  const bin=binaryName(command);
  const key=bin==="docker"||bin==="podman"?"docker":bin;
  const allowed=ALLOWED[key];
  if(!allowed)throw new Error("Ledgerly AI command policy denied executable: "+bin);
  if(args.some(dangerous))throw new Error("Ledgerly AI command policy rejected control characters.");
  const verb=operationFor(key,args);
  if(!allowed.has(verb))throw new Error(`Ledgerly AI command policy denied ${bin} operation: ${verb||"(missing)"}`);
  if(key==="docker"){
    if(args.includes("--privileged")||args.includes("--pid=host")||args.includes("--network=host")||args.includes("--network")&&args[args.indexOf("--network")+1]==="host"){
      throw new Error("Ledgerly AI command policy denied Docker host/privileged access.");
    }
    const mountValues=args.filter((value,index)=>args[index-1]==="-v"||args[index-1]==="--volume"||args[index-1]==="--mount");
    if(mountValues.some(value=>value.includes("/var/run/docker.sock")||value.includes("/proc")||value.includes("/sys"))){
      throw new Error("Ledgerly AI command policy denied sensitive host mounts.");
    }
  }
}

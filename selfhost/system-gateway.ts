import { SignJWT } from "jose";
import type { AuthPrincipal,AgentSystemGateway } from "../src/types";

const profiles:Record<string,string[]>={
 secretary:["/api/v1/school","/api/v1/contacts","/api/v1/communications","/api/v1/documents","/api/v1/files","/api/v1/printerly","/api/v1/tasks"],
 dos:["/api/v1/school","/api/v1/academics","/api/v1/attendance","/api/v1/reports","/api/v1/documents","/api/v1/files","/api/v1/communications","/api/v1/tasks"],
 bursar:["/api/v1/accounts","/api/v1/journals","/api/v1/reports","/api/v1/documents","/api/v1/files","/api/v1/payments","/api/v1/banking","/api/v1/budgets","/api/v1/finance","/api/v1/school","/api/v1/payroll-payments","/api/v1/printerly"],
 headteacher:["/api/v1/"],
 hr:["/api/v1/human-resources","/api/v1/payroll","/api/v1/school","/api/v1/contacts","/api/v1/communications","/api/v1/documents","/api/v1/files","/api/v1/attendance","/api/v1/reports","/api/v1/tasks","/api/v1/printerly"],
 librarian:["/api/v1/books","/api/v1/inventory","/api/v1/school","/api/v1/documents","/api/v1/files","/api/v1/reports","/api/v1/tasks","/api/v1/printerly"]
};
const blocked=["/api/v1/agentic-employees","/api/v1/admin","/api/v1/integrations","/api/v1/modules"];
function cleanPath(path:string){if(!path.startsWith("/api/v1/")||path.includes("..")||path.includes("://")||/[\r\n]/.test(path))throw new Error("Only internal /api/v1 Ledgerly paths are allowed");return path;}
function prefixMatch(path:string,prefix:string){return prefix.endsWith("/")?path.startsWith(prefix):path===prefix||path.startsWith(`${prefix}/`);}
export function agentPathAllowed(agentKey:string,path:string){const p=(cleanPath(path).split("?")[0]||path).replace(/\/$/,"");if(blocked.some(x=>prefixMatch(p,x)))return false;return(profiles[agentKey]||[]).some(prefix=>prefixMatch(p,prefix));}
export function createAgentSystemGateway(app:any,secret:string,issuer:string,audience:string,coreApiUrl:string):AgentSystemGateway{
 const key=new TextEncoder().encode(secret),baseUrl=coreApiUrl.replace(/\/+$/,"");
 async function token(p:AuthPrincipal){return new SignJWT({org:p.organizationId,role:p.role,scopes:p.scopes}).setProtectedHeader({alg:"HS256"}).setSubject(p.userId).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime("90s").sign(key);}
 return{
  async catalog(agentKey,_principal){const routes=((app as any).routes||[]).map((r:any)=>({method:String(r.method||"GET").toUpperCase(),path:String(r.path||"")})).filter((r:any)=>["GET","POST","PUT","PATCH","DELETE"].includes(r.method)&&r.path.startsWith("/api/v1/")&&agentPathAllowed(agentKey,r.path));return Array.from(new Map(routes.map((r:any)=>[`${r.method} ${r.path}`,r])).values()).slice(0,500) as any;},
  async request(input){
   const method=String(input.method||"GET").toUpperCase();
   if(!["GET","POST","PUT","PATCH","DELETE"].includes(method))throw new Error("Unsupported delegated method");
   const path=cleanPath(input.path);
   if(!agentPathAllowed(input.agentKey,path))return{ok:false,status:403,data:{error:{code:"AGENT_ROLE_FORBIDDEN",message:`${input.agentKey} is not allowed to use this Ledgerly area`}}};
   const headers=new Headers({Authorization:`Bearer ${await token(input.principal)}`,Accept:"application/json"});
   let body:BodyInit|undefined;
   if(method!=="GET"&&input.body!==undefined){headers.set("Content-Type","application/json");body=JSON.stringify(input.body);}
   let response:Response;
   try{response=await fetch(`${baseUrl}${path}`,{method,headers,body,redirect:"manual"});}
   catch(error){return{ok:false,status:503,data:{error:{code:"CORE_API_UNREACHABLE",message:"Ledgerly core API is unavailable",details:{reason:error instanceof Error?error.message:String(error)}}}};}
   const text=await response.text();let data:any=text;
   try{data=text?JSON.parse(text):null;}catch{}
   return{ok:response.ok,status:response.status,data};
  }
 };
}

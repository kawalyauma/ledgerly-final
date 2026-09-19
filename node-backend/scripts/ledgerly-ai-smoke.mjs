const base=(process.env.LEDGERLY_SMOKE_BASE_URL||"http://127.0.0.1:8080").replace(/\/$/,"");
const suffix=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,8);
const email=`ledgerly-ai-smoke-${suffix}@example.test`;
const password="LedgerlyAiSmoke!"+suffix+"-safe";
function assert(value,message){if(!value)throw new Error(message);}
async function request(path,{method="GET",token,body,expected}={}){
  const response=await fetch(base+path,{
    method,
    headers:{
      Accept:"application/json",
      ...(body!==undefined?{"Content-Type":"application/json"}:{}),
      ...(token?{Authorization:"Bearer "+token}:{}),
    },
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const text=await response.text();
  let payload={};try{payload=text?JSON.parse(text):{};}catch{payload={raw:text};}
  if(expected!==undefined&&response.status!==expected){
    throw new Error(`${method} ${path}: expected HTTP ${expected}, got ${response.status}: ${text.slice(0,500)}`);
  }
  if(expected===undefined&&!response.ok){
    throw new Error(`${method} ${path}: HTTP ${response.status}: ${text.slice(0,500)}`);
  }
  return{response,payload,data:payload?.data??payload};
}

await request("/auth/register",{
  method:"POST",expected:201,
  body:{organizationName:"Ledgerly AI Smoke "+suffix,baseCurrency:"UGX",name:"AI Smoke Owner",email,password},
});
const login=await request("/auth/login",{method:"POST",body:{email,password}});
const token=login.data?.accessToken;
assert(typeof token==="string"&&token.length>20,"Smoke login did not return an access token.");

const meta=await request("/api/v1/ledgerly-ai/meta",{token});
assert(meta.data?.name==="Ledgerly AI","Ledgerly AI metadata missing.");
assert(meta.data?.featureVersion==="0.17.0","Unexpected Ledgerly AI feature version.");
assert(meta.data?.securityIsolation===true,"Security isolation capability missing.");
assert(meta.data?.reliabilityTesting===true,"Reliability testing capability missing.");

const employees=await request("/api/v1/ledgerly-ai/employees",{token});
assert(Array.isArray(employees.data)&&employees.data.length>=5,"Named AI employees were not materialized.");
assert(employees.data.some(x=>x.name==="Amani"),"Amani was not available.");

const createdChat=await request("/api/v1/ledgerly-ai/chats",{
  token,method:"POST",expected:201,body:{title:"Smoke persistence chat"},
});
assert(createdChat.data?.id,"Chat creation failed.");
const myChats=await request("/api/v1/ledgerly-ai/my/chats",{token});
assert(Array.isArray(myChats.data)&&myChats.data.some(x=>x.id===createdChat.data.id),"My Chats did not persist the created chat.");

const memory=await request("/api/v1/ledgerly-ai/memories",{
  token,method:"POST",expected:201,
  body:{scopeType:"user",kind:"fact",title:"Smoke memory",content:"Ledgerly AI smoke memory "+suffix},
});
assert(memory.data?.id,"Memory creation failed.");
const fetchedMemory=await request("/api/v1/ledgerly-ai/memories/"+memory.data.id,{token});
assert(fetchedMemory.data?.content==="Ledgerly AI smoke memory "+suffix,"Memory persistence check failed.");

const jobs=await request("/api/v1/ledgerly-ai/my/jobs?limit=10",{token});
assert(Array.isArray(jobs.data),"My Jobs did not return an array.");

const invalid=await request("/api/v1/ledgerly-ai/chat",{
  token,method:"POST",expected:422,
  body:{
    message:"Validate this attachment only.",
    attachments:[{name:"bad.bin",mimeType:"application/octet-stream",content:"x",kind:"file"}],
  },
});
assert(invalid.payload?.error?.code==="VALIDATION_ERROR","Unsafe/unsupported attachment validation did not fail closed.");

const publicText=JSON.stringify({meta:meta.data,employees:employees.data});
assert(!/codex|claude-code|anthropic/i.test(publicText),"Ordinary Ledgerly AI surfaces exposed an internal provider identity.");

console.log(JSON.stringify({
  ok:true,
  featureVersion:meta.data.featureVersion,
  employees:employees.data.length,
  chatPersisted:true,
  memoryPersisted:true,
  providerNeutral:true,
},null,2));

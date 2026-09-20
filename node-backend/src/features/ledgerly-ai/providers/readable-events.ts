import { sanitizeLedgerlyAiPublicText } from "./public-output.js";
import type { ProviderStreamEvent } from "./types.js";

export type LedgerlyAiReadableProviderUpdate={
  content:string;
  kind:"message"|"activity";
  key:string;
};

function record(value:unknown):Record<string,unknown>|null{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;
}
function clean(value:unknown,max=2400){
  if(typeof value!=="string")return"";
  return sanitizeLedgerlyAiPublicText(value).replace(/\s+/g," ").trim().slice(0,max);
}
function fileName(value:unknown){
  const text=clean(value,400);
  if(!text)return"";
  const parts=text.split(/[\\/]/);
  return parts.at(-1)||text;
}
function describeCommand(value:unknown){
  const command=Array.isArray(value)?value.filter(x=>typeof x==="string").join(" "):clean(value,1200);
  if(!command)return"I’m running a development check.";
  if(/\bgit\s+(status|diff|show)\b/i.test(command))return"I’m checking the Git changes now.";
  if(/\bgit\s+(add|commit)\b/i.test(command))return"I’m preparing the completed changes for commit.";
  if(/\b(vitest|jest|pytest|npm\s+test|pnpm\s+test|yarn\s+test)\b/i.test(command))return"I’m running the relevant tests now.";
  if(/\b(typecheck|tsc\b|build(?::|\s)|npm\s+run\s+build)\b/i.test(command))return"I’m checking that the project still builds and type-checks.";
  if(/\b(grep|rg\b|find\b)\b/i.test(command))return"I’m searching the codebase for the relevant implementation.";
  if(/\b(cat|sed\s+-n|head\b|tail\b)\b/i.test(command))return"I’m reading the relevant code and configuration.";
  return"I’m running a development check for this change.";
}
function describeTool(name:string,input:Record<string,unknown>|null){
  const lower=name.toLowerCase();
  const target=fileName(input?.file_path??input?.path);
  if(lower==="read")return target?`I’m reading ${target} to understand the current implementation.`:"I’m reading the relevant code before changing anything.";
  if(lower==="edit")return target?`I’m updating ${target} now.`:"I’m applying the code change now.";
  if(lower==="write")return target?`I’m creating ${target} now.`:"I’m creating the required file now.";
  if(lower==="bash")return describeCommand(input?.command);
  if(lower.includes("search")||lower.includes("grep"))return"I’m searching the codebase for the exact place that needs to change.";
  return`I’m using ${name} to continue the implementation.`;
}
function claudeUpdate(data:Record<string,unknown>,event:ProviderStreamEvent):LedgerlyAiReadableProviderUpdate|null{
  const type=typeof data.type==="string"?data.type:event.type;
  if(type==="assistant"){
    const message=record(data.message);
    const content=message?.content;
    const blocks=Array.isArray(content)?content:[];
    const textBlock=blocks.map(record).find(x=>x?.type==="text"&&typeof x.text==="string");
    const text=clean(textBlock?.text);
    if(text.includes("[[LEDGERLY_TOOL_CALL]]")||text.includes("[[/LEDGERLY_TOOL_CALL]]")||
       text.includes("[[LEDGERLY_AI_QA]]")||text.includes("[[/LEDGERLY_AI_QA]]"))return null;
    if(text)return{content:text,kind:"message",key:`claude:text:${text}`};
    const tool=blocks.map(record).find(x=>x?.type==="tool_use"&&typeof x.name==="string");
    if(tool){
      const name=String(tool.name);
      const content=describeTool(name,record(tool.input));
      return{content,kind:"activity",key:`claude:tool:${name}:${content}`};
    }
  }
  if(type==="user"){
    const message=record(data.message);
    const content=message?.content;
    const blocks=Array.isArray(content)?content:[];
    const failed=blocks.map(record).find(x=>x?.type==="tool_result"&&x.is_error===true);
    if(failed)return{
      content:"That check returned an error. I’m adjusting the implementation and trying the next safe step.",
      kind:"activity",key:"claude:tool-error",
    };
  }
  return null;
}
function codexUpdate(data:Record<string,unknown>,event:ProviderStreamEvent):LedgerlyAiReadableProviderUpdate|null{
  const type=typeof data.type==="string"?data.type:event.type;
  if(type!=="item.started"&&type!=="item.completed")return null;
  const item=record(data.item);
  if(!item)return null;
  const itemType=String(item.type??"");
  if(itemType==="agent_message"){
    const text=clean(item.text);
    if(text.includes("[[LEDGERLY_TOOL_CALL]]")||text.includes("[[/LEDGERLY_TOOL_CALL]]")||
       text.includes("[[LEDGERLY_AI_QA]]")||text.includes("[[/LEDGERLY_AI_QA]]"))return null;
    return text?{content:text,kind:"message",key:`codex:text:${text}`}:null;
  }
  if(itemType==="command_execution"){
    if(type==="item.started"){
      const content=describeCommand(item.command);
      return{content,kind:"activity",key:`codex:command:${content}`};
    }
    const exitCode=Number(item.exit_code??item.exitCode??0);
    if(Number.isFinite(exitCode)&&exitCode!==0)return{
      content:"One of the development checks failed. I’m using that result to correct the change.",
      kind:"activity",key:`codex:command-failed:${exitCode}`,
    };
  }
  if(itemType==="file_change"){
    const first=Array.isArray(item.changes)?record(item.changes[0]):null;
    const target=fileName(first?.path??item.path);
    const content=target?`I updated ${target}.`:"I applied the required source change.";
    return{content,kind:"activity",key:`codex:file:${content}`};
  }
  if(itemType==="mcp_tool_call"&&type==="item.started"){
    const name=clean(item.tool??item.name,120)||"a connected tool";
    const content=`I’m using ${name} to continue the task.`;
    return{content,kind:"activity",key:`codex:mcp:${name}`};
  }
  return null;
}

export function humanizeLedgerlyAiProviderEvent(event:ProviderStreamEvent):LedgerlyAiReadableProviderUpdate|null{
  if(event.stream==="stderr")return null;
  const data=record(event.data);
  if(!data)return null;
  const type=typeof data.type==="string"?data.type:event.type;
  if(["result","rate_limit_event","thread.started","turn.started","turn.completed"].includes(type))return null;
  const update=claudeUpdate(data,event)??codexUpdate(data,event);
  if(!update)return null;
  const content=clean(update.content);
  if(!content)return null;
  return{...update,content};
}

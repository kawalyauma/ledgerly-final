import type { Pool, PoolClient } from "pg";
import { createId } from "../../core-identity/security.js";
import type { ForgeAgentSpec, ForgeTrigger } from "../forge/types.js";

type Db=Pool|PoolClient;

const WEEKDAYS:Record<string,number>={
  sunday:0,sun:0,monday:1,mon:1,tuesday:2,tue:2,tues:2,wednesday:3,wed:3,
  thursday:4,thu:4,thur:4,thurs:4,friday:5,fri:5,saturday:6,sat:6,
};

function timeParts(value:string){
  const text=value.trim().toLowerCase().replace(/./g,"");
  const twelve=/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(text);
  if(twelve){
    let hour=Number(twelve[1]),minute=Number(twelve[2]??0);
    if(hour<1||hour>12||minute<0||minute>59)return null;
    if(twelve[3]==="pm"&&hour!==12)hour+=12;
    if(twelve[3]==="am"&&hour===12)hour=0;
    return{hour,minute};
  }
  const twentyFour=/^(\d{1,2})(?::(\d{2}))$/.exec(text);
  if(twentyFour){
    const hour=Number(twentyFour[1]),minute=Number(twentyFour[2]);
    if(hour<0||hour>23||minute<0||minute>59)return null;
    return{hour,minute};
  }
  const hourOnly=/^(\d{1,2})$/.exec(text);
  if(hourOnly){
    const hour=Number(hourOnly[1]);
    return hour>=0&&hour<=23?{hour,minute:0}:null;
  }
  return null;
}

function fieldTokenValid(token:string,min:number,max:number){
  if(token==="*")return true;
  const step=/^\*\/(\d+)$/.exec(token);
  if(step)return Number(step[1])>=1&&Number(step[1])<=max-min+1;
  const range=/^(\d+)-(\d+)(?:\/(\d+))?$/.exec(token);
  if(range){
    const a=Number(range[1]),b=Number(range[2]),n=Number(range[3]??1);
    return a>=min&&a<=max&&b>=min&&b<=max&&a<=b&&n>=1;
  }
  return token.split(",").every(part=>{
    if(!/^\d+$/.test(part))return false;
    const value=Number(part);
    return value>=min&&value<=max;
  });
}

export function validateCustomAgentCron(expression:string){
  const parts=expression.trim().split(/\s+/);
  return parts.length===5
    &&fieldTokenValid(parts[0]!,0,59)
    &&fieldTokenValid(parts[1]!,0,23)
    &&fieldTokenValid(parts[2]!,1,31)
    &&fieldTokenValid(parts[3]!,1,12)
    &&fieldTokenValid(parts[4]!,0,7);
}

export function parseCustomAgentSchedule(value:string){
  const source=value.trim();
  if(!source)return{cron:null,error:"A schedule description is required."};
  const lower=source.toLowerCase().replace(/\s+/g," ").trim();
  const raw=lower.startsWith("cron:")?source.slice(source.indexOf(":")+1).trim():source;
  if(validateCustomAgentCron(raw))return{cron:raw,error:null};

  let m=/^every\s+(\d+)\s+minutes?$/.exec(lower);
  if(m){
    const n=Number(m[1]);
    if(n>=1&&n<=59)return{cron:`*/${n} * * * *`,error:null};
  }
  m=/^every\s+(\d+)\s+hours?$/.exec(lower);
  if(m){
    const n=Number(m[1]);
    if(n>=1&&n<=23)return{cron:`0 */${n} * * *`,error:null};
  }
  if(lower==="hourly"||lower==="every hour")return{cron:"0 * * * *",error:null};

  m=/^(?:daily|every day)\s+at\s+(.+)$/.exec(lower);
  if(m){
    const time=timeParts(m[1]!);
    if(time)return{cron:`${time.minute} ${time.hour} * * *`,error:null};
  }
  m=/^(?:every weekday|weekdays)\s+at\s+(.+)$/.exec(lower);
  if(m){
    const time=timeParts(m[1]!);
    if(time)return{cron:`${time.minute} ${time.hour} * * 1-5`,error:null};
  }
  m=/^every\s+([a-z]+)\s+at\s+(.+)$/.exec(lower);
  if(m&&WEEKDAYS[m[1]!]!==undefined){
    const time=timeParts(m[2]!);
    if(time)return{cron:`${time.minute} ${time.hour} * * ${WEEKDAYS[m[1]!]}`,error:null};
  }
  return{
    cron:null,
    error:"Schedule could not be normalized. Use a 5-field cron expression or wording such as 'Every Friday at 4 PM', 'Daily at 08:00', or 'Every 15 minutes'.",
  };
}

function matchesNumber(value:number,token:string,min:number,max:number){
  if(token==="*")return true;
  const step=/^\*\/(\d+)$/.exec(token);
  if(step)return(value-min)%Number(step[1])===0;
  return token.split(",").some(part=>{
    const range=/^(\d+)-(\d+)(?:\/(\d+))?$/.exec(part);
    if(range){
      const start=Number(range[1]),end=Number(range[2]),stepBy=Number(range[3]??1);
      return value>=start&&value<=end&&(value-start)%stepBy===0;
    }
    return Number(part)===value||(max===7&&value===0&&Number(part)===7);
  });
}

function zonedParts(date:Date,timeZone:string){
  const formatter=new Intl.DateTimeFormat("en-US",{
    timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",
    hourCycle:"h23",weekday:"short",
  });
  const parts=Object.fromEntries(formatter.formatToParts(date).map(part=>[part.type,part.value]));
  const weekday=WEEKDAYS[String(parts.weekday||"").toLowerCase().slice(0,3)]??0;
  return{
    year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),
    hour:Number(parts.hour),minute:Number(parts.minute),weekday,
  };
}

export function customAgentCronFireKey(expression:string,date:Date,timeZone:string){
  if(!validateCustomAgentCron(expression))return null;
  const [minute,hour,day,month,weekday]=expression.trim().split(/\s+/);
  const p=zonedParts(date,timeZone);
  if(!matchesNumber(p.minute,minute!,0,59)||!matchesNumber(p.hour,hour!,0,23)||!matchesNumber(p.month,month!,1,12))return null;
  const domMatch=matchesNumber(p.day,day!,1,31),dowMatch=matchesNumber(p.weekday,weekday!,0,7);
  const domWild=day==="*",dowWild=weekday==="*";
  const dayMatches=domWild&&dowWild?true:domWild?dowMatch:dowWild?domMatch:(domMatch||dowMatch);
  if(!dayMatches)return null;
  return[
    String(p.year).padStart(4,"0"),String(p.month).padStart(2,"0"),String(p.day).padStart(2,"0"),
    String(p.hour).padStart(2,"0"),String(p.minute).padStart(2,"0"),
  ].join("-");
}

function triggerKey(trigger:ForgeTrigger,index:number){
  return `${trigger.type}:${trigger.label.trim().toLowerCase()}:${index}`;
}

export async function syncCustomAgentTriggers(db:Db,input:{
  organizationId:string;agentId:string;createdBy:string;spec:ForgeAgentSpec;
}){
  const existing=await db.query<{id:string;config:Record<string,unknown>}>(
    `SELECT id,config_json AS config FROM lai_custom_agent_triggers
      WHERE organization_id=$1 AND agent_id=$2`,
    [input.organizationId,input.agentId],
  );
  const byKey=new Map(existing.rows.map(row=>[String(row.config?.specKey||""),row.id]));
  const keep:string[]=[];
  let index=0;
  for(const trigger of input.spec.triggers){
    const current=index++;
    if(trigger.type==="manual")continue;
    const specKey=triggerKey(trigger,current);
    const id=byKey.get(specKey)||createId("laitrg");
    keep.push(id);
    if(trigger.type==="schedule"){
      const parsed=parseCustomAgentSchedule(trigger.schedule||"");
      await db.query(
        `INSERT INTO lai_custom_agent_triggers(
          id,organization_id,agent_id,trigger_type,label,cron_expression,event_key,enabled,
          config_json,validation_error,created_by,updated_by
        ) VALUES($1,$2,$3,'schedule',$4,$5,NULL,$6,$7::jsonb,$8,$9,$9)
        ON CONFLICT(id) DO UPDATE SET
          label=EXCLUDED.label,cron_expression=EXCLUDED.cron_expression,event_key=NULL,
          enabled=EXCLUDED.enabled,config_json=EXCLUDED.config_json,
          validation_error=EXCLUDED.validation_error,updated_by=EXCLUDED.updated_by,
          updated_at=CURRENT_TIMESTAMP`,
        [
          id,input.organizationId,input.agentId,trigger.label,parsed.cron,
          Boolean(trigger.enabled&&parsed.cron),JSON.stringify({specKey,source:trigger.schedule||""}),
          parsed.error,input.createdBy,
        ],
      );
    }else{
      const eventKey=trigger.eventKey?.trim()||null;
      await db.query(
        `INSERT INTO lai_custom_agent_triggers(
          id,organization_id,agent_id,trigger_type,label,cron_expression,event_key,enabled,
          config_json,validation_error,created_by,updated_by
        ) VALUES($1,$2,$3,'event',$4,NULL,$5,$6,$7::jsonb,$8,$9,$9)
        ON CONFLICT(id) DO UPDATE SET
          label=EXCLUDED.label,cron_expression=NULL,event_key=EXCLUDED.event_key,
          enabled=EXCLUDED.enabled,config_json=EXCLUDED.config_json,
          validation_error=EXCLUDED.validation_error,updated_by=EXCLUDED.updated_by,
          updated_at=CURRENT_TIMESTAMP`,
        [
          id,input.organizationId,input.agentId,trigger.label,eventKey,
          Boolean(trigger.enabled&&eventKey),JSON.stringify({specKey}),
          eventKey?null:"An event key is required.",input.createdBy,
        ],
      );
    }
  }
  await db.query(
    `UPDATE lai_custom_agent_triggers SET enabled=FALSE,updated_at=CURRENT_TIMESTAMP
      WHERE organization_id=$1 AND agent_id=$2
        AND NOT(id=ANY($3::text[]))`,
    [input.organizationId,input.agentId,keep.length?keep:["__none__"]],
  );
}

export async function ensureCustomAgentOwnerShare(db:Db,input:{
  organizationId:string;agentId:string;ownerUserId:string;
}){
  await db.query(
    `INSERT INTO lai_custom_agent_shares(
      id,organization_id,agent_id,subject_type,subject_id,can_manage,created_by
    ) VALUES($1,$2,$3,'user',$4,TRUE,$4)
    ON CONFLICT(organization_id,agent_id,subject_type,subject_id) DO UPDATE SET can_manage=TRUE`,
    [createId("laish"),input.organizationId,input.agentId,input.ownerUserId],
  );
}

import { RESPONSE_LIBRARY,responseLibraryStats,type ResponsePurpose,type ResponseRegister } from "./library.js";

export type ResponseIntelligenceInput={
  purpose:ResponsePurpose;request:string;seed:string;topic?:string|null;category?:string|null;entityType?:string|null;
  register?:ResponseRegister;detail?:"brief"|"standard"|"deep";audience?:string|null;recentText?:string|null;
};
export type StructuredAnalysisLike={
  title?:string;summary?:string;sections?:Array<{title?:string;analysis?:string;evidence?:unknown[];metrics?:unknown[]}>;
  findings?:unknown[];metrics?:unknown[];relationships?:unknown[];limitations?:string[];unanswered?:string[];suggestedActions?:unknown[];
  confidenceNote?:string;rows?:Record<string,unknown>[];
};

function hash(value:string){let h=2166136261;for(let i=0;i<value.length;i++){h^=value.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function makePicker(seed:string){let state=hash(seed)||1;return<T>(items:readonly T[],offset=0)=>{state=(Math.imul(state^0x9e3779b9,1664525)+1013904223+offset)>>>0;return items[state%items.length]!;};}
function unique<T>(items:T[]){return[...new Set(items)];}
function detectRegister(input:ResponseIntelligenceInput):ResponseRegister{
 if(input.register)return input.register;
 const text=(String(input.category||"")+" "+String(input.topic||"")+" "+input.request).toLowerCase();
 if(/finance|fee|cash|bank|budget|payroll|revenue|expense|receivable|payable|journal|tax|asset/.test(text))return"finance";
 if(/lesson|teacher|subject|scheme|classroom|academic|assessment/.test(text))return"teacher";
 if(/api|route|schema|technical|developer|system/.test(text))return"technical";
 if(/headteacher|management|operational|school health|department/.test(text))return"executive";
 return"school-professional";
}
function purposeInstruction(purpose:ResponsePurpose){
 const map:Record<ResponsePurpose,string>={
  analysis:"Explain patterns, comparisons, trends and implications without inventing causes.",
  "account-for":"Explain the outcome by weighing observed contributors, counter-evidence and alternative explanations. Keep causal claims narrower than the evidence.",
  report:"Write report prose around the verified results; do not merely restate every table cell.",
  comparison:"Make the comparison easy to follow and quantify material differences.",
  summary:"Compress to the most decision-relevant facts while preserving qualifications.",
  recommendation:"Connect each recommendation to evidence and avoid generic advice.",
  "action-preview":"Explain what the proposed action would do, why it is suggested, and what still requires approval.",
  warning:"State the risk clearly without alarmist language and explain the evidence behind it.",
  general:"Answer naturally, precisely and directly using only verified Ledgerly context."
 };return map[purpose];
}
function detailInstruction(detail:ResponseIntelligenceInput["detail"]){
 if(detail==="brief")return"Prefer 2–4 compact paragraphs or a short structured response. Remove secondary detail.";
 if(detail==="deep")return"Develop the reasoning fully. Use sections only when the evidence naturally separates into different questions. Include counter-evidence and limitations where material.";
 return"Use enough detail to explain the result properly, but do not pad the response.";
}
function phraseSample(seed:string,recentText=""){
 const pick=makePicker(seed),l=RESPONSE_LIBRARY,recent=recentText.toLowerCase();
 const choose=(items:readonly string[],salt:number)=>{for(let i=0;i<Math.min(items.length,8);i++){const v=pick(items,salt+i);if(!recent.includes(v.toLowerCase()))return v;}return pick(items,salt+99);};
 return{
  opening:choose(l.openings,1),fact:choose(l.factLeads,11),comparison:choose(l.comparisonLeads,21),trend:choose(l.trendLeads,31),
  interpretation:choose(l.interpretationLeads,41),guard:choose(l.causalGuards,51),uncertainty:choose(l.uncertainty,61),
  counter:choose(l.counterEvidence,71),recommendation:choose(l.recommendations,81),conclusion:choose(l.conclusionLeads,91),
  add:choose(l.transitions.add,101),contrast:choose(l.transitions.contrast,111),consequence:choose(l.transitions.consequence,121)
 };
}
function titleSamples(seed:string){const pick=makePicker(seed+"titles"),out:Record<string,string>={};for(const[key,values]of Object.entries(RESPONSE_LIBRARY.sectionTitles))out[key]=pick(values as readonly string[]);return out;}
function pattern(seed:string){const pick=makePicker(seed+"pattern");return pick(RESPONSE_LIBRARY.paragraphPatterns).join(" → ");}
function registerNotes(register:ResponseRegister){return RESPONSE_LIBRARY.registers[register].notes.join(" ");}

export function buildResponseLanguageBrief(input:ResponseIntelligenceInput){
 const register=detectRegister(input),samples=phraseSample(input.seed,input.recentText||""),titles=titleSamples(input.seed),stats=responseLibraryStats();
 const banned=RESPONSE_LIBRARY.bannedBoilerplate.join(" | ");
 return[
  "LEDGERLY RESPONSE INTELLIGENCE",
  "Purpose: "+input.purpose+". Register: "+register+". Detail: "+(input.detail||"standard")+".",
  purposeInstruction(input.purpose),detailInstruction(input.detail),
  "Audience: "+(input.audience||"school professional")+". Entity type: "+(input.entityType||"not fixed")+". Topic: "+(input.topic||"open")+".",
  "Write like a capable human colleague who has actually examined the records. The response must sound authored for this case, not filled into a standard report template.",
  "Vary sentence length and paragraph shape. Do not start every paragraph with the same grammatical construction. Avoid repeating the user's wording unless precision requires it.",
  "Prefer concrete nouns and measured verbs. Quantify differences when the data supports them. Use pronouns and natural references after an entity has been introduced clearly.",
  "Do not manufacture warmth, drama, certainty or blame. Do not infer motives, effort, intelligence, honesty, parenting quality, teacher quality or causation from weak proxies.",
  "Use section headings only where they improve navigation. Headings must emerge from the evidence; never force a fixed sequence such as Findings/Analysis/Conclusion.",
  "Register guidance: "+registerNotes(register),
  "Suggested discourse rhythm for this response: "+pattern(input.seed)+". This is a rhythm, not a mandatory template.",
  "Optional natural language cues to draw from or paraphrase (do not copy all of them): "+JSON.stringify(samples),
  "Possible section-heading language to adapt, not mechanically reuse: "+JSON.stringify(titles),
  "Avoid these stale or model-like expressions unless unavoidable: "+banned+".",
  "The library contains "+stats.phraseCount+" curated language fragments, "+stats.paragraphPatterns+" discourse patterns and more than "+stats.coreDiscourseCombinations.toLocaleString("en-US")+" core discourse combinations. Use it as a variation space, not as canned text.",
  "Facts always outrank style. If a stylish sentence would overstate the evidence, choose the plainer accurate sentence."
 ].join("\n");
}

export function buildResponseRealizationPrompt(input:ResponseIntelligenceInput,analysis:StructuredAnalysisLike,verifiedEvidence?:unknown){
 const brief=buildResponseLanguageBrief(input);
 return[
  brief,
  "",
  "USER REQUEST:",
  input.request,
  "",
  "STRUCTURED ANALYSIS (authoritative semantic content):",
  JSON.stringify(analysis),
  verifiedEvidence===undefined?"":"\nVERIFIED EVIDENCE DIGEST:\n"+JSON.stringify(verifiedEvidence).slice(0,18000),
  "",
  "Write the final human-facing response now.",
  "Do not add facts that are absent from the structured analysis/evidence. You may reorganize, connect, clarify and vary the prose.",
  "Do not output JSON. Use readable prose with selective headings, bullets or a compact table only when they genuinely help.",
  "If the analysis contains uncertainty or counter-evidence, preserve it. If it contains suggested actions, distinguish them from actions already completed."
 ].filter(Boolean).join("\n");
}

function asText(value:unknown){if(value===null||value===undefined)return"";if(typeof value==="string")return value;if(typeof value==="number"||typeof value==="boolean")return String(value);if(typeof value==="object"){const v=value as any;return String(v.detail||v.analysis||v.finding||v.title||v.action||v.reason||v.value||JSON.stringify(v));}return String(value);}
function sentence(text:string){const v=text.trim();if(!v)return"";return/[.!?]$/.test(v)?v:v+".";}
export function composeFallbackHumanResponse(analysis:StructuredAnalysisLike,input:ResponseIntelligenceInput){
 const pick=makePicker(input.seed+"fallback"),l=RESPONSE_LIBRARY,parts:string[]=[];
 const title=analysis.title?.trim();if(title)parts.push("## "+title);
 if(analysis.summary?.trim())parts.push(sentence(analysis.summary));
 const sections=(analysis.sections||[]).filter(section=>section.analysis?.trim());
 for(const section of sections){
  const heading=section.title?.trim()||pick(l.sectionTitles.overview);
  parts.push("### "+heading+"\n"+sentence(section.analysis||""));
 }
 const findings=(analysis.findings||[]).map(asText).filter(Boolean);
 if(findings.length&&!sections.length)parts.push("### "+pick(l.sectionTitles.overview)+"\n"+findings.slice(0,8).map(x=>"• "+sentence(x)).join("\n"));
 const relationships=(analysis.relationships||[]).map(asText).filter(Boolean);
 if(relationships.length)parts.push("### "+pick(l.sectionTitles.explanation)+"\n"+relationships.slice(0,6).map(x=>"• "+sentence(x)).join("\n"));
 const limitations=(analysis.limitations||[]).filter(Boolean);
 if(limitations.length)parts.push("### "+pick(l.sectionTitles.limits)+"\n"+limitations.slice(0,6).map(x=>"• "+sentence(x)).join("\n"));
 const actions=(analysis.suggestedActions||[]).map(asText).filter(Boolean);
 if(actions.length)parts.push("### "+pick(l.sectionTitles.action)+"\n"+actions.slice(0,6).map(x=>"• "+sentence(x)).join("\n"));
 if(analysis.confidenceNote?.trim())parts.push(sentence(analysis.confidenceNote));
 return parts.join("\n\n").trim();
}

function escapeRegex(value:string){return value.replace(/[.*+?^$()|[\]\\{}]/g,"\\$&");}
export function cleanHumanResponse(text:string){
 let value=String(text||"").replace(/\r\n/g,"\n").trim();
 for(const phrase of RESPONSE_LIBRARY.bannedBoilerplate){const re=new RegExp("^"+escapeRegex(phrase)+"[,.:;]?\\s*","i");value=value.replace(re,"");}
 value=value.replace(/\n{3,}/g,"\n\n").replace(/[ \t]+\n/g,"\n").trim();
 return value;
}
export function responseFingerprint(text:string){
 const tokens=text.toLowerCase().replace(/[^a-z0-9\s]/g," ").split(/\s+/).filter(Boolean).slice(0,160);
 let h=2166136261;for(const token of tokens){for(let i=0;i<token.length;i++){h^=token.charCodeAt(i);h=Math.imul(h,16777619);}}return(h>>>0).toString(36);
}
export function templateRisk(text:string){
 const lower=text.toLowerCase(),hits=RESPONSE_LIBRARY.bannedBoilerplate.filter(x=>lower.includes(x.toLowerCase()));
 const headings=[...text.matchAll(/^#{1,4}\s+(.+)$/gm)].map(m=>m[1]!.toLowerCase());
 const generic=headings.filter(h=>["introduction","analysis","findings","recommendations","conclusion"].includes(h));
 return{risk:hits.length+generic.length>=2,hits,genericHeadings:unique(generic),fingerprint:responseFingerprint(text)};
}

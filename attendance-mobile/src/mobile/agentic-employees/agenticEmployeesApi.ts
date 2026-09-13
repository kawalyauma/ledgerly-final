import type {MobileSession} from "../auth";
import {ledgerlyRequest,type SessionUpdater} from "../apiClient";

export type AgentModelTier="luna"|"terra"|"sol";
export type AgenticEmployee={
  key:string;name:string;title:string;description:string;modelTier:AgentModelTier;enabled:boolean;configuredTools:string[];
};
export type AgenticSettings={provider:string;configured:boolean;baseUrl?:string;models:Record<string,string>};
export type AgentConversation={id:string;agentKey:string;title:string;status:string;lastMessageAt?:string;createdAt?:string};
export type AgentMessage={id:string;role:"user"|"assistant";content:string;model?:string;createdAt?:string;toolEvents?:unknown[]};
export type AgentTask={id:string;agentKey:string;title:string;instructions?:string;status:string;resultText?:string;errorText?:string;createdAt?:string;completedAt?:string;conversationId?:string};
export type AgentApproval={id:string;conversationId?:string;agentKey:string;actionType:string;requiredScope:string;payload:Record<string,unknown>;status:string;createdAt:string;reviewedAt?:string};
export type EventReaction={id:string;eventId:string;agentKey:string;severity:"info"|"attention"|"urgent";title:string;summary:string;recommendedAction?:string;model?:string;acknowledgedAt?:string;createdAt:string;eventType:string;sourceModule:string;subjectType?:string;subjectId?:string;occurredAt:string};
export type EventSettings={enabled:boolean;attendanceWindowDays:number;attendanceAttentionCount:number;attendanceUrgentCount:number;booksLowStockThreshold:number;paymentReactionEnabled:boolean;attendanceReactionEnabled:boolean;hrReactionEnabled:boolean;booksReactionEnabled:boolean};

function json(method:string,body?:unknown):RequestInit{return {method,body:body===undefined?undefined:JSON.stringify(body)}}
export const agenticEmployeesApi={
  agents:(s:MobileSession,u:SessionUpdater)=>ledgerlyRequest<AgenticEmployee[]>(s,"/agentic-employees/agents",{},u),
  settings:(s:MobileSession,u:SessionUpdater)=>ledgerlyRequest<AgenticSettings>(s,"/agentic-employees/settings",{},u),
  conversations:(s:MobileSession,u:SessionUpdater)=>ledgerlyRequest<AgentConversation[]>(s,"/agentic-employees/conversations",{},u),
  createConversation:(s:MobileSession,u:SessionUpdater,agentKey:string,title?:string)=>ledgerlyRequest<AgentConversation>(s,"/agentic-employees/conversations",json("POST",{agentKey,title}),u),
  messages:(s:MobileSession,u:SessionUpdater,id:string)=>ledgerlyRequest<AgentMessage[]>(s,`/agentic-employees/conversations/${encodeURIComponent(id)}/messages`,{},u),
  sendMessage:(s:MobileSession,u:SessionUpdater,id:string,content:string)=>ledgerlyRequest<AgentMessage>(s,`/agentic-employees/conversations/${encodeURIComponent(id)}/messages`,json("POST",{content}),u),
  tasks:(s:MobileSession,u:SessionUpdater)=>ledgerlyRequest<AgentTask[]>(s,"/agentic-employees/tasks",{},u),
  createTask:(s:MobileSession,u:SessionUpdater,input:{agentKey:string;title:string;instructions:string})=>ledgerlyRequest<AgentTask>(s,"/agentic-employees/tasks",json("POST",input),u),
  approvals:(s:MobileSession,u:SessionUpdater,status="pending")=>ledgerlyRequest<AgentApproval[]>(s,`/agentic-employees/approvals?status=${encodeURIComponent(status)}`,{},u),
  decideApproval:(s:MobileSession,u:SessionUpdater,id:string,decision:"approve"|"reject")=>ledgerlyRequest(s,`/agentic-employees/approvals/${encodeURIComponent(id)}/${decision}`,json("POST",{}),u),
  executeApproval:(s:MobileSession,u:SessionUpdater,id:string)=>ledgerlyRequest(s,`/agentic-employees/approvals/${encodeURIComponent(id)}/execute`,json("POST",{}),u),
  reactions:(s:MobileSession,u:SessionUpdater,unacknowledged=false)=>ledgerlyRequest<EventReaction[]>(s,`/agentic-employees/events/reactions?limit=50${unacknowledged?"&unacknowledged=true":""}`,{},u),
  acknowledgeReaction:(s:MobileSession,u:SessionUpdater,id:string)=>ledgerlyRequest(s,`/agentic-employees/events/reactions/${encodeURIComponent(id)}/acknowledge`,json("POST",{}),u),
  eventSettings:(s:MobileSession,u:SessionUpdater)=>ledgerlyRequest<EventSettings>(s,"/agentic-employees/events/settings",{},u),
};

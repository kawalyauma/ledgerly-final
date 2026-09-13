import type {MobileSession} from "../auth";
import {ledgerlyRequest,type SessionUpdater} from "../apiClient";

type Client={session:MobileSession;onSession?:SessionUpdater};
const req=<T>(c:Client,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,`/schoolpay${path}`,init,c.onSession);
const json=(method:string,body?:unknown):RequestInit=>({method,body:body===undefined?undefined:JSON.stringify(body)});

export type SchoolPayIntent={
  id:string;
  studentPaymentCode:string;
  method:"register"|"request";
  eventType:"SCHOOL_FEES"|"OTHER_FEES";
  externalReference:string;
  paymentReference:string|null;
  amountMinor:number;
  phoneNumber:string|null;
  firstName:string;
  lastName:string;
  reason:string;
  status:"initiating"|"pending"|"paid"|"posting_failed"|"failed";
  providerStatus:string|null;
  receiptNumber:string|null;
  transactionId:string|null;
  channelName:string|null;
  error:string|null;
  createdAt?:string|null;
  paidAt?:string|null;
};

export const schoolPayApi={
  health:(c:Client)=>req<Record<string,any>>(c,"/health"),
  intents:(c:Client)=>req<SchoolPayIntent[]>(c,"/adhoc?limit=100"),
  request:(c:Client,body:{studentPaymentCode:string;externalReference:string;amount:number;reason:string;eventType:"SCHOOL_FEES"|"OTHER_FEES";phoneNumber:string})=>req<SchoolPayIntent>(c,"/adhoc/request",json("POST",body)),
  register:(c:Client,body:{studentPaymentCode:string;externalReference:string;amount:number;reason:string;eventType:"SCHOOL_FEES"|"OTHER_FEES"})=>req<SchoolPayIntent>(c,"/adhoc/register",json("POST",body)),
  status:(c:Client,paymentReference:string)=>req<Record<string,any>>(c,`/adhoc/${encodeURIComponent(paymentReference)}/status`),
  recover:(c:Client)=>req<Record<string,any>>(c,"/adhoc/recover",json("POST",{})),
};

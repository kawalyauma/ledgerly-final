import type{MobileSession}from"../auth";
import{ledgerlyRequest,type SessionUpdater}from"../apiClient";

type Client={session:MobileSession;onSession?:SessionUpdater};
export type ReceiptPrintSettings={enabled:boolean;printerId:string|null;copies:number;pageSize:"A4"|"A5"|"Letter"|"Legal";autoChargeFinance:boolean};
export type ReceiptPrintRow={id:string;paymentId:string;receiptNumber:string;paymentDate:string;amountMinor:number;currency:string;status:string;financeStatus:string;printerlyJobId?:string|null;jobNumber?:string|null;printerId?:string|null;financeJournalId?:string|null;attempts?:number;lastError?:string|null;completedAt?:string|null;createdAt:string;requestedByName?:string|null;kind?:"automatic"|"reprint"};
export type ReceiptPrinter={id:string;name:string;location?:string|null;status:string};
export type ReceiptCostProfile={paperCostMinor:number;bwTonerCostMinor:number;maintenanceCostMinor:number;electricityCostMinor:number;expenseAccountId?:string|null;offsetAccountId?:string|null};
const req=<T>(c:Client,path:string,init:RequestInit={})=>ledgerlyRequest<T>(c.session,path,init,c.onSession);
const json=(method:string,body?:unknown):RequestInit=>({method,headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
export const receiptPrintingApi={
  settings:(c:Client)=>req<ReceiptPrintSettings>(c,"/printerly/receipt-printing/settings"),
  saveSettings:(c:Client,body:ReceiptPrintSettings)=>req<ReceiptPrintSettings>(c,"/printerly/receipt-printing/settings",json("PUT",body)),
  dispatches:async(c:Client)=>(await req<ReceiptPrintRow[]>(c,"/printerly/receipt-printing/dispatches?limit=150")).map(x=>({...x,kind:"automatic" as const})),
  reprints:async(c:Client)=>(await req<ReceiptPrintRow[]>(c,"/printerly/receipt-printing/reprints?limit=150")).map(x=>({...x,kind:"reprint" as const})),
  printers:(c:Client)=>req<ReceiptPrinter[]>(c,"/printerly/printers"),
  costing:(c:Client)=>req<ReceiptCostProfile>(c,"/printerly/costing/profile"),
  retryAutomatic:(c:Client,paymentId:string)=>req<any>(c,`/printerly/receipt-printing/dispatches/${paymentId}/retry`,json("POST",{})),
  reprint:(c:Client,paymentId:string)=>req<any>(c,`/printerly/receipt-printing/dispatches/${paymentId}/reprint`,json("POST",{})),
  retryReprint:(c:Client,reprintId:string)=>req<any>(c,`/printerly/receipt-printing/reprints/${reprintId}/retry`,json("POST",{})),
};

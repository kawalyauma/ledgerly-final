import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import QRCode from "qrcode";
import {Hono} from "hono";
import {PDFDocument,StandardFonts,rgb} from "pdf-lib";
import {z} from "zod";
import {AppError} from "../../http/errors.js";
import type {AppEnv} from "../../http/types.js";
import type {Runtime} from "../../runtime.js";
import {createId,requireScope} from "../core-identity/security.js";

const ones=["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve","thirteen","fourteen","fifteen","sixteen","seventeen","eighteen","nineteen"];
const tens=["","","twenty","thirty","forty","fifty","sixty","seventy","eighty","ninety"];
function words(value:number):string{const n=Math.floor(Math.abs(value));if(n<20)return ones[n]!;if(n<100)return `${tens[Math.floor(n/10)]}${n%10?`-${ones[n%10]}`:""}`;if(n<1000)return `${ones[Math.floor(n/100)]} hundred${n%100?` ${words(n%100)}`:""}`;for(const[size,label]of [[1_000_000_000,"billion"],[1_000_000,"million"],[1_000,"thousand"]] as const)if(n>=size)return `${words(Math.floor(n/size))} ${label}${n%size?` ${words(n%size)}`:""}`;return String(n);}
function amountWords(minor:number,currency:string){const whole=Math.floor(Math.abs(minor)/100),prefix=minor<0?"Minus ":"",name=currency==="UGX"?(whole===1?"Uganda Shilling":"Uganda Shillings"):currency;return `${prefix}${words(whole)} ${name} Only`.replace(/\b\w/g,c=>c.toUpperCase());}
function clean(value:unknown,max=80){const text=String(value??"").replace(/[^\x20-\x7E]/g," ").replace(/\s+/g," ").trim();return text.length>max?`${text.slice(0,max-3)}...`:text;}
function money(minor:unknown,currency:string){const code=String(currency||"UGX").toUpperCase();return `${code} ${(Number(minor||0)/100).toLocaleString("en-US",{minimumFractionDigits:code==="UGX"?0:2,maximumFractionDigits:code==="UGX"?0:2})}`;}

async function receiptSource(runtime:Runtime,org:string,id:string){
  const row=(await runtime.db.query<Record<string,any>>(`SELECT r.id,r.receipt_number AS "receiptNumber",r.student_id AS "studentId",r.payment_id AS "paymentId",r.payment_date::text AS "paymentDate",r.amount_minor::float8 AS "amountMinor",r.reference,r.print_count AS "printCount",r.amount_in_words AS "amountWords",p.status AS "paymentStatus",p.currency,p.number AS "paymentNumber",p.contact_id AS "payerContactId",c.name AS "payerName",s.admission_number AS "admissionNumber",s.student_number AS "studentNumber",concat_ws(' ',s.first_name,s.middle_name,s.last_name) AS "studentName",cl.name AS "className",st.name AS "streamName",u.display_name AS "receivedBy",o.name AS "organizationName",o.legal_name AS "legalName",o.address,o.branding,sp.motto,sp.phone_numbers AS phones,sp.email_addresses AS emails,sp.website,sp.physical_address AS "physicalAddress",sp.postal_address AS "postalAddress" FROM school_fee_receipts r JOIN payments p ON p.id=r.payment_id AND p.organization_id=r.organization_id LEFT JOIN contacts c ON c.id=p.contact_id AND c.organization_id=p.organization_id JOIN school_students s ON s.id=r.student_id AND s.organization_id=r.organization_id LEFT JOIN school_classes cl ON cl.id=s.current_class_id AND cl.organization_id=s.organization_id LEFT JOIN school_streams st ON st.id=s.current_stream_id AND st.organization_id=s.organization_id LEFT JOIN users u ON u.id=r.created_by JOIN organizations o ON o.id=r.organization_id LEFT JOIN school_profiles sp ON sp.organization_id=r.organization_id WHERE r.id=$1 AND r.organization_id=$2`,[id,org])).rows[0];
  if(!row)throw new AppError(404,"FEE_RECEIPT_NOT_FOUND","School fee receipt not found");
  const [allocations,balance]=await Promise.all([
    runtime.db.query<Record<string,any>>(`SELECT pa.amount_minor::float8 AS "amountMinor",d.number AS "invoiceNumber",fc.name AS "feeCategoryName" FROM payment_allocations pa JOIN documents d ON d.id=pa.document_id AND d.organization_id=pa.organization_id LEFT JOIN school_student_fee_charges ch ON ch.document_id=d.id AND ch.organization_id=d.organization_id LEFT JOIN school_fee_categories fc ON fc.id=ch.fee_category_id AND fc.organization_id=ch.organization_id WHERE pa.payment_id=$1 AND pa.organization_id=$2 AND pa.reversed_at IS NULL ORDER BY pa.created_at,pa.id`,[row.paymentId,org]),
    runtime.db.query<Record<string,any>>(`SELECT COALESCE(SUM(l.debit_minor-l.credit_minor),0)::float8 AS "balanceMinor" FROM journal_lines l JOIN journal_entries j ON j.id=l.journal_entry_id AND j.organization_id=l.organization_id JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.organization_id=$1 AND l.dimensions_json->>'schoolStudentId'=$2 AND (a.subtype='school_fee_receivable' OR (a.subtype='receivable' AND l.dimensions_json ? 'schoolStudentId')) AND j.status='posted'`,[org,row.studentId]),
  ]);
  const amountInWords=row.amountWords||amountWords(Number(row.amountMinor),String(row.currency));
  return {...row,amountWords:amountInWords,allocations:allocations.rows,balanceAfterMinor:Number(balance.rows[0]?.balanceMinor||0)};
}

/** Signed, unguessable token for the public "is this receipt genuine?" page behind the QR code. */
export function receiptVerifyToken(secret:string,receiptId:string){return `${receiptId}.${createHmac("sha256",secret).update(`receipt-verify:${receiptId}`).digest("base64url").slice(0,22)}`;}
export function checkReceiptVerifyToken(secret:string,token:string){const id=token.split(".")[0]??"";if(!id)return null;const expected=Buffer.from(receiptVerifyToken(secret,id)),given=Buffer.from(token);return expected.length===given.length&&timingSafeEqual(expected,given)?id:null;}

/**
 * A4 portrait split in two: the customer's copy on top, the school's file copy below a
 * dashed cut line. Both halves carry the same QR code, which opens the public verification page.
 */
async function renderReceipt(source:Record<string,any>,copyLabel:string,verifyUrl:string){
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const W=595,H=842,M=34,half=H/2,page=pdf.addPage([W,H]);
  const dark=rgb(.07,.12,.2),accent=rgb(.06,.46,.43),muted=rgb(.42,.46,.5),line=rgb(.84,.87,.89),soft=rgb(.96,.98,.97);
  const qrPng=await QRCode.toBuffer(verifyUrl,{type:"png",errorCorrectionLevel:"M",margin:1,width:360,color:{dark:"#0b1f33",light:"#ffffff"}});
  const qr=await pdf.embedPng(qrPng);
  const branding=source.branding&&typeof source.branding==="object"?source.branding:{},address=source.address&&typeof source.address==="object"?source.address:{};
  const contact=[source.physicalAddress||source.postalAddress||address.formatted,Array.isArray(source.phones)?source.phones.join(", "):"",Array.isArray(source.emails)?source.emails.join(", "):"",source.website].filter(Boolean).join("  ·  ");
  const fit=(text:string,width:number,max=21)=>Math.max(12,Math.min(max,max*width/Math.max(1,bold.widthOfTextAtSize(text,max))));
  const right=(text:string,x:number,y:number,f=bold,size=9,color=dark)=>page.drawText(text,{x:x-f.widthOfTextAtSize(text,size),y,font:f,size,color});

  const drawCopy=(top:number,label:string)=>{
    let y=top-M;
    page.drawText(clean(source.legalName||source.organizationName,56),{x:M,y:y-4,font:bold,size:15,color:dark});
    const pillW=bold.widthOfTextAtSize(label,8)+18;
    page.drawRectangle({x:W-M-pillW,y:y-9,width:pillW,height:18,color:label==="FILE COPY"?rgb(.93,.94,.96):rgb(.9,.97,.95),borderColor:label==="FILE COPY"?line:accent,borderWidth:.8});
    right(label,W-M-9,y-3.5,bold,8,label==="FILE COPY"?muted:accent);
    y-=20;if(contact)page.drawText(clean(contact,120),{x:M,y,font,size:7,color:muted});
    y-=12;page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:1.4,color:accent});
    y-=22;page.drawText("OFFICIAL SCHOOL FEES RECEIPT",{x:M,y,font:bold,size:12.5,color:accent});
    right(clean(source.receiptNumber,30),W-M,y,bold,12.5,dark);
    // Left column: details. Right column: QR + balance.
    const colR=W-M-118,top2=y-16;y=top2;
    [["Payment date",source.paymentDate],["Reference",source.reference||source.paymentNumber],["Status",String(source.paymentStatus||"").toUpperCase()],["Received by",source.receivedBy||"Ledgerly"]].forEach(([k,v],i)=>{const x=M+(i%2)*170,yy=y-Math.floor(i/2)*26;page.drawText(String(k),{x,y:yy,font,size:6.8,color:muted});page.drawText(clean(v,30),{x,y:yy-11,font:bold,size:8.8,color:dark});});
    y-=60;page.drawRectangle({x:M,y:y-38,width:colR-M-18,height:46,color:soft,borderColor:line,borderWidth:.6});
    page.drawText("RECEIVED FROM",{x:M+10,y:y-3,font:bold,size:6.5,color:muted});
    page.drawText(clean(source.payerName||source.studentName,48),{x:M+10,y:y-17,font:bold,size:10.5,color:dark});
    page.drawText(clean([source.payerName&&source.payerName!==source.studentName?source.studentName:null,source.admissionNumber&&`Adm: ${source.admissionNumber}`,source.className,source.streamName].filter(Boolean).join("  ·  "),70),{x:M+10,y:y-30,font,size:7,color:muted});
    y-=56;const balX=M+Math.round((colR-M-18)/2)+8,balance=Number(source.balanceAfterMinor||0);
    page.drawText("AMOUNT RECEIVED",{x:M,y,font:bold,size:6.5,color:muted});
    page.drawText(money(source.amountMinor,source.currency),{x:M,y:y-22,font:bold,size:fit(money(source.amountMinor,source.currency),balX-M-12),color:accent});
    page.drawText("BALANCE AFTER PAYMENT",{x:balX,y,font:bold,size:6.5,color:muted});
    page.drawText(money(balance,source.currency),{x:balX,y:y-22,font:bold,size:fit(money(balance,source.currency),colR-18-balX),color:balance>0?rgb(.72,.11,.11):accent});
    y-=34;page.drawText(clean(source.amountWords,88),{x:M,y,font:bold,size:7.8,color:dark});
    y-=18;if(source.allocations.length){page.drawText("APPLIED TO",{x:M,y,font:bold,size:6.5,color:muted});y-=12;for(const a of source.allocations.slice(0,3)){page.drawText(clean([a.invoiceNumber,a.feeCategoryName].filter(Boolean).join("  ·  "),48),{x:M,y,font,size:7.2,color:dark});right(money(a.amountMinor,source.currency),colR-18,y,bold,7.2);y-=11;}if(source.allocations.length>3){page.drawText(`+ ${source.allocations.length-3} more`,{x:M,y,font,size:7,color:muted});}}
    // QR block
    const qrSize=104,qx=W-M-qrSize,qy=top2-qrSize+6;
    page.drawImage(qr,{x:qx,y:qy,width:qrSize,height:qrSize});
    const scan="Scan to verify";page.drawText(scan,{x:qx+(qrSize-font.widthOfTextAtSize(scan,7))/2,y:qy-10,font,size:7,color:muted});
    // Footer
    const fy=top-half+30;page.drawLine({start:{x:W-M-150,y:fy+14},end:{x:W-M,y:fy+14},thickness:.6,color:muted});right("Signature & stamp",W-M,fy+4,font,6.8,muted);
    page.drawText(clean(source.motto||branding.footer||"Thank you for your payment.",70),{x:M,y:fy+4,font,size:7,color:muted});
  };

  drawCopy(H,copyLabel);
  // Cut line between the two copies.
  for(let x=M;x<W-M;x+=9)page.drawLine({start:{x,y:half},end:{x:Math.min(x+5,W-M),y:half},thickness:.7,color:rgb(.6,.63,.66)});
  page.drawText("cut here",{x:W/2-font.widthOfTextAtSize("cut here",6.5)/2,y:half+4,font,size:6.5,color:muted});
  drawCopy(half,"FILE COPY");
  return pdf.save();
}

function verifyUrlFor(runtime:Runtime,c:{req:{header:(n:string)=>string|undefined}},receiptId:string){
  const base=(runtime.config.LEDGERLY_PUBLIC_URL||`https://${c.req.header("x-forwarded-host")||c.req.header("host")||"erp.notesug.com"}`).replace(/\/$/,"");
  return `${base}/#verify-receipt/${receiptVerifyToken(runtime.config.JWT_SECRET,receiptId)}`;
}

export function createSchoolReceiptPrintingRoutes(runtime:Runtime){const r=new Hono<AppEnv>();r.use("*",requireScope("school:read"));
  r.post("/receipts/:id/prints",async c=>{const parsed=z.object({purpose:z.enum(["print","download"]).default("print")}).safeParse(await c.req.json().catch(()=>({})));if(!parsed.success)throw new AppError(422,"VALIDATION_ERROR","Invalid receipt print request",parsed.error.flatten());const p=c.get("principal"),id=c.req.param("id"),source=await receiptSource(runtime,p.organizationId,id);if(source.paymentStatus!=="posted")throw new AppError(409,"RECEIPT_NOT_POSTED","Post the receipt before printing it");let copyNo=0;if(parsed.data.purpose==="print"){const updated=(await runtime.db.query<Record<string,any>>(`UPDATE school_fee_receipts SET print_count=print_count+1,printed_at=CURRENT_TIMESTAMP,archived_at=COALESCE(archived_at,CURRENT_TIMESTAMP),amount_in_words=COALESCE(amount_in_words,$1) WHERE id=$2 AND organization_id=$3 RETURNING print_count AS "copyNo"`,[source.amountWords,id,p.organizationId])).rows[0];copyNo=Number(updated?.copyNo||1);}const snapshotHash=createHash("sha256").update(JSON.stringify(source)).digest("hex"),printId=createId("rpt"),query=new URLSearchParams({printId,purpose:parsed.data.purpose,copyNo:String(copyNo)});return c.json({data:{id:printId,receiptId:id,purpose:parsed.data.purpose,copyNo,copyLabel:parsed.data.purpose==="print"?(copyNo===1?"ORIGINAL":`REPRINT #${copyNo}`):"ARCHIVE COPY",snapshotHash,pdfPath:`/school/fees/receipts/${id}/pdf?${query}`}},201);});
  r.get("/receipts/:id/pdf",async c=>{const p=c.get("principal"),source=await receiptSource(runtime,p.organizationId,c.req.param("id"));if(source.paymentStatus!=="posted")throw new AppError(409,"RECEIPT_NOT_POSTED","Post the receipt before printing it");const requestedCopy=Number(c.req.query("copyNo")||0),copyLabel=c.req.query("purpose")==="print"?(requestedCopy<=1?"ORIGINAL":`REPRINT #${requestedCopy}`):"ARCHIVE COPY",bytes=await renderReceipt(source,copyLabel,verifyUrlFor(runtime,c,source.id));c.header("Content-Type","application/pdf");c.header("Content-Length",String(bytes.byteLength));c.header("Content-Disposition",`inline; filename="${clean(source.receiptNumber,60).replace(/[^A-Za-z0-9._-]+/g,"-")}.pdf"`);c.header("Cache-Control","private, no-store");return c.body(bytes);});
  return r;
}

/**
 * Public, unauthenticated check behind the receipt QR code. Only a valid signed token
 * returns anything, and only what is already printed on the receipt.
 */
export function registerReceiptVerifyRoute(app:Hono<any>,runtime:Runtime){
  app.get("/api/public/receipts/verify/:token",async c=>{
    const id=checkReceiptVerifyToken(runtime.config.JWT_SECRET,c.req.param("token"));
    if(!id)return c.json({data:{valid:false}},404);
    const row=(await runtime.db.query<Record<string,any>>(`SELECT r.receipt_number,r.payment_date::text AS payment_date,r.amount_minor::float8 AS amount_minor,p.status,p.currency,concat_ws(' ',s.first_name,s.last_name) AS student_name,COALESCE(o.legal_name,o.name) AS school
      FROM school_fee_receipts r JOIN payments p ON p.id=r.payment_id AND p.organization_id=r.organization_id
      JOIN school_students s ON s.id=r.student_id AND s.organization_id=r.organization_id JOIN organizations o ON o.id=r.organization_id WHERE r.id=$1`,[id])).rows[0];
    if(!row)return c.json({data:{valid:false}},404);
    c.header("Cache-Control","no-store");
    return c.json({data:{valid:true,school:row.school,receiptNumber:row.receipt_number,paymentDate:row.payment_date,amount:money(row.amount_minor,row.currency),student:row.student_name,status:row.status}});
  });
}

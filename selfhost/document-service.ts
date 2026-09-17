import { createHash } from "node:crypto";
import {
  Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell, WidthType,
  TextRun, BorderStyle,
} from "docx";
import PptxGenJS from "pptxgenjs";
import * as XLSX from "xlsx";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { AgentDocumentGenerateInput, AgentDocumentArtifact, AgentDocumentService } from "../src/types";

const MIME={pdf:"application/pdf",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation"} as const;
const BLACK="111111",MID="4B5563",LIGHT="E5E7EB",WHITE="FFFFFF";

type ReportTable={title?:string;headers?:unknown[];rows?:unknown[][]};
type ReportSeries={name?:string;values?:unknown[]};
type ReportChart={title?:string;type?:"bar"|"line"|"pie"|string;labels?:unknown[];series?:ReportSeries[]};
type ReportSection={heading?:string;paragraphs?:unknown[];bullets?:unknown[];tables?:ReportTable[];charts?:ReportChart[]};
type ReportSpec={subtitle?:string;summary?:string;dataAsOf?:string;sources?:unknown[];notes?:string;sections?:ReportSection[];tables?:ReportTable[];charts?:ReportChart[];sheets?:Array<{name?:string;rows?:unknown[][]}>;slides?:Array<{title?:string;subtitle?:string;body?:string;bullets?:unknown[];tables?:ReportTable[];charts?:ReportChart[]}>};

function safe(value:string){return value.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"").slice(0,140)||"document";}
function text(value:unknown){if(value===null||value===undefined)return"";if(typeof value==="string")return value;if(typeof value==="number"||typeof value==="boolean")return String(value);return JSON.stringify(value);}
function list<T>(value:unknown,max=100):T[]{return Array.isArray(value)?value.slice(0,max) as T[]:[];}
function reportSpec(value:Record<string,unknown>):ReportSpec{return value as unknown as ReportSpec;}
function fallbackLines(value:unknown,depth=0):string[]{if(depth>4)return[text(value)];if(value==null)return[];if(["string","number","boolean"].includes(typeof value))return[text(value)];if(Array.isArray(value))return value.slice(0,100).flatMap(v=>fallbackLines(v,depth+1).map(x=>`• ${x}`));return Object.entries(value as Record<string,unknown>).slice(0,100).flatMap(([k,v])=>{const child=fallbackLines(v,depth+1);return child.length?[k.replace(/[_-]+/g," "),...child.map(x=>`  ${x}`)]:[];});}
function sanitizeRows(rows:unknown[][]|undefined,maxRows=500,maxCols=30){return list<unknown[]>(rows,maxRows).map(row=>list<unknown>(row,maxCols).map(text));}

async function renderPdf(title:string,raw:Record<string,unknown>){
  const spec=reportSpec(raw),pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const A4:[number,number]=[595.28,841.89],margin=50,bottom=55,contentWidth=A4[0]-margin*2;
  let page:PDFPage=pdf.addPage(A4),y=A4[1]-58;
  const ink=rgb(.06,.06,.06),muted=rgb(.32,.32,.32),line=rgb(.84,.84,.84),fill=rgb(.96,.96,.96);
  const wrap=(value:string,font:PDFFont,size:number,maxWidth:number)=>{const words=value.replace(/\s+/g," ").trim().split(" ");const lines:string[]=[];let current="";for(const word of words){const next=current?`${current} ${word}`:word;if(font.widthOfTextAtSize(next,size)<=maxWidth)current=next;else{if(current)lines.push(current);current=word;}}if(current)lines.push(current);return lines.length?lines:[""];};
  const newPage=()=>{page=pdf.addPage(A4);y=A4[1]-58;};
  const ensure=(height:number)=>{if(y-height<bottom)newPage();};
  const paragraph=(value:unknown,opts:{size?:number;font?:PDFFont;gap?:number;color?:ReturnType<typeof rgb>;indent?:number}={})=>{const valueText=text(value).trim();if(!valueText)return;const font=opts.font||regular,size=opts.size||10.5,gap=opts.gap??5,indent=opts.indent||0,lines=wrap(valueText,font,size,contentWidth-indent);ensure(lines.length*(size+4)+gap);for(const item of lines){page.drawText(item,{x:margin+indent,y,font,size,color:opts.color||ink});y-=size+4;}y-=gap;};
  const heading=(value:unknown,level=1)=>{const size=level===1?15:12.5;ensure(size+24);y-=level===1?8:4;paragraph(value,{size,font:bold,gap:8});};
  const table=(input:ReportTable)=>{const headers=list<unknown>(input.headers,20).map(text),rows=sanitizeRows(input.rows,120,20);if(!headers.length&&!rows.length)return;if(input.title)heading(input.title,2);const cols=Math.max(headers.length,...rows.map(r=>r.length),1),width=contentWidth/cols,rowHeight=22,headerHeight=24;ensure(headerHeight+rowHeight*2+15);if(headers.length){page.drawRectangle({x:margin,y:y-headerHeight+5,width:contentWidth,height:headerHeight,fill});headers.forEach((h,i)=>{const clipped=wrap(h,bold,8.5,width-10)[0]||"";page.drawText(clipped,{x:margin+i*width+5,y:y-10,font:bold,size:8.5,color:ink});});y-=headerHeight;}for(const row of rows){if(y-rowHeight<bottom){newPage();if(headers.length){page.drawRectangle({x:margin,y:y-headerHeight+5,width:contentWidth,height:headerHeight,fill});headers.forEach((h,i)=>page.drawText((wrap(h,bold,8.5,width-10)[0]||""),{x:margin+i*width+5,y:y-10,font:bold,size:8.5,color:ink}));y-=headerHeight;}}page.drawLine({start:{x:margin,y:y+4},end:{x:margin+contentWidth,y:y+4},thickness:.5,color:line});row.slice(0,cols).forEach((cell,i)=>{const clipped=wrap(cell,regular,8.3,width-10)[0]||"";page.drawText(clipped,{x:margin+i*width+5,y:y-11,font:regular,size:8.3,color:ink});});y-=rowHeight;}page.drawLine({start:{x:margin,y:y+4},end:{x:margin+contentWidth,y:y+4},thickness:.5,color:line});y-=12;};
  const chart=(input:ReportChart)=>{const labels=list<unknown>(input.labels,16).map(text),series=list<ReportSeries>(input.series,5);if(!labels.length||!series.length)return;if(input.title)heading(input.title,2);const values=list<unknown>(series[0]?.values,labels.length).map(v=>Number(v)||0),max=Math.max(...values.map(Math.abs),1),chartHeight=150,labelWidth=110,barWidth=contentWidth-labelWidth-45;ensure(chartHeight+25);page.drawLine({start:{x:margin+labelWidth,y:y-chartHeight+18},end:{x:margin+labelWidth+barWidth,y:y-chartHeight+18},thickness:.7,color:line});const n=Math.min(labels.length,values.length,8),slot=(chartHeight-28)/Math.max(n,1);for(let i=0;i<n;i++){const yy=y-12-i*slot;page.drawText((labels[i]||"").slice(0,20),{x:margin,y:yy,font:regular,size:8.2,color:muted});const w=Math.max(1,(Math.abs(values[i])/max)*barWidth);page.drawRectangle({x:margin+labelWidth,y:yy-1,width:w,height:8,fill:rgb(.18,.18,.18)});page.drawText(String(values[i]),{x:Math.min(margin+labelWidth+w+5,margin+contentWidth-35),y:yy,font:bold,size:8,color:ink});}y-=chartHeight+10;};

  page.drawText(title,{x:margin,y,font:bold,size:23,color:ink});y-=31;
  if(spec.subtitle)paragraph(spec.subtitle,{size:11.5,color:muted,gap:8});
  page.drawLine({start:{x:margin,y},end:{x:margin+contentWidth,y},thickness:1,color:ink});y-=18;
  if(spec.dataAsOf)paragraph(`Data as of: ${spec.dataAsOf}`,{size:8.5,color:muted,gap:10});
  if(spec.summary){heading("Executive summary",1);paragraph(spec.summary,{size:11,gap:10});}
  for(const section of list<ReportSection>(spec.sections,40)){if(section.heading)heading(section.heading,1);for(const p of list(section.paragraphs,80))paragraph(p);for(const b of list(section.bullets,80))paragraph(`• ${text(b)}`,{indent:10,gap:2});for(const t of list<ReportTable>(section.tables,20))table(t);for(const c of list<ReportChart>(section.charts,12))chart(c);}
  for(const t of list<ReportTable>(spec.tables,30))table(t);
  for(const c of list<ReportChart>(spec.charts,20))chart(c);
  if(!spec.sections?.length&&!spec.tables?.length&&!spec.charts?.length&&!spec.summary)for(const lineText of fallbackLines(raw))paragraph(lineText);
  if(spec.sources?.length){heading("Sources",1);for(const source of list(spec.sources,60))paragraph(`• ${text(source)}`,{size:9.2,color:muted,gap:2});}
  if(spec.notes){heading("Notes",2);paragraph(spec.notes,{size:9.2,color:muted});}
  const pages=pdf.getPages();pages.forEach((p,index)=>{p.drawLine({start:{x:margin,y:36},end:{x:margin+contentWidth,y:36},thickness:.45,color:line});p.drawText(title.slice(0,70),{x:margin,y:22,font:regular,size:7.5,color:muted});const number=`Page ${index+1} of ${pages.length}`;p.drawText(number,{x:A4[0]-margin-regular.widthOfTextAtSize(number,7.5),y:22,font:regular,size:7.5,color:muted});});
  return{bytes:Buffer.from(await pdf.save()),pageCount:pdf.getPageCount()};
}

async function docxBuffer(title:string,raw:Record<string,unknown>){
  const spec=reportSpec(raw),children:any[]=[new Paragraph({children:[new TextRun({text:title,bold:true,size:36,color:BLACK})],heading:HeadingLevel.TITLE})];
  if(spec.subtitle)children.push(new Paragraph({children:[new TextRun({text:spec.subtitle,color:MID,size:22})]}));
  if(spec.dataAsOf)children.push(new Paragraph({children:[new TextRun({text:`Data as of: ${spec.dataAsOf}`,color:MID,size:18})]}));
  const pushTable=(item:ReportTable)=>{const headers=list(item.headers,20).map(text),rows=sanitizeRows(item.rows,200,20);if(item.title)children.push(new Paragraph({text:item.title,heading:HeadingLevel.HEADING_2}));children.push(new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:[...(headers.length?[new TableRow({children:headers.map(value=>new TableCell({children:[new Paragraph({children:[new TextRun({text:value,bold:true,color:BLACK})]})],shading:{fill:"F3F4F6"}}))})]:[]),...rows.map(row=>new TableRow({children:row.map(value=>new TableCell({children:[new Paragraph({children:[new TextRun({text:value,color:BLACK})]})]}))}))],borders:{top:{style:BorderStyle.SINGLE,size:1,color:LIGHT},bottom:{style:BorderStyle.SINGLE,size:1,color:LIGHT},left:{style:BorderStyle.SINGLE,size:1,color:LIGHT},right:{style:BorderStyle.SINGLE,size:1,color:LIGHT},insideHorizontal:{style:BorderStyle.SINGLE,size:1,color:LIGHT},insideVertical:{style:BorderStyle.SINGLE,size:1,color:LIGHT}}}));};
  if(spec.summary){children.push(new Paragraph({text:"Executive summary",heading:HeadingLevel.HEADING_1}));children.push(new Paragraph({children:[new TextRun({text:spec.summary,color:BLACK})]}));}
  for(const section of list<ReportSection>(spec.sections,40)){if(section.heading)children.push(new Paragraph({text:section.heading,heading:HeadingLevel.HEADING_1}));for(const p of list(section.paragraphs,100))children.push(new Paragraph({children:[new TextRun({text:text(p),color:BLACK})]}));for(const b of list(section.bullets,100))children.push(new Paragraph({children:[new TextRun({text:text(b),color:BLACK})],bullet:{level:0}}));for(const t of list<ReportTable>(section.tables,20))pushTable(t);for(const c of list<ReportChart>(section.charts,20)){children.push(new Paragraph({text:c.title||"Chart data",heading:HeadingLevel.HEADING_2}));pushTable({headers:["Category",...(c.series||[]).map(s=>s.name||"Value")],rows:(c.labels||[]).map((label,i)=>[label,...(c.series||[]).map(s=>s.values?.[i]??"")])});}}
  for(const t of list<ReportTable>(spec.tables,30))pushTable(t);
  if(!spec.sections?.length&&!spec.tables?.length&&!spec.summary)for(const line of fallbackLines(raw))children.push(new Paragraph({children:[new TextRun({text:line,color:BLACK})]}));
  if(spec.sources?.length){children.push(new Paragraph({text:"Sources",heading:HeadingLevel.HEADING_1}));for(const s of list(spec.sources,60))children.push(new Paragraph({text:text(s),bullet:{level:0}}));}
  return Packer.toBuffer(new Document({styles:{default:{document:{run:{font:"Arial",size:21,color:BLACK}}}},sections:[{children}]}));
}

function xlsxBuffer(title:string,raw:Record<string,unknown>){
  const spec=reportSpec(raw),wb=XLSX.utils.book_new();
  const add=(name:string,rows:unknown[][])=>{const clean=sanitizeRows(rows,5000,50),ws=XLSX.utils.aoa_to_sheet(clean);const maxCols=Math.max(...clean.map(r=>r.length),1);ws["!cols"]=Array.from({length:maxCols},(_,i)=>({wch:Math.min(42,Math.max(12,...clean.slice(0,300).map(r=>String(r[i]??"").length+2)))}));if(clean.length>1&&maxCols>1)ws["!autofilter"]={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:clean.length-1,c:maxCols-1}})};(ws as any)["!freeze"]={xSplit:0,ySplit:1,topLeftCell:"A2",activePane:"bottomLeft",state:"frozen"};XLSX.utils.book_append_sheet(wb,ws,(name||`Sheet${wb.SheetNames.length+1}`).replace(/[\\/*?:[\]]/g," ").slice(0,31));};
  if(spec.sheets?.length){for(const sheet of list<{name?:string;rows?:unknown[][]}>(spec.sheets,30))add(sheet.name||"Sheet",sheet.rows||[]);}else{
    const summaryRows:unknown[][]=[[title],[spec.subtitle||""],[spec.dataAsOf?`Data as of: ${spec.dataAsOf}`:""],[],["Executive summary"],[spec.summary||""]];add("Summary",summaryRows);
    let tableIndex=1;const allTables=[...list<ReportTable>(spec.tables,50),...list<ReportSection>(spec.sections,40).flatMap(s=>list<ReportTable>(s.tables,20))];for(const t of allTables){add((t.title||`Table ${tableIndex}`).slice(0,31),[list(t.headers,30),...sanitizeRows(t.rows,5000,30)]);tableIndex++;}
    const charts=[...list<ReportChart>(spec.charts,30),...list<ReportSection>(spec.sections,40).flatMap(s=>list<ReportChart>(s.charts,20))];if(charts.length){const rows:unknown[][]=[];for(const chart of charts){rows.push([chart.title||"Chart data"],["Category",...list<ReportSeries>(chart.series,10).map(s=>s.name||"Value")]);list(chart.labels,100).forEach((label,i)=>rows.push([label,...list<ReportSeries>(chart.series,10).map(s=>s.values?.[i]??"")]));rows.push([]);}add("Chart Data",rows);}
  }
  if(!wb.SheetNames.length)add("Report",[[title],[JSON.stringify(raw)]]);
  wb.Props={Title:title,Subject:"Ledgerly AI professional report",Company:"Ledgerly",CreatedDate:new Date()};
  return Buffer.from(XLSX.write(wb,{type:"buffer",bookType:"xlsx",compression:true}) as any);
}

function pptTableRows(table:ReportTable){return [list(table.headers,12).map(text),...sanitizeRows(table.rows,12,12)];}
async function pptxBuffer(title:string,raw:Record<string,unknown>){
  const spec=reportSpec(raw),pptx=new PptxGenJS();pptx.layout="LAYOUT_WIDE";pptx.author="Ledgerly AI";pptx.company="Ledgerly";pptx.subject="Professional school report";pptx.title=title;pptx.lang="en-US";
  const addTitle=(slide:any,heading:string,subtitle?:string)=>{slide.background={color:WHITE};slide.addText(heading,{x:.65,y:.55,w:12,h:.55,fontFace:"Arial",fontSize:24,bold:true,color:BLACK,margin:0});if(subtitle)slide.addText(subtitle,{x:.65,y:1.15,w:12,h:.42,fontFace:"Arial",fontSize:11,color:MID,margin:0});slide.addShape(pptx.ShapeType.line,{x:.65,y:1.7,w:12,h:0,line:{color:BLACK,width:1}});};
  const addChart=(slide:any,chart:ReportChart,yStart=2)=>{const labels=list(chart.labels,8).map(text),values=list(chart.series?.[0]?.values,labels.length).map(v=>Number(v)||0),max=Math.max(...values.map(Math.abs),1),x=1.1,w=10.8,h=3.5;slide.addText(chart.title||"Chart",{x:.8,y:yStart-.35,w:11.5,h:.3,fontSize:13,bold:true,color:BLACK,margin:0});const slot=h/Math.max(labels.length,1);labels.forEach((label,i)=>{const yy=yStart+i*slot;slide.addText(label.slice(0,24),{x:.8,y:yy,w:2.2,h:.25,fontSize:9,color:MID,margin:0});slide.addShape(pptx.ShapeType.rect,{x:3.05,y:yy+.02,w:Math.max(.05,(Math.abs(values[i])/max)*w*.72),h:.18,line:{color:BLACK,transparency:100},fill:{color:"333333"}});slide.addText(String(values[i]),{x:10.95,y:yy,w:1.2,h:.22,fontSize:8.5,color:BLACK,margin:0,align:"right"});});};
  const cover=pptx.addSlide();cover.background={color:WHITE};cover.addText(title,{x:.8,y:2.35,w:11.7,h:.8,fontFace:"Arial",fontSize:30,bold:true,color:BLACK,margin:0,align:"center"});if(spec.subtitle)cover.addText(spec.subtitle,{x:1.3,y:3.3,w:10.7,h:.55,fontFace:"Arial",fontSize:15,color:MID,margin:0,align:"center"});if(spec.dataAsOf)cover.addText(`Data as of ${spec.dataAsOf}`,{x:1.3,y:4.1,w:10.7,h:.35,fontSize:10,color:MID,align:"center",margin:0});
  if(spec.slides?.length){for(const item of list<any>(spec.slides,50)){const slide=pptx.addSlide();addTitle(slide,text(item.title||title),item.subtitle?text(item.subtitle):undefined);const bullets=list(item.bullets,10).map(text);if(item.body||bullets.length){const body=[item.body?text(item.body):"",...bullets.map(v=>`• ${v}`)].filter(Boolean).join("\n\n");slide.addText(body,{x:.8,y:2,w:11.7,h:4.7,fontFace:"Arial",fontSize:16,color:BLACK,breakLine:false,margin:.08,valign:"top",fit:"shrink"});}const tables=list<ReportTable>(item.tables,2);if(tables.length)slide.addTable(pptTableRows(tables[0]),{x:.8,y:2,w:11.7,h:4.5,border:{type:"solid",color:LIGHT,pt:1},fontFace:"Arial",fontSize:10,color:BLACK,fill:WHITE,margin:.06,autoFit:false});const charts=list<ReportChart>(item.charts,1);if(charts.length)addChart(slide,charts[0],2.25);}}
  else{
    if(spec.summary){const slide=pptx.addSlide();addTitle(slide,"Executive summary",spec.dataAsOf?`Data as of ${spec.dataAsOf}`:undefined);slide.addText(spec.summary,{x:.9,y:2,w:11.5,h:4.6,fontFace:"Arial",fontSize:18,color:BLACK,margin:.05,fit:"shrink",valign:"mid"});}
    for(const section of list<ReportSection>(spec.sections,30)){const slide=pptx.addSlide();addTitle(slide,section.heading||title);const chart=list<ReportChart>(section.charts,1)[0],table=list<ReportTable>(section.tables,1)[0];if(chart)addChart(slide,chart,2.2);else if(table)slide.addTable(pptTableRows(table),{x:.8,y:2,w:11.7,h:4.6,border:{type:"solid",color:LIGHT,pt:1},fontFace:"Arial",fontSize:10,color:BLACK,fill:WHITE,margin:.06,autoFit:false});else{const body=[...list(section.paragraphs,6).map(text),...list(section.bullets,8).map(v=>`• ${text(v)}`)].join("\n\n");slide.addText(body||"No additional narrative supplied.",{x:.9,y:2,w:11.4,h:4.7,fontFace:"Arial",fontSize:17,color:BLACK,margin:.05,fit:"shrink",valign:"top"});}}
    for(const chart of list<ReportChart>(spec.charts,20)){const slide=pptx.addSlide();addTitle(slide,chart.title||"Analysis");addChart(slide,chart,2.2);}
    for(const table of list<ReportTable>(spec.tables,20)){const slide=pptx.addSlide();addTitle(slide,table.title||"Detailed table");slide.addTable(pptTableRows(table),{x:.8,y:2,w:11.7,h:4.6,border:{type:"solid",color:LIGHT,pt:1},fontFace:"Arial",fontSize:9.5,color:BLACK,fill:WHITE,margin:.05,autoFit:false});}
  }
  const out=await pptx.write({outputType:"nodebuffer"} as any);return Buffer.from(out as any);
}

export function createAgentDocumentService(bucket:any):AgentDocumentService{return{async generate(input:AgentDocumentGenerateInput):Promise<AgentDocumentArtifact>{
  const spec=input.spec||{},title=String(input.title||"Ledgerly report").trim(),rendered=await renderPdf(title,spec),pdf=rendered.bytes;
  let source:Buffer,sourceMimeType:string;
  if(input.format==="pdf"){source=pdf;sourceMimeType=MIME.pdf;}
  else if(input.format==="docx"){source=await docxBuffer(title,spec);sourceMimeType=MIME.docx;}
  else if(input.format==="xlsx"){source=xlsxBuffer(title,spec);sourceMimeType=MIME.xlsx;}
  else{source=await pptxBuffer(title,spec);sourceMimeType=MIME.pptx;}
  const base=`agentic-documents/${input.organizationId}/${input.documentId}/v1`,pdfKey=`${base}/${safe(title)}.pdf`,sourceKey=input.format==="pdf"?pdfKey:`${base}/${safe(title)}.${input.format}`,checksum=createHash("sha256").update(source).digest("hex");
  await bucket.put(sourceKey,source,{httpMetadata:{contentType:sourceMimeType,contentDisposition:`attachment; filename=\"${safe(title)}.${input.format}\"`},customMetadata:{organizationId:input.organizationId,documentId:input.documentId,agentKey:input.agentKey,checksum}});
  if(sourceKey!==pdfKey)await bucket.put(pdfKey,pdf,{httpMetadata:{contentType:MIME.pdf,contentDisposition:`inline; filename=\"${safe(title)}.pdf\"`},customMetadata:{organizationId:input.organizationId,documentId:input.documentId,agentKey:input.agentKey,pageCount:String(rendered.pageCount)}});
  return{sourceObjectKey:sourceKey,pdfObjectKey:pdfKey,sourceMimeType,sourceSizeBytes:source.length,pdfSizeBytes:pdf.length,pdfPageCount:rendered.pageCount,checksumSha256:checksum};
}};}
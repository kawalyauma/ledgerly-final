import { createHash } from "node:crypto";
import { Document,Packer,Paragraph,HeadingLevel } from "docx";
import PptxGenJS from "pptxgenjs";
import * as XLSX from "xlsx";
import { PDFDocument,StandardFonts,rgb } from "pdf-lib";
import type {
  AgentDocumentGenerateInput,
  AgentDocumentArtifact,
  AgentDocumentService
} from "../src/types";

const MIME={
  docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation"
} as const;

const PAGE_W=595.28;
const PAGE_H=841.89;
const MARGIN=50;
const CONTENT_W=PAGE_W-(MARGIN*2);

function safe(value:string){
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g,"-")
    .replace(/-+/g,"-")
    .replace(/^-|-$/g,"")
    .slice(0,140)||"document";
}

function pdfText(value:unknown){
  return String(value??"")
    .replace(/[–—]/g,"-")
    .replace(/[‘’]/g,"'")
    .replace(/[“”]/g,'"')
    .replace(/…/g,"...")
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g,"");
}

function textLines(value:unknown,depth=0):string[]{
  if(depth>5)return[pdfText(value)];
  if(value==null)return[];

  if(["string","number","boolean"].includes(typeof value)){
    return[pdfText(value)];
  }

  if(Array.isArray(value)){
    return value.flatMap(v=>textLines(v,depth+1));
  }

  return Object.entries(value as Record<string,unknown>).flatMap(([k,v])=>{
    const child=textLines(v,depth+1);
    return child.length
      ? [k.replace(/[_-]+/g," "),...child]
      : [];
  });
}

function wrapText(font:any,size:number,value:string,maxWidth:number){
  const text=pdfText(value).trim();
  if(!text)return[""];

  const words=text.split(/\s+/);
  const lines:string[]=[];
  let current="";

  const pushLongWord=(word:string)=>{
    let part="";
    for(const char of word){
      const next=part+char;
      if(part && font.widthOfTextAtSize(next,size)>maxWidth){
        lines.push(part);
        part=char;
      }else{
        part=next;
      }
    }
    if(part)current=part;
  };

  for(const word of words){
    const next=current?`${current} ${word}`:word;

    if(font.widthOfTextAtSize(next,size)<=maxWidth){
      current=next;
      continue;
    }

    if(current){
      lines.push(current);
      current="";
    }

    if(font.widthOfTextAtSize(word,size)>maxWidth){
      pushLongWord(word);
    }else{
      current=word;
    }
  }

  if(current)lines.push(current);
  return lines.length?lines:[""];
}

function normalizeTable(value:any){
  if(!value || typeof value!=="object")return null;

  let headers=Array.isArray(value.headers)
    ? value.headers.map((v:unknown)=>pdfText(v))
    : [];

  const sourceRows=Array.isArray(value.rows)?value.rows:[];

  if(!headers.length && sourceRows.length && sourceRows[0] &&
     typeof sourceRows[0]==="object" && !Array.isArray(sourceRows[0])){
    headers=Object.keys(sourceRows[0]);
  }

  const rows=sourceRows.map((row:any)=>{
    if(Array.isArray(row)){
      return headers.map((_:string,index:number)=>pdfText(row[index]??""));
    }

    if(row && typeof row==="object"){
      return headers.map((header:string)=>pdfText(row[header]??""));
    }

    return[pdfText(row)];
  });

  if(!headers.length && rows.length){
    headers=rows[0].map((_:string,index:number)=>`Column ${index+1}`);
  }

  if(!headers.length)return null;

  return{
    headers:headers.slice(0,8),
    rows:rows.map((row:string[])=>row.slice(0,8))
  };
}

async function renderPdf(title:string,spec:Record<string,unknown>){
  const pdf=await PDFDocument.create();
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);

  let page=pdf.addPage([PAGE_W,PAGE_H]);
  let y=PAGE_H-66;

  const brand=rgb(.07,.32,.23);
  const ink=rgb(.10,.13,.12);
  const muted=rgb(.38,.43,.41);
  const line=rgb(.84,.89,.86);
  const soft=rgb(.94,.97,.95);

  const drawPageHeader=()=>{
    page.drawText("LEDGERLY  •  AI GENERATED DOCUMENT",{
      x:MARGIN,
      y:PAGE_H-35,
      font:bold,
      size:7.5,
      color:muted
    });

    page.drawLine({
      start:{x:MARGIN,y:PAGE_H-44},
      end:{x:PAGE_W-MARGIN,y:PAGE_H-44},
      thickness:.7,
      color:line
    });
  };

  const newPage=()=>{
    page=pdf.addPage([PAGE_W,PAGE_H]);
    y=PAGE_H-66;
    drawPageHeader();
  };

  const ensure=(height:number)=>{
    if(y-height<58)newPage();
  };

  drawPageHeader();

  const drawWrapped=(
    value:unknown,
    options:{
      size?:number;
      bold?:boolean;
      indent?:number;
      color?:any;
      after?:number;
    }={}
  )=>{
    const size=options.size??10;
    const activeFont=options.bold?bold:font;
    const indent=options.indent??0;
    const maxWidth=CONTENT_W-indent;
    const lines=wrapText(activeFont,size,pdfText(value),maxWidth);
    const lineHeight=size*1.45;

    for(const item of lines){
      ensure(lineHeight+3);
      page.drawText(item||" ",{
        x:MARGIN+indent,
        y,
        font:activeFont,
        size,
        color:options.color??ink
      });
      y-=lineHeight;
    }

    y-=options.after??3;
  };

  const drawHeading=(value:unknown)=>{
    ensure(32);
    y-=3;

    drawWrapped(value,{
      size:13,
      bold:true,
      color:brand,
      after:5
    });

    page.drawLine({
      start:{x:MARGIN,y:y+2},
      end:{x:PAGE_W-MARGIN,y:y+2},
      thickness:.6,
      color:line
    });

    y-=7;
  };

  const drawBullet=(value:unknown)=>{
    const size=10;
    const indent=17;
    const lines=wrapText(font,size,pdfText(value),CONTENT_W-indent);

    lines.forEach((item,index)=>{
      ensure(16);

      if(index===0){
        page.drawCircle({
          x:MARGIN+4,
          y:y+3,
          size:2.1,
          color:brand
        });
      }

      page.drawText(item||" ",{
        x:MARGIN+indent,
        y,
        font,
        size,
        color:ink
      });

      y-=14;
    });

    y-=2;
  };

  const drawTable=(input:any)=>{
    const table=normalizeTable(input);
    if(!table)return;

    const cols=table.headers.length;
    const colWidth=CONTENT_W/cols;
    const fontSize=8;

    const rowLines=(row:string[],isHeader=false)=>{
      const f=isHeader?bold:font;
      return row.map(cell=>wrapText(f,fontSize,cell,colWidth-10));
    };

    const paintRow=(row:string[],isHeader=false)=>{
      const wrapped=rowLines(row,isHeader);
      const maxLines=Math.max(1,...wrapped.map(lines=>lines.length));
      const rowHeight=Math.max(23,maxLines*10+9);

      if(y-rowHeight<58){
        newPage();

        if(!isHeader){
          paintRow(table.headers,true);
        }
      }

      let x=MARGIN;

      for(let column=0;column<cols;column++){
        page.drawRectangle({
          x,
          y:y-rowHeight+5,
          width:colWidth,
          height:rowHeight,
          color:isHeader?soft:rgb(1,1,1),
          borderColor:line,
          borderWidth:.5
        });

        const cellLines=wrapped[column]||[""];
        let cellY=y-10;

        for(const cellLine of cellLines){
          page.drawText(cellLine||" ",{
            x:x+5,
            y:cellY,
            font:isHeader?bold:font,
            size:fontSize,
            color:isHeader?brand:ink
          });
          cellY-=10;
        }

        x+=colWidth;
      }

      y-=rowHeight;
    };

    ensure(35);
    paintRow(table.headers,true);

    for(const row of table.rows){
      paintRow(row,false);
    }

    y-=10;
  };

  drawWrapped(title,{
    size:20,
    bold:true,
    color:ink,
    after:5
  });

  if(typeof spec.subtitle==="string" && spec.subtitle.trim()){
    drawWrapped(spec.subtitle,{
      size:10,
      color:muted,
      after:10
    });
  }else{
    y-=5;
  }

  page.drawLine({
    start:{x:MARGIN,y},
    end:{x:PAGE_W-MARGIN,y},
    thickness:1.3,
    color:brand
  });

  y-=20;

  const sections=Array.isArray(spec.sections)?spec.sections:[];

  if(sections.length){
    for(const raw of sections){
      const section=(raw && typeof raw==="object")
        ? raw as Record<string,any>
        : {paragraphs:[raw]};

      if(section.heading){
        drawHeading(section.heading);
      }

      if(Array.isArray(section.paragraphs)){
        for(const paragraph of section.paragraphs){
          drawWrapped(paragraph,{size:10,after:6});
        }
      }

      if(Array.isArray(section.bullets)){
        for(const bullet of section.bullets){
          drawBullet(bullet);
        }
      }

      if(section.table){
        drawTable(section.table);
      }

      if(Array.isArray(section.tables)){
        for(const table of section.tables){
          drawTable(table);
        }
      }

      y-=4;
    }
  }else{
    if(Array.isArray((spec as any).paragraphs)){
      for(const paragraph of (spec as any).paragraphs){
        drawWrapped(paragraph,{size:10,after:6});
      }
    }

    if(Array.isArray((spec as any).bullets)){
      for(const bullet of (spec as any).bullets){
        drawBullet(bullet);
      }
    }

    if((spec as any).table){
      drawTable((spec as any).table);
    }

    if(
      !Array.isArray((spec as any).paragraphs) &&
      !Array.isArray((spec as any).bullets) &&
      !(spec as any).table
    ){
      for(const value of textLines(spec)){
        drawWrapped(value,{size:10,after:3});
      }
    }
  }

  const pages=pdf.getPages();

  pages.forEach((current,index)=>{
    current.drawLine({
      start:{x:MARGIN,y:39},
      end:{x:PAGE_W-MARGIN,y:39},
      thickness:.5,
      color:line
    });

    current.drawText("Generated by Ledgerly AI",{
      x:MARGIN,
      y:24,
      font,
      size:7.5,
      color:muted
    });

    const pageLabel=`Page ${index+1} of ${pages.length}`;

    current.drawText(pageLabel,{
      x:PAGE_W-MARGIN-font.widthOfTextAtSize(pageLabel,7.5),
      y:24,
      font,
      size:7.5,
      color:muted
    });
  });

  const bytes=Buffer.from(await pdf.save());

  return{
    bytes,
    pageCount:pdf.getPageCount()
  };
}

function docxBuffer(title:string,spec:any){
  const children=[
    new Paragraph({
      text:title,
      heading:HeadingLevel.TITLE
    })
  ];

  const sections=Array.isArray(spec.sections)?spec.sections:null;

  if(sections){
    for(const section of sections){
      if(section.heading){
        children.push(
          new Paragraph({
            text:String(section.heading),
            heading:HeadingLevel.HEADING_1
          })
        );
      }

      for(const p of section.paragraphs||[]){
        children.push(new Paragraph(String(p)));
      }

      for(const b of section.bullets||[]){
        children.push(
          new Paragraph({
            text:String(b),
            bullet:{level:0}
          })
        );
      }
    }
  }else{
    for(const line of textLines(spec)){
      children.push(new Paragraph(line));
    }
  }

  return Packer.toBuffer(
    new Document({
      sections:[{children}]
    })
  );
}

function xlsxBuffer(spec:any){
  const wb=XLSX.utils.book_new();

  const sheets=
    Array.isArray(spec.sheets)&&spec.sheets.length
      ?spec.sheets
      :[{
          name:"Sheet1",
          rows:Array.isArray(spec.rows)
            ?spec.rows
            :[["Value"],[JSON.stringify(spec)]]
        }];

  for(const item of sheets.slice(0,30)){
    const rows=Array.isArray(item.rows)?item.rows:[["Value"]];
    const ws=XLSX.utils.aoa_to_sheet(rows);

    XLSX.utils.book_append_sheet(
      wb,
      ws,
      String(item.name||`Sheet${wb.SheetNames.length+1}`).slice(0,31)
    );
  }

  return Buffer.from(
    XLSX.write(wb,{
      type:"buffer",
      bookType:"xlsx"
    }) as any
  );
}

async function pptxBuffer(title:string,spec:any){
  const pptx=new PptxGenJS();
  pptx.layout="LAYOUT_WIDE";

  const slides=
    Array.isArray(spec.slides)&&spec.slides.length
      ?spec.slides
      :[{title,bullets:textLines(spec)}];

  for(const item of slides.slice(0,60)){
    const slide=pptx.addSlide();

    slide.addText(
      String(item.title||title),
      {
        x:.6,
        y:.4,
        w:12,
        h:.6,
        fontSize:24,
        bold:true
      }
    );

    const bullets=Array.isArray(item.bullets)
      ?item.bullets
      :(item.body?[String(item.body)]:[]);

    if(bullets.length){
      slide.addText(
        bullets.map((t:string)=>({
          text:String(t),
          options:{
            bullet:{indent:18},
            breakLine:true
          }
        })),
        {
          x:.8,
          y:1.3,
          w:11.6,
          h:5.5,
          fontSize:18
        }
      );
    }
  }

  const out=await pptx.write({
    outputType:"nodebuffer"
  } as any);

  return Buffer.from(out as any);
}

export function createAgentDocumentService(bucket:any):AgentDocumentService{
  return{
    async generate(
      input:AgentDocumentGenerateInput
    ):Promise<AgentDocumentArtifact>{
      const spec=input.spec||{};
      const title=String(
        input.title||"Ledgerly document"
      ).trim();

      let source:Buffer;

      if(input.format==="docx"){
        source=await docxBuffer(title,spec);
      }else if(input.format==="xlsx"){
        source=xlsxBuffer(spec);
      }else{
        source=await pptxBuffer(title,spec);
      }

      const rendered=await renderPdf(title,spec);
      const pdf=rendered.bytes;

      const base=
        `agentic-documents/${input.organizationId}/${input.documentId}/v1`;

      const sourceKey=
        `${base}/${safe(title)}.${input.format}`;

      const pdfKey=
        `${base}/${safe(title)}.pdf`;

      const checksum=createHash("sha256")
        .update(source)
        .digest("hex");

      await bucket.put(
        sourceKey,
        source,
        {
          httpMetadata:{
            contentType:MIME[input.format],
            contentDisposition:
              `attachment; filename="${safe(title)}.${input.format}"`
          },
          customMetadata:{
            organizationId:input.organizationId,
            documentId:input.documentId,
            agentKey:input.agentKey,
            checksum
          }
        }
      );

      await bucket.put(
        pdfKey,
        pdf,
        {
          httpMetadata:{
            contentType:"application/pdf",
            contentDisposition:
              `inline; filename="${safe(title)}.pdf"`
          },
          customMetadata:{
            organizationId:input.organizationId,
            documentId:input.documentId,
            agentKey:input.agentKey,
            pageCount:String(rendered.pageCount)
          }
        }
      );

      return{
        sourceObjectKey:sourceKey,
        pdfObjectKey:pdfKey,
        sourceMimeType:MIME[input.format],
        sourceSizeBytes:source.length,
        pdfSizeBytes:pdf.length,
        pdfPageCount:rendered.pageCount,
        checksumSha256:checksum
      };
    }
  };
}

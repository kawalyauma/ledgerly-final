import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as XLSX from "xlsx";
import type { ReportResult } from "./service.js";
import { toCsv } from "./service.js";

export type ReportFormat = "json" | "csv" | "xlsx" | "pdf";

export const reportContentTypes: Record<ReportFormat,string> = {
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function displayValue(value: unknown, column: string) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  if (/minor$/i.test(column) && Number.isFinite(Number(value))) return (Number(value) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (typeof value === "number") return String(Math.round(value * 10000) / 10000);
  return String(value).replaceAll("\n", " ");
}

export function toXlsx(report: ReportResult): Uint8Array {
  const sheet = XLSX.utils.json_to_sheet(report.rows, { header: report.columns });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Report");
  workbook.Props = { Title: report.reportType, CreatedDate: new Date(report.generatedAt) };
  return XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true }) as Uint8Array;
}

export async function toPdf(report: ReportResult, organizationName = "Ledgerly"): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const width = 842, height = 595, margin = 32, rowHeight = 18;
  const columns = report.columns.length ? report.columns : ["message"];
  const weight = columns.map((column) => /name|description|contact/i.test(column) ? 2.2 : /amount|minor|debit|credit|balance/i.test(column) ? 1.25 : 1);
  const unit = (width - margin * 2) / weight.reduce((a,b) => a + b, 0);
  const widths = weight.map((value) => value * unit);
  let page = document.addPage([width,height]);
  let y = height - margin;
  let pageNumber = 1;

  const fit = (text: string, cellWidth: number, size = 7) => {
    const max = Math.max(2, Math.floor(cellWidth / (size * 0.52)));
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const label = (value: string) => value.replace(/Minor$/," Amount").replace(/([A-Z])/g," $1").replace(/^./, (char) => char.toUpperCase());
  const drawHeader = () => {
    page.drawText(organizationName, { x: margin, y, font: bold, size: 12, color: rgb(0.05,0.2,0.35) });
    y -= 20;
    page.drawText(report.reportType.replaceAll("-"," ").toUpperCase(), { x: margin, y, font: bold, size: 17, color: rgb(0.05,0.2,0.35) });
    const range = report.filters.asOf ? `As of ${report.filters.asOf}` : [report.filters.from, report.filters.to].filter(Boolean).join(" to ");
    if (range) page.drawText(range, { x: width - margin - font.widthOfTextAtSize(range, 8), y, font, size: 8 });
    y -= 28;
    page.drawRectangle({ x: margin, y: y - rowHeight + 5, width: width - margin * 2, height: rowHeight, color: rgb(0.08,0.16,0.26) });
    let x = margin;
    columns.forEach((column,index) => {
      page.drawText(fit(label(column), widths[index]! - 8), { x: x + 4, y: y - 8, font: bold, size: 7, color: rgb(1,1,1) });
      x += widths[index]!;
    });
    y -= rowHeight;
  };
  const nextPage = () => {
    page.drawText(`Page ${pageNumber++}`, { x: width - margin - 34, y: 16, font, size: 7 });
    page = document.addPage([width,height]);
    y = height - margin;
    drawHeader();
  };

  drawHeader();
  if (!report.rows.length) {
    page.drawText("No records match the selected report filters.", { x: margin, y: y - 8, font, size: 10 });
    y -= 28;
  }
  for (let rowIndex = 0; rowIndex < report.rows.length; rowIndex++) {
    if (y < margin + 42) nextPage();
    if (rowIndex % 2 === 1) page.drawRectangle({ x: margin, y: y - rowHeight + 5, width: width - margin * 2, height: rowHeight, color: rgb(0.96,0.97,0.98) });
    let x = margin;
    columns.forEach((column,index) => {
      const value = fit(displayValue(report.rows[rowIndex]![column], column), widths[index]! - 8);
      page.drawText(value, { x: x + 4, y: y - 8, font, size: 7, color: rgb(0.12,0.16,0.22) });
      x += widths[index]!;
    });
    y -= rowHeight;
  }
  if (report.totals) {
    if (y < margin + 90) nextPage();
    y -= 8;
    page.drawText("TOTALS", { x: margin, y, font: bold, size: 9 });
    y -= 16;
    for (const [key,value] of Object.entries(report.totals)) {
      page.drawText(label(key), { x: margin, y, font, size: 8 });
      const rendered = /minor$/i.test(key) ? (value/100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(value);
      page.drawText(rendered, { x: width - margin - font.widthOfTextAtSize(rendered,8), y, font: bold, size: 8 });
      y -= 14;
    }
  }
  page.drawText(`Generated ${new Date(report.generatedAt).toLocaleString("en-GB")}`, { x: margin, y: 16, font, size: 7 });
  page.drawText(`Page ${pageNumber}`, { x: width - margin - 34, y: 16, font, size: 7 });
  return document.save();
}

export async function renderReport(report: ReportResult, format: ReportFormat, organizationName?: string): Promise<Uint8Array> {
  if (format === "json") return textBytes(JSON.stringify(report, null, 2));
  if (format === "csv") return textBytes(toCsv(report));
  if (format === "xlsx") return toXlsx(report);
  return toPdf(report, organizationName);
}

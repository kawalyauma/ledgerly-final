import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createAgentDocumentService } from "./document-service";

class MemoryBucket {
  objects = new Map<string, { body: Buffer; options?: any }>();

  async put(key: string, value: unknown, options?: any) {
    const body = Buffer.isBuffer(value) ? value : Buffer.from(value as ArrayBuffer | Uint8Array | string);
    this.objects.set(key, { body, options });
    return { key };
  }
}

const professionalSpec = {
  subtitle: "Term 3 management review",
  dataAsOf: "2026-09-17",
  summary: "A concise management summary based only on verified Ledgerly records.",
  sections: [
    {
      heading: "Fees overview",
      paragraphs: ["Collections improved while outstanding balances remain concentrated in a small learner cohort."],
      bullets: ["Review the largest arrears first", "Keep all figures traceable to Ledgerly"],
      tables: [
        {
          title: "Collection comparison",
          headers: ["Metric", "Current", "Previous"],
          rows: [
            ["Collection rate", "82%", "76.5%"],
            ["Outstanding", "UGX 49,822,000", "UGX 58,400,000"],
          ],
        },
      ],
      charts: [
        {
          title: "Collection rate",
          type: "bar",
          labels: ["Previous", "Current"],
          series: [{ name: "Percent", values: [76.5, 82] }],
        },
      ],
    },
  ],
  sheets: [
    {
      name: "Fees",
      rows: [
        ["Metric", "Value"],
        ["Collection rate", 82],
        ["Outstanding UGX", 49_822_000],
      ],
    },
  ],
  slides: [
    {
      title: "Fees overview",
      subtitle: "Verified Ledgerly data",
      bullets: ["Collection rate: 82%", "Outstanding: UGX 49.822m"],
      tables: [
        {
          headers: ["Metric", "Value"],
          rows: [["Collection rate", "82%"]],
        },
      ],
      charts: [
        {
          title: "Collection rate",
          type: "bar",
          labels: ["Previous", "Current"],
          series: [{ name: "Percent", values: [76.5, 82] }],
        },
      ],
    },
  ],
  sources: ["Ledgerly fees ledger"],
  notes: "Professional black/dark text is the default presentation style.",
};

function input(format: "pdf" | "docx" | "xlsx" | "pptx") {
  return {
    documentId: `doc-${format}`,
    organizationId: "org-test",
    agentKey: "headteacher",
    title: "Ledgerly Professional Report",
    format,
    spec: professionalSpec,
  } as const;
}

describe("self-hosted agent document service", () => {
  it.each([
    ["pdf", "application/pdf"],
    ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ] as const)("generates a %s source plus a printable PDF", async (format, mime) => {
    const bucket = new MemoryBucket();
    const service = createAgentDocumentService(bucket as any);
    const result = await service.generate(input(format));

    expect(result.sourceMimeType).toBe(mime);
    expect(result.sourceSizeBytes).toBeGreaterThan(100);
    expect(result.pdfSizeBytes).toBeGreaterThan(100);
    expect(result.pdfPageCount).toBeGreaterThanOrEqual(1);
    expect(result.checksumSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(bucket.objects.has(result.sourceObjectKey)).toBe(true);
    expect(bucket.objects.has(result.pdfObjectKey)).toBe(true);

    const pdfObject = bucket.objects.get(result.pdfObjectKey);
    expect(pdfObject).toBeTruthy();
    const parsedPdf = await PDFDocument.load(pdfObject!.body);
    expect(parsedPdf.getPageCount()).toBe(result.pdfPageCount);
  });

  it("reuses the PDF object as the source for native PDF reports", async () => {
    const bucket = new MemoryBucket();
    const service = createAgentDocumentService(bucket as any);
    const result = await service.generate(input("pdf"));

    expect(result.sourceObjectKey).toBe(result.pdfObjectKey);
    expect(bucket.objects.size).toBe(1);
    expect(bucket.objects.get(result.sourceObjectKey)?.options?.httpMetadata?.contentType).toBe("application/pdf");
  });
});

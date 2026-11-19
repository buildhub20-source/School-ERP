import "server-only";
import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { getSetting } from "./settings";
import { enableTamil } from "./pdf-tamil";

export type Pdf = InstanceType<typeof PDFDocument>;

export { pdfMoney, pdfDate } from "./pdf-format";

export async function qrPng(text: string, size = 120): Promise<Buffer> {
  return QRCode.toBuffer(text, { width: size, margin: 1 });
}

function logoPath(url: string): string | null {
  if (!url) return null;
  const p = url.startsWith("/uploads/") ? path.join(process.cwd(), url) : url.startsWith("/") ? path.join(process.cwd(), "public", url) : null;
  return p && fs.existsSync(p) ? p : null;
}

/** Start a document with the school's letterhead. */
export async function createPdf(opts: { title: string; subtitle?: string; layout?: "portrait" | "landscape"; size?: string | [number, number]; letterhead?: boolean; branchId?: string | null }) {
  const doc = new PDFDocument({ size: (opts.size as string) ?? "A4", layout: opts.layout ?? "portrait", margin: 40, bufferPages: true, info: { Title: opts.title } });
  enableTamil(doc);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  if (opts.letterhead !== false) {
    const school = await getSetting("school", opts.branchId ?? null);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const logo = logoPath(school.logoUrl);
    let textX = left;
    if (logo) {
      try { doc.image(logo, left, 34, { fit: [54, 54] }); textX = left + 64; } catch { /* ignore bad image */ }
    }
    doc.font("Helvetica-Bold").fontSize(16).fillColor("#1e1b4b").text(school.name, textX, 36, { width: width - (textX - left) });
    doc.font("Helvetica").fontSize(8.5).fillColor("#475569");
    const line2 = [school.address].filter(Boolean).join(" ");
    const line3 = [school.phone && `Phone: ${school.phone}`, school.email && `Email: ${school.email}`, school.website].filter(Boolean).join("  |  ");
    if (school.affiliation) doc.text(school.affiliation, textX, doc.y + 1, { width: width - (textX - left) });
    if (line2) doc.text(line2, textX, doc.y + 1, { width: width - (textX - left) });
    if (line3) doc.text(line3, textX, doc.y + 1, { width: width - (textX - left) });
    const y = Math.max(doc.y + 8, 96);
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1.2).strokeColor("#4338ca").stroke();
    doc.y = y + 12;
  }
  doc.x = doc.page.margins.left;
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#0f172a").text(opts.title, { align: "left" });
  if (opts.subtitle) doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(opts.subtitle);
  doc.moveDown(0.6);
  doc.fillColor("#0f172a");

  return {
    doc,
    async finish(): Promise<Buffer> {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const bottom = doc.page.height - 28;
        const prevBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font("Helvetica").fontSize(7.5).fillColor("#94a3b8").text(`Page ${i + 1} of ${range.count}  ·  Generated ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, doc.page.margins.left, bottom, { align: "right", width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
        doc.page.margins.bottom = prevBottom;
      }
      doc.end();
      return done;
    },
  };
}

export type PdfColumn = { key: string; label: string; width?: number; align?: "left" | "right" | "center"; format?: (v: unknown, row: Record<string, unknown>) => string };

/** Draw a simple table with header row, zebra stripes and page breaks. */
export function pdfTable(doc: Pdf, columns: PdfColumn[], rows: Record<string, unknown>[], opts: { fontSize?: number; totals?: Record<string, unknown> } = {}) {
  const fontSize = opts.fontSize ?? 8.5;
  const left = doc.page.margins.left;
  const totalWidth = doc.page.width - left - doc.page.margins.right;
  const fixed = columns.reduce((s, c) => s + (c.width ?? 0), 0);
  const flexCount = columns.filter((c) => !c.width).length;
  const flexW = flexCount ? (totalWidth - fixed) / flexCount : 0;
  const widths = columns.map((c) => c.width ?? flexW);
  const pad = 4;

  const cell = (c: PdfColumn, row: Record<string, unknown>) => (c.format ? c.format(row[c.key], row) : row[c.key] === null || row[c.key] === undefined ? "" : String(row[c.key]));

  const drawHeader = () => {
    const y = doc.y;
    doc.rect(left, y, totalWidth, fontSize + pad * 2 + 2).fill("#eef2ff");
    let x = left;
    doc.font("Helvetica-Bold").fontSize(fontSize).fillColor("#312e81");
    columns.forEach((c, i) => {
      doc.text(c.label, x + pad, y + pad, { width: widths[i] - pad * 2, align: c.align ?? "left", lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + fontSize + pad * 2 + 2;
  };

  const drawRow = (row: Record<string, unknown>, idx: number, bold = false) => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    const heights = columns.map((c, i) => doc.heightOfString(cell(c, row), { width: widths[i] - pad * 2 }));
    const h = Math.max(...heights, fontSize) + pad * 2;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage();
      drawHeader();
    }
    const y = doc.y;
    if (idx % 2 === 1 || bold) doc.rect(left, y, totalWidth, h).fill(bold ? "#e0e7ff" : "#f8fafc");
    let x = left;
    doc.fillColor("#0f172a").font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
    columns.forEach((c, i) => {
      doc.text(cell(c, row), x + pad, y + pad, { width: widths[i] - pad * 2, align: c.align ?? "left" });
      x += widths[i];
    });
    doc.y = y + h;
  };

  drawHeader();
  rows.forEach((r, i) => drawRow(r, i));
  if (opts.totals) drawRow(opts.totals, 0, true);
  if (!rows.length) doc.font("Helvetica-Oblique").fontSize(fontSize).fillColor("#64748b").text("No records.", left + pad, doc.y + pad);
  doc.x = left;
  doc.moveDown(0.5);
}

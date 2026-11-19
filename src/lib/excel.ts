import "server-only";
import ExcelJS from "exceljs";

export type SheetSpec = {
  name: string;
  columns: { key: string; header: string; width?: number; numFmt?: string }[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
};

export async function buildWorkbook(sheets: SheetSpec[], title?: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = title ?? "School Management System";
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ key: c.key, header: c.header, width: c.width ?? Math.max(12, c.header.length + 4), style: c.numFmt ? { numFmt: c.numFmt } : undefined }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of s.rows) ws.addRow(r);
    if (s.totals) {
      const row = ws.addRow(s.totals);
      row.font = { bold: true };
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Read the first sheet of an uploaded .xlsx into objects keyed by normalised header (lowercase, no spaces). */
export async function readSheet(data: ArrayBuffer): Promise<Record<string, string>[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cell.text ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  });
  const rows: Record<string, string>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, idx) => {
    if (idx === 1) return;
    const obj: Record<string, string> = {};
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const h = headers[col];
      if (!h) return;
      let v: unknown = cell.value;
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      else if (v && typeof v === "object" && "text" in (v as object)) v = (v as { text: string }).text;
      else if (v && typeof v === "object" && "result" in (v as object)) v = (v as { result: unknown }).result;
      obj[h] = v === null || v === undefined ? "" : String(v).trim();
    });
    if (Object.values(obj).some((x) => x !== "")) rows.push(obj);
  });
  return rows;
}

export function xlsxResponse(buf: Buffer, filename: string) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

export function pdfResponse(buf: Buffer, filename: string, inline = true) {
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": "application/pdf", "content-disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"` },
  });
}

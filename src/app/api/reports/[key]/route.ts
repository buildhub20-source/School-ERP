import { requireUserOrThrow } from "@/lib/auth/session";
import { getReport, canSeeReport } from "@/lib/reports/registry";
import { parseFilters } from "@/lib/reports/parse";
import { formatCell } from "@/lib/reports/format-cell";
import { createPdf, pdfTable } from "@/lib/pdf";
import { buildWorkbook, pdfResponse, xlsxResponse } from "@/lib/excel";
import { isoDate, fmtDate } from "@/lib/format";
import { db } from "@/lib/db";

/** Export any report: /api/reports/<key>?format=pdf|xlsx&<filters> */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const def = getReport(key);
  if (!def) return new Response("Not found", { status: 404 });
  let user;
  try { user = await requireUserOrThrow(def.perm); } catch { return new Response("Forbidden", { status: 403 }); }
  if (!canSeeReport(user, def)) return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const filters = parseFilters(url.searchParams);
  const result = await def.run(filters, { user, branchId: user.branchId });
  const format = url.searchParams.get("format") ?? "pdf";
  const file = `${key}-${isoDate()}`;
  await db.auditLog.create({ data: { userId: user.id, userName: user.name, branchId: user.branchId, action: "EXPORT", entity: "Report", entityId: key, after: { format, filters: Object.fromEntries(url.searchParams) } } });

  if (format === "xlsx") {
    const toCell = (c: (typeof result.columns)[number], v: unknown) => (c.format === "money" || c.format === "number" ? (v === null || v === undefined ? null : Number(v)) : c.format === "date" || c.format === "datetime" ? (v ? new Date(v as string) : null) : v);
    const buf = await buildWorkbook([{
      name: def.title.slice(0, 31),
      columns: result.columns.map((c) => ({ key: c.key, header: c.label, width: Math.max(14, c.label.length + 4), numFmt: c.format === "money" ? "#,##0.00" : c.format === "date" ? "dd-mmm-yyyy" : undefined })),
      rows: result.rows.map((r) => Object.fromEntries(result.columns.map((c) => [c.key, toCell(c, r[c.key])]))),
      totals: result.totals ? Object.fromEntries(result.columns.map((c) => [c.key, toCell(c, result.totals![c.key])])) : undefined,
    }]);
    return xlsxResponse(buf, `${file}.xlsx`);
  }

  const range = filters.from || filters.to ? `${filters.from ? fmtDate(filters.from) : "start"} to ${filters.to ? fmtDate(filters.to) : "today"}` : "All dates";
  const pdf = await createPdf({ title: def.title, subtitle: `${def.module} report · ${range}`, layout: result.columns.length > 6 ? "landscape" : "portrait", branchId: user.branchId });
  pdfTable(pdf.doc, result.columns.map((c) => ({ key: c.key, label: c.label, align: c.align ?? (c.format === "money" || c.format === "number" ? "right" : "left"), format: (v) => formatCell(c, v, "pdf") })), result.rows, { totals: result.totals });
  if (result.note) pdf.doc.font("Helvetica").fontSize(8).fillColor("#64748b").text(result.note);
  return pdfResponse(await pdf.finish(), `${file}.pdf`);
}

import { requireUserOrThrow } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createPdf, qrPng } from "@/lib/pdf";
import { pdfResponse } from "@/lib/excel";
import { itemWhere } from "@/server/stationery/core";

/**
 * Printable QR labels for stationery items (A4, 3 × 8 per page). Scan them at /stationery/scan.
 * ?ids=a,b  or the items-list filters (q, category, stock, supplierId). &copies=N labels per item (default 1, max 48).
 */
export async function GET(req: Request) {
  let user;
  try { user = await requireUserOrThrow("stationery.view"); } catch { return new Response("Forbidden", { status: 403 }); }
  const p = new URL(req.url).searchParams;
  const ids = p.get("ids")?.split(",").filter(Boolean);
  const copies = Math.min(48, Math.max(1, Number(p.get("copies")) || 1));
  const where = ids?.length
    ? { branchId: user.branchId, id: { in: ids } }
    : await itemWhere(user.branchId, { q: p.get("q") ?? undefined, category: p.get("category") ?? undefined, stock: p.get("stock") ?? undefined, supplierId: p.get("supplierId") ?? undefined, inactive: p.get("inactive") === "1" });
  const items = await db.stationeryItem.findMany({ where, orderBy: [{ category: "asc" }, { name: "asc" }], take: 500 });
  if (!items.length) return new Response("No items match.", { status: 404 });

  const { doc, finish } = await createPdf({ title: "Stationery item labels", subtitle: `${items.length} item(s) · scan with the phone camera on Stationery → Scan in / out`, letterhead: false, branchId: user.branchId });
  const cols = 3, rows = 8;
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const w = width / cols;
  let top = doc.y;
  let h = (doc.page.height - top - doc.page.margins.bottom - 20) / rows;
  let n = 0;
  const qrs = new Map<string, Buffer>();
  for (const it of items) qrs.set(it.id, await qrPng(it.code, 200));
  for (const it of items) {
    for (let c = 0; c < copies; c++) {
      if (n > 0 && n % (cols * rows) === 0) {
        doc.addPage();
        top = doc.page.margins.top;
        h = (doc.page.height - top - doc.page.margins.bottom - 20) / rows;
      }
      const idx = n % (cols * rows);
      const x = left + (idx % cols) * w;
      const y = top + Math.floor(idx / cols) * h;
      doc.save().lineWidth(0.4).dash(2, { space: 2 }).strokeColor("#cbd5e1").rect(x + 2, y + 2, w - 4, h - 4).stroke().undash().restore();
      const q = Math.min(h - 14, 64);
      doc.image(qrs.get(it.id)!, x + 8, y + (h - q) / 2, { width: q, height: q });
      const tx = x + 14 + q;
      const tw = w - q - 22;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text(it.name, tx, y + 10, { width: tw, height: 30, ellipsis: true });
      doc.font("Courier-Bold").fontSize(10).fillColor("#1e1b4b").text(it.code, tx, y + h / 2 + 2, { width: tw, lineBreak: false });
      doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(`${it.category} · ${it.unit}`, tx, y + h / 2 + 15, { width: tw, lineBreak: false });
      n++;
    }
  }
  return pdfResponse(await finish(), "stationery-labels.pdf");
}

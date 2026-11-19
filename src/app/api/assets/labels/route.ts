import type { Prisma } from "@prisma/client";
import { requireUserOrThrow } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { createPdf, qrPng } from "@/lib/pdf";
import { pdfResponse } from "@/lib/excel";

/** Asset tags (A4, 3 × 8): QR of the asset code, name and location. ?ids=a,b or the register filters (q, category, status, location). */
export async function GET(req: Request) {
  let user;
  try { user = await requireUserOrThrow("assets.view"); } catch { return new Response("Forbidden", { status: 403 }); }
  const p = new URL(req.url).searchParams;
  const ids = p.get("ids")?.split(",").filter(Boolean);
  const q = p.get("q"), category = p.get("category"), status = p.get("status"), location = p.get("location");
  const where: Prisma.AssetWhereInput = ids?.length ? { branchId: user.branchId, id: { in: ids } } : {
    branchId: user.branchId, status: status && status !== "ALL" ? (status as "IN_USE") : { not: "DISPOSED" },
    ...(category ? { category } : {}), ...(location ? { location } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { equals: q.toUpperCase() } }] } : {}),
  };
  const assets = await db.asset.findMany({ where, orderBy: { code: "asc" }, take: 500 });
  if (!assets.length) return new Response("No assets match.", { status: 404 });
  const school = await getSetting("school", user.branchId);
  const { doc, finish } = await createPdf({ title: "Asset tags", subtitle: `${assets.length} tag(s) · enter or scan the code on Assets → Verify`, letterhead: false, branchId: user.branchId });
  const cols = 3, rows = 8, left = doc.page.margins.left;
  const w = (doc.page.width - left - doc.page.margins.right) / cols;
  let top = doc.y, h = (doc.page.height - top - doc.page.margins.bottom - 20) / rows;
  for (const [n, a] of assets.entries()) {
    if (n > 0 && n % (cols * rows) === 0) { doc.addPage(); top = doc.page.margins.top; h = (doc.page.height - top - doc.page.margins.bottom - 20) / rows; }
    const idx = n % (cols * rows), x = left + (idx % cols) * w, y = top + Math.floor(idx / cols) * h;
    doc.save().lineWidth(0.4).dash(2, { space: 2 }).strokeColor("#cbd5e1").rect(x + 2, y + 2, w - 4, h - 4).stroke().undash().restore();
    const qs = Math.min(h - 14, 60);
    doc.image(await qrPng(a.code, 200), x + 8, y + (h - qs) / 2, { width: qs, height: qs });
    const tx = x + 14 + qs, tw = w - qs - 22;
    doc.font("Helvetica").fontSize(6.5).fillColor("#64748b").text(`Property of ${school.name}`, tx, y + 8, { width: tw, lineBreak: false, ellipsis: true });
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text(a.name, tx, y + 18, { width: tw, height: 20, ellipsis: true });
    doc.font("Courier-Bold").fontSize(11).fillColor("#0f172a").text(a.code, tx, y + h / 2 + 4, { width: tw, lineBreak: false });
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(a.location ?? a.category, tx, y + h / 2 + 17, { width: tw, lineBreak: false, ellipsis: true });
  }
  return pdfResponse(await finish(), "asset-tags.pdf");
}

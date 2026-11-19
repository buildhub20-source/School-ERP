import { requireUserOrThrow } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { createPdf, pdfDate, pdfMoney, pdfTable } from "@/lib/pdf";
import { pdfResponse } from "@/lib/excel";
import { toNum } from "@/lib/format";

/** Purchase order PDF on the school letterhead, to send to the supplier. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireUserOrThrow("stationery.view"); } catch { return new Response("Forbidden", { status: 403 }); }
  const { id } = await params;
  const po = await db.purchaseOrder.findFirst({ where: { id, branchId: user.branchId, type: "STATIONERY" }, include: { supplier: true, lines: { include: { stationeryItem: true }, orderBy: { id: "asc" } } } });
  if (!po) return new Response("Not found", { status: 404 });
  const { doc, finish } = await createPdf({ title: `Purchase Order ${po.poNumber}`, subtitle: `Date: ${pdfDate(po.orderedAt ?? po.createdAt)}  ·  Status: ${po.status.replace(/_/g, " ").toLowerCase()}`, branchId: user.branchId });
  doc.font("Helvetica-Bold").fontSize(9.5).text("To:");
  doc.font("Helvetica").fontSize(9).text([po.supplier.name, po.supplier.contactPerson, po.supplier.address, po.supplier.phone && `Phone: ${po.supplier.phone}`, po.supplier.email, po.supplier.gstin && `GSTIN: ${po.supplier.gstin}`].filter(Boolean).join("\n"));
  if (po.expectedDate) doc.moveDown(0.3).text(`Expected delivery: ${pdfDate(po.expectedDate)}`);
  doc.moveDown(0.6);
  const rows = po.lines.map((l, i) => ({ n: i + 1, code: l.stationeryItem?.code ?? "", item: l.stationeryItem?.name ?? "", qty: `${l.qtyOrdered} ${l.stationeryItem?.unit ?? ""}`, price: toNum(l.unitPrice), amount: l.qtyOrdered * toNum(l.unitPrice) }));
  pdfTable(doc, [
    { key: "n", label: "#", width: 24 }, { key: "code", label: "Code", width: 70 }, { key: "item", label: "Item" }, { key: "qty", label: "Quantity", width: 70, align: "right" },
    { key: "price", label: "Unit price", width: 80, align: "right", format: (v) => (v === "" ? "" : pdfMoney(v)) }, { key: "amount", label: "Amount", width: 90, align: "right", format: (v) => (v === "" ? "" : pdfMoney(v)) },
  ], rows, { totals: { n: "", code: "", item: "Total", qty: "", price: "", amount: rows.reduce((s, r) => s + r.amount, 0) } });
  if (po.notes) doc.moveDown(0.5).font("Helvetica").fontSize(8.5).fillColor("#475569").text(`Notes: ${po.notes}`);
  doc.moveDown(3).fillColor("#0f172a").fontSize(9).text("Authorised signatory", { align: "right" });
  return pdfResponse(await finish(), `${po.poNumber.replace(/\//g, "-")}.pdf`);
}

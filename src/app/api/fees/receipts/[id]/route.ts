import { db } from "@/lib/db";
import { pdfResponse } from "@/lib/excel";
import { toNum } from "@/lib/format";
import { receiptPdf } from "@/server/fees/receipts";
import { feeDocAccess } from "../../_access";

/** Receipt PDF (with QR verification). Parents: own children only. Transport-only staff: transport receipts only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await db.payment.findUnique({ where: { id }, include: { allocations: { include: { studentFee: { include: { feeHead: true } } } } } });
  if (!p || !p.receiptNo) return new Response("Not found", { status: 404 });
  const access = await feeDocAccess(p.studentId);
  if (!access.ok) return new Response(access.status === 401 ? "Unauthorized" : "Forbidden", { status: access.status });
  if (access.scope === "transport") {
    const positive = p.allocations.filter((a) => toNum(a.amount) > 0);
    if (p.purpose !== "FEE" || !positive.length || positive.some((a) => a.studentFee.feeHead.type !== "TRANSPORT")) return new Response("Forbidden", { status: 403 });
  }
  const buf = await receiptPdf(p.id);
  return pdfResponse(buf, `${p.receiptNo.replace(/\//g, "-")}.pdf`);
}

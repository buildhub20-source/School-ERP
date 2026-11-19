import { requireUserOrThrow } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";
import { fmtDateTime, isoDate, toNum } from "@/lib/format";
import { MOVEMENT_LABELS, RECIPIENT_LABELS } from "@/server/stationery/core";
import { movementFilterFrom, movementWhere } from "@/server/stationery/movements";

/** Excel export of the stock movement log with the same filters as /stationery/movements. */
export async function GET(req: Request) {
  let user;
  try { user = await requireUserOrThrow("stationery.view"); } catch { return new Response("Forbidden", { status: 403 }); }
  const p = new URL(req.url).searchParams;
  const where = movementWhere(user.branchId, movementFilterFrom((k) => p.get(k) || undefined));
  const rows = await db.stockMovement.findMany({
    where, orderBy: { createdAt: "desc" }, take: 20000,
    include: { item: true, createdBy: { select: { name: true } }, recipientUser: { select: { name: true } }, student: { select: { firstName: true, lastName: true, admissionNo: true } }, schoolClass: true, department: true, request: { select: { requestNo: true } } },
  });
  const data = rows.map((m) => ({
    when: fmtDateTime(m.createdAt), code: m.item.code, item: m.item.name, type: MOVEMENT_LABELS[m.type], qty: m.qty, balance: m.balanceAfter, unitCost: toNum(m.unitCost), value: Math.abs(m.qty) * toNum(m.unitCost),
    recipientType: m.recipientType ? RECIPIENT_LABELS[m.recipientType] : "", recipient: m.student ? `${m.student.firstName} ${m.student.lastName ?? ""} (${m.student.admissionNo})` : m.recipientUser?.name ?? "",
    chargedTo: m.schoolClass?.name ?? m.department?.name ?? "", request: m.request?.requestNo ?? "", by: m.createdBy?.name ?? "System", note: m.note ?? "",
  }));
  const cols = [
    { key: "when", header: "When", width: 20 }, { key: "code", header: "Code" }, { key: "item", header: "Item", width: 30 }, { key: "type", header: "Type" }, { key: "qty", header: "Qty" }, { key: "balance", header: "Balance" },
    { key: "unitCost", header: "Unit cost", numFmt: "#,##0.00" }, { key: "value", header: "Value", numFmt: "#,##0.00" }, { key: "recipientType", header: "Recipient type" }, { key: "recipient", header: "Recipient", width: 28 },
    { key: "chargedTo", header: "Charged to" }, { key: "request", header: "Request" }, { key: "by", header: "Recorded by", width: 20 }, { key: "note", header: "Note", width: 40 },
  ];
  return xlsxResponse(await buildWorkbook([{ name: "Movements", columns: cols, rows: data }]), `stationery-movements-${isoDate()}.xlsx`);
}

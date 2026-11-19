import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { addDays, today, toNum, isoDate } from "@/lib/format";
import { createPdf, pdfMoney, pdfTable } from "@/lib/pdf";
import { sendExternal } from "@/lib/messaging/notify";
import { lowStockIds } from "@/server/stationery/core";

export async function periodSummary(branchId: string, from: Date, to: Date) {
  const [payments, dues, issued, lowStock, uniformOrders, buses, activeAlloc, students] = await Promise.all([
    db.payment.groupBy({ by: ["mode"], where: { branchId, status: "SUCCESS", purpose: "FEE", paidAt: { gte: from, lt: to } }, _sum: { amount: true }, _count: true }),
    db.studentFee.aggregate({ where: { student: { branchId }, status: { in: ["PENDING", "PARTIAL"] }, dueDate: { lt: to } }, _sum: { balance: true }, _count: true }),
    db.stockMovement.aggregate({ where: { item: { branchId }, type: "ISSUE", createdAt: { gte: from, lt: to } }, _sum: { qty: true } }),
    lowStockIds(branchId, { anyReorderLevel: true }),
    db.uniformOrder.groupBy({ by: ["status"], where: { branchId, createdAt: { gte: from, lt: to } }, _count: true }),
    db.bus.findMany({ where: { branchId, isActive: true }, select: { capacity: true } }),
    db.transportAllocation.count({ where: { status: "ACTIVE", bus: { branchId } } }),
    db.student.count({ where: { branchId, status: "ACTIVE" } }),
  ]);
  const collected = payments.reduce((s, p) => s + toNum(p._sum.amount), 0);
  return {
    collected, byMode: payments.map((p) => ({ mode: p.mode, count: p._count, amount: toNum(p._sum.amount) })),
    pendingDues: toNum(dues._sum.balance), pendingCount: dues._count,
    stationeryIssued: Math.abs(issued._sum.qty ?? 0), lowStock: lowStock.length,
    uniformOrders: uniformOrders.map((u) => ({ status: u.status, count: u._count })),
    seats: buses.reduce((s, b) => s + b.capacity, 0), seatsFilled: activeAlloc, students,
  };
}

async function sendSummary(branchId: string, label: string, from: Date, to: Date) {
  const school = await getSetting("school", branchId);
  const recipients = new Set<string>();
  if (school.principalEmail) recipients.add(school.principalEmail);
  const admins = await db.user.findMany({ where: { branchId, isActive: true, email: { not: null }, role: { key: { in: ["SUPER_ADMIN", "SCHOOL_ADMIN"] } } }, select: { email: true } });
  admins.forEach((a) => a.email && recipients.add(a.email));
  if (!recipients.size) return 0;
  const s = await periodSummary(branchId, from, to);
  const range = `${isoDate(from)} to ${isoDate(addDays(to, -1))}`;
  const pdf = await createPdf({ title: `${label} summary`, subtitle: range, branchId });
  pdf.doc.font("Helvetica-Bold").fontSize(10).text("Key figures");
  pdfTable(pdf.doc, [{ key: "k", label: "Measure" }, { key: "v", label: "Value", align: "right", width: 160 }], [
    { k: "Active students", v: String(s.students) },
    { k: "Fees collected", v: pdfMoney(s.collected) },
    { k: "Pending dues (due so far)", v: `${pdfMoney(s.pendingDues)} (${s.pendingCount} items)` },
    { k: "Stationery items issued", v: String(s.stationeryIssued) },
    { k: "Stationery items at or below reorder level", v: String(s.lowStock) },
    { k: "Bus seats filled", v: `${s.seatsFilled} / ${s.seats}` },
  ]);
  pdf.doc.font("Helvetica-Bold").fontSize(10).text("Fee collection by payment mode");
  pdfTable(pdf.doc, [{ key: "mode", label: "Mode" }, { key: "count", label: "Payments", align: "right", width: 90 }, { key: "amount", label: "Amount", align: "right", width: 130, format: (v) => pdfMoney(v) }], s.byMode);
  pdf.doc.font("Helvetica-Bold").fontSize(10).text("Uniform orders placed");
  pdfTable(pdf.doc, [{ key: "status", label: "Status" }, { key: "count", label: "Orders", align: "right", width: 90 }], s.uniformOrders);
  const buf = await pdf.finish();
  const body = [
    `${label} summary for ${school.name} (${range})`, "",
    `Fees collected: Rs. ${s.collected.toLocaleString("en-IN")}`,
    `Pending dues: Rs. ${s.pendingDues.toLocaleString("en-IN")} across ${s.pendingCount} items`,
    `Stationery issued: ${s.stationeryIssued} items; ${s.lowStock} items at or below reorder level`,
    `Bus seats filled: ${s.seatsFilled} of ${s.seats}`, "",
    "The full summary is attached as a PDF.",
  ].join("\n");
  for (const to of recipients) await sendExternal("EMAIL", to, { subject: `${school.name}: ${label} summary (${range})`, body, category: "REPORT", branchId, attachments: [{ filename: `summary-${isoDate(from)}.pdf`, content: buf }] });
  return recipients.size;
}

/** Daily check: on Mondays send the past week's summary; on the last day of the month send the month's summary. */
export async function scheduledReports(config: Record<string, unknown>): Promise<string> {
  const t = today();
  const isMonday = t.getUTCDay() === 1;
  const isMonthEnd = addDays(t, 1).getUTCDate() === 1;
  const done: string[] = [];
  const branches = await db.branch.findMany({ where: { isActive: true } });
  for (const b of branches) {
    if (isMonday && config.weekly !== false) done.push(`weekly → ${await sendSummary(b.id, "Weekly", addDays(t, -7), t)} recipient(s)`);
    if (isMonthEnd && config.monthEnd !== false) {
      const from = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
      done.push(`monthly → ${await sendSummary(b.id, "Monthly", from, addDays(t, 1))} recipient(s)`);
    }
  }
  return done.length ? done.join("; ") : "Not a Monday or month-end; nothing to send";
}

export { sendSummary };

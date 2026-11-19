import "server-only";
import { db } from "@/lib/db";
import { createPdf, pdfDate, pdfMoney, pdfTable, qrPng } from "@/lib/pdf";
import { getSetting } from "@/lib/settings";
import { absoluteUrl, notifyGuardians, sendExternal } from "@/lib/messaging/notify";
import { fullName, className, money, round2, toNum, fmtDateTime } from "@/lib/format";
import { AppError } from "@/lib/errors";
import { amountInWords, lineScopeWhere, MODE_LABEL, type FeeScope } from "./access";
import { feeNet } from "./core";

export type ReceiptChannel = "SMS" | "WHATSAPP" | "EMAIL";

export const verifyUrl = (token: string) => absoluteUrl(`/verify/receipt/${token}`);

export async function loadReceipt(paymentId: string) {
  const p = await db.payment.findUnique({
    where: { id: paymentId },
    include: {
      student: { include: { schoolClass: true, section: true } },
      allocations: { include: { studentFee: { include: { feeHead: true, term: true } } } },
      uniformOrder: true, refunds: true, dayClosing: true,
    },
  });
  if (!p) throw new AppError("Payment not found.");
  const collectedBy = p.collectedById ? await db.user.findUnique({ where: { id: p.collectedById }, select: { name: true } }) : null;
  return { ...p, collectedByName: collectedBy?.name ?? null };
}
export type ReceiptData = Awaited<ReturnType<typeof loadReceipt>>;

/** Lines printed on the receipt: the original (positive) allocations; refunds are shown separately. */
export function receiptLines(p: ReceiptData) {
  if (p.purpose === "UNIFORM") return [{ description: `Uniform order ${p.uniformOrder?.orderNo ?? ""}`.trim(), head: "Uniform", amount: toNum(p.amount) }];
  return p.allocations.filter((a) => toNum(a.amount) > 0).map((a) => ({ description: a.studentFee.description, head: a.studentFee.feeHead.name, amount: toNum(a.amount) }));
}

export async function receiptPdf(paymentId: string): Promise<Buffer> {
  const p = await loadReceipt(paymentId);
  if (!p.receiptNo) throw new AppError("This payment has no receipt (it did not complete).");
  const { doc, finish } = await createPdf({ title: p.purpose === "UNIFORM" ? "Payment Receipt — Uniform" : "Fee Receipt", subtitle: `Receipt No: ${p.receiptNo}`, size: "A5", branchId: p.branchId });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const y0 = doc.y;
  const info: [string, string][] = [
    ["Receipt No", p.receiptNo],
    ["Date", fmtDateTime(p.paidAt)],
    ["Student", fullName(p.student)],
    ["Admission No", p.student.admissionNo],
    ["Class", className(p.student.schoolClass, p.student.section)],
    ["Payment mode", `${MODE_LABEL[p.mode]}${p.source === "ONLINE" ? " (online)" : ""}`],
  ];
  if (p.mode === "CHEQUE") info.push(["Cheque", `${p.reference ?? ""} · ${p.chequeBank ?? ""} · ${pdfDate(p.chequeDate)}`]);
  else if (p.reference) info.push(["Reference", p.reference]);
  if (p.gatewayPaymentId) info.push(["Gateway txn", p.gatewayPaymentId]);
  doc.fontSize(8.5);
  for (const [k, v] of info) {
    const y = doc.y;
    doc.font("Helvetica").fillColor("#64748b").text(k, left, y, { width: 80 });
    doc.font("Helvetica-Bold").fillColor("#0f172a").text(v, left + 82, y, { width: width - 82 - 92 });
    doc.y = Math.max(doc.y, y + 12);
  }
  const qr = await qrPng(verifyUrl(p.verifyToken), 160);
  doc.image(qr, left + width - 84, y0, { width: 84 });
  doc.font("Helvetica").fontSize(6.5).fillColor("#64748b").text("Scan to verify", left + width - 84, y0 + 86, { width: 84, align: "center" });
  doc.x = left;
  doc.y = Math.max(doc.y, y0 + 100) + 4;

  const lines = receiptLines(p);
  pdfTable(doc, [
    { key: "description", label: "Particulars" },
    { key: "amount", label: "Amount", width: 90, align: "right", format: (v) => pdfMoney(v) },
  ], lines, { totals: { description: "Total", amount: toNum(p.amount) } });
  doc.font("Helvetica-Oblique").fontSize(8).fillColor("#334155").text(amountInWords(toNum(p.amount)), left, doc.y, { width });
  doc.moveDown(0.5);
  if (toNum(p.refundedAmount) > 0) doc.font("Helvetica").fontSize(8).fillColor("#b45309").text(`Refunded against this receipt: ${pdfMoney(p.refundedAmount)}`, left, doc.y, { width });

  if (p.status !== "SUCCESS") {
    const label = p.status === "BOUNCED" ? "CHEQUE BOUNCED" : p.status;
    doc.save();
    doc.rotate(-25, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font("Helvetica-Bold").fontSize(48).fillColor("#e11d48").opacity(0.18).text(label, 0, doc.page.height / 2 - 30, { width: doc.page.width, align: "center" });
    doc.restore();
    doc.opacity(1);
  }
  doc.moveDown(1.2);
  doc.font("Helvetica").fontSize(7.5).fillColor("#64748b")
    .text(`${p.collectedByName ? `Received by ${p.collectedByName}. ` : ""}This is a computer-generated receipt and does not need a signature. Verify it at ${verifyUrl(p.verifyToken)}`, left, doc.y, { width });
  return finish();
}

/** Fee statement: every line grouped by academic year, plus payments. Transport scope shows only transport lines. */
export async function statementPdf(studentId: string, scope: FeeScope): Promise<Buffer> {
  const s = await db.student.findUnique({ where: { id: studentId }, include: { schoolClass: true, section: true } });
  if (!s) throw new AppError("Student not found.");
  const [lines, payments] = await Promise.all([
    db.studentFee.findMany({ where: { studentId, status: { not: "CANCELLED" }, ...lineScopeWhere(scope) }, include: { academicYear: true, feeHead: true }, orderBy: [{ academicYear: { startDate: "asc" } }, { dueDate: "asc" }] }),
    db.payment.findMany({ where: { studentId, status: { in: ["SUCCESS", "BOUNCED", "CANCELLED"] }, receiptNo: { not: null }, ...(scope === "transport" ? { allocations: { some: { studentFee: { feeHead: { type: "TRANSPORT" } } } } } : {}) }, include: { allocations: { include: { studentFee: { include: { feeHead: true } } } } }, orderBy: { paidAt: "asc" } }),
  ]);
  const { doc, finish } = await createPdf({ title: scope === "transport" ? "Transport Fee Statement" : "Fee Statement", subtitle: `${fullName(s)} · ${s.admissionNo} · ${className(s.schoolClass, s.section)} · as on ${pdfDate(new Date())}`, layout: "landscape", branchId: s.branchId });
  const years = [...new Map(lines.map((l) => [l.academicYearId, l.academicYear])).values()];
  let gNet = 0, gPaid = 0, gBal = 0;
  for (const y of years) {
    const rows = lines.filter((l) => l.academicYearId === y.id).map((l) => ({
      description: l.description, due: pdfDate(l.dueDate), amount: toNum(l.amount), concession: toNum(l.concessionAmount), late: toNum(l.lateFeeAmount),
      adjustment: toNum(l.adjustmentAmount), paid: toNum(l.paidAmount), balance: toNum(l.balance), status: l.status,
    }));
    const t = rows.reduce((a, r) => ({ amount: a.amount + r.amount, concession: a.concession + r.concession, late: a.late + r.late, adjustment: a.adjustment + r.adjustment, paid: a.paid + r.paid, balance: a.balance + r.balance }), { amount: 0, concession: 0, late: 0, adjustment: 0, paid: 0, balance: 0 });
    gNet += t.amount - t.concession + t.late + t.adjustment; gPaid += t.paid; gBal += t.balance;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#1e1b4b").text(`Academic year ${y.name}`);
    doc.moveDown(0.3);
    const m = (v: unknown) => (toNum(v as number) ? pdfMoney(v) : "-");
    pdfTable(doc, [
      { key: "description", label: "Fee" }, { key: "due", label: "Due date", width: 70 },
      { key: "amount", label: "Amount", width: 72, align: "right", format: m }, { key: "concession", label: "Concession", width: 70, align: "right", format: m },
      { key: "late", label: "Late fee", width: 62, align: "right", format: m }, { key: "adjustment", label: "Adjustment", width: 68, align: "right", format: m },
      { key: "paid", label: "Paid", width: 72, align: "right", format: m }, { key: "balance", label: "Balance", width: 72, align: "right", format: (v) => pdfMoney(v) },
      { key: "status", label: "Status", width: 58 },
    ], rows, { totals: { description: "Total", due: "", ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, round2(v)])), status: "" }, fontSize: 8 });
  }
  if (!years.length) doc.font("Helvetica-Oblique").fontSize(9).text("No fees on this account.");
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(`Total payable ${pdfMoney(round2(gNet))}   ·   Paid ${pdfMoney(round2(gPaid))}   ·   Balance ${pdfMoney(round2(gBal))}${gBal < 0 ? " (credit)" : ""}`);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#1e1b4b").text("Payments");
  doc.moveDown(0.3);
  pdfTable(doc, [
    { key: "receiptNo", label: "Receipt no", width: 150 }, { key: "date", label: "Date", width: 80 }, { key: "mode", label: "Mode", width: 90 },
    { key: "reference", label: "Reference" }, { key: "amount", label: "Amount", width: 85, align: "right", format: (v) => pdfMoney(v) },
    { key: "refunded", label: "Refunded", width: 75, align: "right", format: (v) => (toNum(v as number) ? pdfMoney(v) : "-") }, { key: "status", label: "Status", width: 70 },
  ], payments.map((p) => {
    const transportAmt = round2(p.allocations.filter((a) => a.studentFee.feeHead.type === "TRANSPORT" && toNum(a.amount) > 0).reduce((x, a) => x + toNum(a.amount), 0));
    return {
      receiptNo: p.receiptNo, date: pdfDate(p.paidAt), mode: MODE_LABEL[p.mode], reference: p.reference ?? p.gatewayPaymentId ?? "",
      amount: scope === "transport" ? transportAmt : toNum(p.amount), refunded: scope === "transport" ? 0 : toNum(p.refundedAmount), status: p.status === "SUCCESS" ? "Valid" : p.status,
    };
  }), { fontSize: 8 });
  return finish();
}

/** Send a receipt to the student's guardians on the chosen channels (email gets the PDF attached). */
export async function sendReceipt(paymentId: string, channels: ReceiptChannel[]) {
  const p = await loadReceipt(paymentId);
  if (!p.receiptNo || p.status !== "SUCCESS") throw new AppError("Only a valid receipt can be sent.");
  const school = await getSetting("school", p.branchId);
  const text = `${school.name}: Received ${money(p.amount)} for ${fullName(p.student)} (${p.student.schoolClass.name}) by ${MODE_LABEL[p.mode]}. Receipt ${p.receiptNo} dated ${fmtDateTime(p.paidAt)}. Verify: ${verifyUrl(p.verifyToken)}`;
  const pdf = channels.includes("EMAIL") ? await receiptPdf(p.id) : null;
  const links = await db.studentGuardian.findMany({ where: { studentId: p.studentId }, include: { guardian: { include: { user: true } } } });
  let sent = 0;
  for (const l of links) {
    const g = l.guardian;
    for (const ch of channels) {
      if (ch === "EMAIL") {
        const email = g.email ?? g.user?.email;
        if (!email) continue;
        await sendExternal("EMAIL", email, { subject: `Fee receipt ${p.receiptNo}`, body: `Dear ${g.name},\n\n${text}\n\nThe receipt is attached.\n\n${school.name}`, category: "FEES", userId: g.userId ?? undefined, branchId: p.branchId, attachments: pdf ? [{ filename: `${p.receiptNo.replace(/\//g, "-")}.pdf`, content: pdf }] : undefined });
      } else {
        await sendExternal(ch, g.phone, { body: text, category: "FEES", userId: g.userId ?? undefined, branchId: p.branchId });
      }
      sent++;
    }
  }
  return sent;
}

/** Automation fees.onlineReceipt: in-app + preferred channel to every guardian, PDF attached for email. */
export async function sendOnlineReceipt(paymentId: string) {
  const p = await loadReceipt(paymentId);
  if (!p.receiptNo) return;
  const pdf = await receiptPdf(p.id);
  await notifyGuardians(p.studentId, {
    title: `Payment received — receipt ${p.receiptNo}`,
    body: `We received ${money(p.amount)} for ${fullName(p.student)} (${p.student.schoolClass.name}) by ${MODE_LABEL[p.mode]} online. Verify the receipt: ${verifyUrl(p.verifyToken)}`,
    link: "/parent/fees", category: "FEES", template: "FEE_RECEIPT",
    ta: {
      title: `கட்டணம் பெறப்பட்டது — ரசீது ${p.receiptNo}`,
      body: `${fullName(p.student)} (${p.student.schoolClass.name}) க்கான ${money(p.amount)} ஆன்லைனில் (${MODE_LABEL[p.mode]}) பெறப்பட்டது. ரசீதைச் சரிபார்க்க: ${verifyUrl(p.verifyToken)}`,
    },
    attachments: [{ filename: `${p.receiptNo.replace(/\//g, "-")}.pdf`, content: pdf }],
  });
}

/** Net payable of a list of lines (for summaries). */
export function sumNet(lines: Parameters<typeof feeNet>[0][]) {
  return round2(lines.reduce((s, l) => s + feeNet(l), 0));
}

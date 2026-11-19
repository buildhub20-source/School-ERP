import "server-only";
import { db } from "@/lib/db";
import { buildWorkbook } from "@/lib/excel";
import { fullName, isoDate, round2, toNum, fmtDateTime } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import { istDayRange, MODE_LABEL } from "./access";

export type ExportOpts = { from: string; to: string; cashLedger?: string; bankLedger?: string; company?: string };

async function load(branchId: string, o: ExportOpts) {
  const range = { gte: istDayRange(o.from).gte, lt: istDayRange(o.to).lt };
  const [payments, refunds] = await Promise.all([
    db.payment.findMany({
      where: { branchId, receiptNo: { not: null }, paidAt: range, status: { in: ["SUCCESS", "CANCELLED", "BOUNCED"] } },
      include: { student: { include: { schoolClass: true, section: true } }, allocations: { include: { studentFee: { include: { feeHead: true } } } }, uniformOrder: true },
      orderBy: { paidAt: "asc" },
    }),
    db.refund.findMany({ where: { status: "APPROVED", decidedAt: range, student: { branchId } }, include: { student: true, payment: { include: { allocations: { include: { studentFee: { include: { feeHead: true } } } } } } }, orderBy: { decidedAt: "asc" } }),
  ]);
  return { payments, refunds };
}

/** Income ledger split of a receipt: original allocations by fee head (uniform payments → "Uniform Sales"). */
function ledgerSplit(p: Awaited<ReturnType<typeof load>>["payments"][number]) {
  if (p.purpose === "UNIFORM") return [{ ledger: "Uniform Sales", amount: toNum(p.amount) }];
  const m = new Map<string, number>();
  for (const a of p.allocations) if (toNum(a.amount) > 0) m.set(a.studentFee.feeHead.name, round2((m.get(a.studentFee.feeHead.name) ?? 0) + toNum(a.amount)));
  return [...m.entries()].map(([ledger, amount]) => ({ ledger, amount }));
}

export async function exportExcel(branchId: string, o: ExportOpts) {
  const { payments, refunds } = await load(branchId, o);
  const heads = [...new Set(payments.flatMap((p) => ledgerSplit(p).map((l) => l.ledger)))].sort();
  const rows = payments.map((p) => {
    const split = Object.fromEntries(ledgerSplit(p).map((l) => [`h:${l.ledger}`, l.amount]));
    return {
      receiptNo: p.receiptNo, date: isoDate(p.paidAt), time: fmtDateTime(p.paidAt), admissionNo: p.student.admissionNo, student: fullName(p.student),
      className: p.student.schoolClass.name + (p.student.section ? ` - ${p.student.section.name}` : ""), purpose: p.purpose, mode: MODE_LABEL[p.mode], source: p.source,
      reference: p.reference ?? p.gatewayPaymentId ?? "", chequeBank: p.chequeBank ?? "", amount: toNum(p.amount), refunded: toNum(p.refundedAmount),
      status: p.status, reconciled: p.reconciled ? "Yes" : "No", ...split,
    };
  });
  const valid = rows.filter((r) => r.status === "SUCCESS");
  const totals: Record<string, unknown> = { receiptNo: "Total (valid)", amount: round2(valid.reduce((s, r) => s + r.amount, 0)), refunded: round2(valid.reduce((s, r) => s + r.refunded, 0)) };
  for (const h of heads) totals[`h:${h}`] = round2(valid.reduce((s, r) => s + toNum((r as Record<string, unknown>)[`h:${h}`] as number), 0));
  const money = "#,##0.00";
  return buildWorkbook([
    {
      name: "Receipts",
      columns: [
        { key: "receiptNo", header: "Receipt No", width: 24 }, { key: "date", header: "Date", width: 12 }, { key: "time", header: "Date & time", width: 20 },
        { key: "admissionNo", header: "Admission No", width: 14 }, { key: "student", header: "Student", width: 24 }, { key: "className", header: "Class", width: 12 },
        { key: "purpose", header: "Purpose" }, { key: "mode", header: "Mode" }, { key: "source", header: "Source" }, { key: "reference", header: "Reference", width: 22 },
        { key: "chequeBank", header: "Cheque bank" }, { key: "amount", header: "Amount", numFmt: money }, { key: "refunded", header: "Refunded", numFmt: money },
        { key: "status", header: "Status" }, { key: "reconciled", header: "Reconciled" },
        ...heads.map((h) => ({ key: `h:${h}`, header: h, numFmt: money, width: 16 })),
      ],
      rows, totals,
    },
    {
      name: "Refunds",
      columns: [{ key: "date", header: "Date", width: 12 }, { key: "receiptNo", header: "Against receipt", width: 24 }, { key: "admissionNo", header: "Admission No" }, { key: "student", header: "Student", width: 24 }, { key: "mode", header: "Mode" }, { key: "amount", header: "Amount", numFmt: money }, { key: "reason", header: "Reason", width: 40 }, { key: "note", header: "Payout / note", width: 30 }],
      rows: refunds.map((r) => ({ date: isoDate(r.decidedAt), receiptNo: r.payment.receiptNo, admissionNo: r.student.admissionNo, student: fullName(r.student), mode: MODE_LABEL[r.mode], amount: toNum(r.amount), reason: r.reason, note: r.decisionNote ?? "" })),
    },
  ], "Fee receipts export");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const tdate = (d: Date) => isoDate(d).replace(/-/g, "");
const amt = (n: number) => n.toFixed(2);

/**
 * Tally-compatible XML (Import Data → Vouchers). Each valid receipt is a Receipt voucher: Cash / Bank ledger debited,
 * one income ledger per fee head credited. Approved refunds are Payment vouchers. Cancelled / bounced receipts are left out.
 */
export async function exportTallyXml(branchId: string, o: ExportOpts) {
  const { payments, refunds } = await load(branchId, o);
  const school = await getSetting("school", branchId);
  const company = o.company?.trim() || school.name;
  const cash = o.cashLedger?.trim() || "Cash";
  const bank = o.bankLedger?.trim() || "Bank Account";
  const vouchers: string[] = [];
  for (const p of payments.filter((x) => x.status === "SUCCESS")) {
    const total = toNum(p.amount);
    const split = ledgerSplit(p);
    const diff = round2(total - split.reduce((s, l) => s + l.amount, 0));
    if (Math.abs(diff) > 0.009) split.push({ ledger: "Fee Advance", amount: diff });
    const party = p.mode === "CASH" ? cash : bank;
    const narration = `Receipt ${p.receiptNo} - ${fullName(p.student)} (${p.student.admissionNo}, ${p.student.schoolClass.name}) - ${MODE_LABEL[p.mode]}${p.reference ? ` ${p.reference}` : ""}`;
    vouchers.push(`  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <VOUCHER VCHTYPE="Receipt" ACTION="Create" OBJVIEW="Accounting Voucher View">
    <DATE>${tdate(p.paidAt)}</DATE>
    <EFFECTIVEDATE>${tdate(p.paidAt)}</EFFECTIVEDATE>
    <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
    <VOUCHERNUMBER>${esc(p.receiptNo!)}</VOUCHERNUMBER>
    <REFERENCE>${esc(p.reference ?? p.gatewayPaymentId ?? "")}</REFERENCE>
    <PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>
    <NARRATION>${esc(narration)}</NARRATION>
    <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
    <ALLLEDGERENTRIES.LIST>
     <LEDGERNAME>${esc(party)}</LEDGERNAME>
     <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
     <AMOUNT>-${amt(total)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
${split.map((l) => `    <ALLLEDGERENTRIES.LIST>
     <LEDGERNAME>${esc(l.ledger)}</LEDGERNAME>
     <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
     <AMOUNT>${amt(l.amount)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>`).join("\n")}
   </VOUCHER>
  </TALLYMESSAGE>`);
  }
  for (const r of refunds) {
    const total = toNum(r.amount);
    const party = r.mode === "CASH" ? cash : bank;
    vouchers.push(`  <TALLYMESSAGE xmlns:UDF="TallyUDF">
   <VOUCHER VCHTYPE="Payment" ACTION="Create" OBJVIEW="Accounting Voucher View">
    <DATE>${tdate(r.decidedAt!)}</DATE>
    <EFFECTIVEDATE>${tdate(r.decidedAt!)}</EFFECTIVEDATE>
    <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
    <VOUCHERNUMBER>${esc(`RF-${r.id.slice(-8).toUpperCase()}`)}</VOUCHERNUMBER>
    <REFERENCE>${esc(r.payment.receiptNo ?? "")}</REFERENCE>
    <PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>
    <NARRATION>${esc(`Fee refund against receipt ${r.payment.receiptNo} - ${fullName(r.student)} (${r.student.admissionNo}) - ${r.reason}`)}</NARRATION>
    <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
    <ALLLEDGERENTRIES.LIST>
     <LEDGERNAME>Fee Refunds</LEDGERNAME>
     <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
     <AMOUNT>-${amt(total)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
    <ALLLEDGERENTRIES.LIST>
     <LEDGERNAME>${esc(party)}</LEDGERNAME>
     <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
     <AMOUNT>${amt(total)}</AMOUNT>
    </ALLLEDGERENTRIES.LIST>
   </VOUCHER>
  </TALLYMESSAGE>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
${vouchers.join("\n")}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`;
}

export async function exportSummary(branchId: string, o: ExportOpts) {
  const { payments, refunds } = await load(branchId, o);
  const valid = payments.filter((p) => p.status === "SUCCESS");
  return { receipts: valid.length, amount: round2(valid.reduce((s, p) => s + toNum(p.amount), 0)), excluded: payments.length - valid.length, refunds: refunds.length, refundAmount: round2(refunds.reduce((s, r) => s + toNum(r.amount), 0)) };
}

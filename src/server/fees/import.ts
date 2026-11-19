import "server-only";
import type { PaymentMode } from "@prisma/client";
import { db } from "@/lib/db";
import { readSheet } from "@/lib/excel";
import { currentAcademicYear } from "@/lib/settings";
import { round2, toNum, today } from "@/lib/format";
import { createFeeLine, recordPayment } from "./core";
import { assertDayOpen, lockStudent } from "./service";

export type ImportResult = { total: number; ok: number; errors: { row: number; message: string }[]; dryRun: boolean };

const parseDate = (s?: string) => {
  if (!s) return undefined;
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  const d = m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s.slice(0, 10) + "T00:00:00.000Z") : new Date(NaN);
  return isNaN(d.getTime()) ? null : d;
};
const MODES: Record<string, PaymentMode> = { cash: "CASH", cheque: "CHEQUE", check: "CHEQUE", upi: "UPI", card: "CARD", netbanking: "NETBANKING", "net banking": "NETBANKING", banktransfer: "BANK_TRANSFER", "bank transfer": "BANK_TRANSFER", neft: "BANK_TRANSFER", rtgs: "BANK_TRANSFER", imps: "BANK_TRANSFER" };

/**
 * Import opening dues (Type = DUE) and past payments (Type = PAYMENT) by admission number into the current year.
 * Dues are created before payments; payments are allocated oldest due first and get new, gap-free receipt numbers
 * (the old receipt number can go in Reference).
 */
export async function importFees(branchId: string, data: ArrayBuffer, dryRun: boolean): Promise<ImportResult> {
  const raw = await readSheet(data);
  const year = await currentAcademicYear();
  const errors: ImportResult["errors"] = [];
  if (!year) return { total: raw.length, ok: 0, errors: [{ row: 1, message: "Set the current academic year first" }], dryRun };
  const heads = await db.feeHead.findMany({ where: { branchId } });
  const rows = raw.map((r, i) => ({ r, rowNo: i + 2, type: (r.type ?? "").trim().toUpperCase() }));
  // Dues first, then payments in date order
  rows.sort((a, b) => (a.type === b.type ? (a.type === "PAYMENT" ? (a.r.paymentdate ?? "").localeCompare(b.r.paymentdate ?? "") : 0) : a.type === "DUE" ? -1 : 1));
  const balance = new Map<string, number>(); // simulated open balance per student
  const students = new Map<string, { id: string }>();
  let ok = 0;
  for (const { r, rowNo, type } of rows) {
    try {
      const adm = (r.admissionno ?? "").trim();
      if (!adm) throw new Error("Admission No is required");
      let st = students.get(adm);
      if (!st) {
        const s = await db.student.findFirst({ where: { admissionNo: adm, branchId }, select: { id: true } });
        if (!s) throw new Error(`No student with admission no ${adm}`);
        st = s;
        students.set(adm, s);
        const agg = await db.studentFee.aggregate({ where: { studentId: s.id, status: { in: ["PENDING", "PARTIAL"] } }, _sum: { balance: true } });
        balance.set(s.id, toNum(agg._sum.balance));
      }
      const amount = round2(Number((r.amount ?? "").replace(/[,₹\s]/g, "")));
      if (!(amount > 0)) throw new Error("Amount must be a number more than zero");
      if (type === "DUE") {
        const head = heads.find((h) => h.name.toLowerCase() === (r.feehead ?? "").trim().toLowerCase());
        if (!head) throw new Error(`Fee head “${r.feehead ?? ""}” does not exist (Fees → Fee structure → Fee heads)`);
        const due = parseDate(r.duedate);
        if (!due) throw new Error("Due Date is required (DD/MM/YYYY)");
        if (!dryRun) {
          await db.$transaction(async (tx) => {
            await lockStudent(tx, st.id);
            await createFeeLine(tx, { studentId: st.id, academicYearId: year.id, feeHeadId: head.id, description: r.description || `${head.name} — opening balance`, amount, dueDate: due, source: "IMPORT" });
          });
        }
        balance.set(st.id, round2((balance.get(st.id) ?? 0) + amount));
      } else if (type === "PAYMENT") {
        const paid = parseDate(r.paymentdate);
        if (!paid) throw new Error("Payment Date is required (DD/MM/YYYY)");
        if (paid > today()) throw new Error("Payment Date cannot be in the future");
        const mode = MODES[(r.mode ?? "cash").trim().toLowerCase()];
        if (!mode) throw new Error(`Unknown mode “${r.mode}” (Cash, Cheque, UPI, Card, Net banking, Bank transfer)`);
        const open = balance.get(st.id) ?? 0;
        if (amount - open > 0.009) throw new Error(`Payment ₹${amount} is more than the student's open dues ₹${open}`);
        await assertDayOpen(db, branchId, paid).catch((e) => { throw new Error(e.message); });
        if (!dryRun) {
          await db.$transaction(async (tx) => {
            await lockStudent(tx, st.id);
            await recordPayment(tx, { branchId, studentId: st.id, amount, mode, purpose: "FEE", reference: r.reference || undefined, source: "IMPORT", paidAt: new Date(paid.getTime() + 6.5 * 3600000), reconciled: true, notes: "Imported past payment" });
          });
        }
        balance.set(st.id, round2(open - amount));
      } else {
        throw new Error("Type must be DUE or PAYMENT");
      }
      ok++;
    } catch (e) {
      errors.push({ row: rowNo, message: e instanceof Error ? e.message : String(e) });
    }
  }
  errors.sort((a, b) => a.row - b.row);
  return { total: rows.length, ok, errors, dryRun };
}

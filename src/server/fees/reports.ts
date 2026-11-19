import "server-only";
import type { PaymentMode, Prisma } from "@prisma/client";
import type { ReportDef, ReportFilters } from "@/lib/reports/types";
import { dateWhere } from "@/lib/reports/parse";
import { db } from "@/lib/db";
import { currentAcademicYear } from "@/lib/settings";
import { fullName, isoDate, round2, toNum } from "@/lib/format";
import { CONCESSION_LABEL, MODE_LABEL } from "./access";
import { defaulters } from "./queries";

const sum = (rows: Record<string, unknown>[], keys: string[]) => Object.fromEntries(keys.map((k) => [k, round2(rows.reduce((s, r) => s + toNum(r[k] as number), 0))]));

async function yearId(f: ReportFilters) {
  if (f.yearId) return f.yearId;
  // A chosen term belongs to its own academic year (it may not be the current one).
  if (f.termId) {
    const term = await db.term.findUnique({ where: { id: f.termId }, select: { academicYearId: true } });
    if (term) return term.academicYearId;
  }
  return (await currentAcademicYear())?.id;
}

function paymentWhere(f: ReportFilters, branchId: string): Prisma.PaymentWhereInput {
  return {
    branchId, purpose: "FEE", status: "SUCCESS",
    ...(dateWhere(f) ? { paidAt: dateWhere(f) } : {}),
    ...(f.mode ? { mode: f.mode as PaymentMode } : {}),
    ...(f.classId ? { student: { classId: f.classId, ...(f.sectionId ? { sectionId: f.sectionId } : {}) } } : {}),
  };
}

const istKey = (d: Date, kind: "day" | "month") => {
  const ist = new Date(d.getTime() + 330 * 60000).toISOString();
  return kind === "day" ? ist.slice(0, 10) : ist.slice(0, 7);
};

export const feeReports: ReportDef[] = [
  {
    key: "fees.collection", title: "Fee collection", module: "Fees", perm: "reports.fees",
    description: "Fee collections grouped by day, month, term or payment mode (successful receipts, with refunds shown separately).",
    filters: ["dateRange", "class", "mode"],
    groupBy: [{ value: "day", label: "Day" }, { value: "month", label: "Month" }, { value: "term", label: "Term" }, { value: "mode", label: "Payment mode" }],
    async run(f, { branchId }) {
      const g = (f.groupBy ?? "day") as "day" | "month" | "term" | "mode";
      const where = paymentWhere(f, branchId);
      if (g === "term") {
        const allocs = await db.paymentAllocation.findMany({ where: { payment: where }, include: { studentFee: { include: { term: true, academicYear: true } } } });
        const map = new Map<string, { label: string; sort: string; collected: number; refunded: number; receipts: Set<string> }>();
        for (const a of allocs) {
          const t = a.studentFee.term;
          const key = `${a.studentFee.academicYearId}:${t?.id ?? "annual"}`;
          const row = map.get(key) ?? { label: `${a.studentFee.academicYear.name} — ${t?.name ?? "Annual / other"}`, sort: `${a.studentFee.academicYear.name}-${t?.sequence ?? 0}`, collected: 0, refunded: 0, receipts: new Set<string>() };
          if (toNum(a.amount) > 0) row.collected = round2(row.collected + toNum(a.amount));
          else row.refunded = round2(row.refunded - toNum(a.amount));
          row.receipts.add(a.paymentId);
          map.set(key, row);
        }
        const rows = [...map.values()].sort((a, b) => a.sort.localeCompare(b.sort)).map((r) => ({ group: r.label, receipts: r.receipts.size, collected: r.collected, refunded: r.refunded, net: round2(r.collected - r.refunded) }));
        return {
          columns: [{ key: "group", label: "Term" }, { key: "receipts", label: "Receipts", format: "number", align: "right" }, { key: "collected", label: "Collected", format: "money", align: "right" }, { key: "refunded", label: "Refunded", format: "money", align: "right" }, { key: "net", label: "Net", format: "money", align: "right" }],
          rows, totals: { group: "Total", ...sum(rows, ["collected", "refunded", "net"]) }, chart: { type: "bar", x: "group", y: ["net"] },
          note: "Term-wise amounts follow how each receipt was allocated to fee lines.",
        };
      }
      const payments = await db.payment.findMany({ where, select: { paidAt: true, mode: true, amount: true, refundedAmount: true }, orderBy: { paidAt: "asc" } });
      const map = new Map<string, { receipts: number; collected: number; refunded: number }>();
      for (const p of payments) {
        const key = g === "mode" ? MODE_LABEL[p.mode] : istKey(p.paidAt, g);
        const row = map.get(key) ?? { receipts: 0, collected: 0, refunded: 0 };
        row.receipts++;
        row.collected = round2(row.collected + toNum(p.amount));
        row.refunded = round2(row.refunded + toNum(p.refundedAmount));
        map.set(key, row);
      }
      const rows = [...map.entries()].map(([group, r]) => ({ group, ...r, net: round2(r.collected - r.refunded) }));
      if (g === "mode") rows.sort((a, b) => b.collected - a.collected);
      return {
        columns: [{ key: "group", label: g === "mode" ? "Mode" : g === "month" ? "Month" : "Date" }, { key: "receipts", label: "Receipts", format: "number", align: "right" }, { key: "collected", label: "Collected", format: "money", align: "right" }, { key: "refunded", label: "Refunded", format: "money", align: "right" }, { key: "net", label: "Net", format: "money", align: "right" }],
        rows, totals: { group: "Total", receipts: rows.reduce((s, r) => s + r.receipts, 0), ...sum(rows, ["collected", "refunded", "net"]) },
        chart: { type: g === "mode" ? "bar" : "line", x: "group", y: ["collected"] },
      };
    },
  },
  {
    key: "fees.pendingDues", title: "Pending dues", module: "Fees", perm: "reports.fees",
    description: "Payable, paid, balance and overdue amounts by class (or by student with a class filter).",
    filters: ["year", "term", "class"],
    async run(f, { branchId }) {
      const y = await yearId(f);
      const where: Prisma.StudentFeeWhereInput = { status: { not: "CANCELLED" }, academicYearId: y, ...(f.termId ? { termId: f.termId } : {}), student: { branchId, status: "ACTIVE", ...(f.classId ? { classId: f.classId } : {}) } };
      const lines = await db.studentFee.findMany({ where, include: { student: { include: { schoolClass: true, section: true } } } });
      const t = new Date(isoDate() + "T00:00:00.000Z");
      const map = new Map<string, { group: string; sort: number; students: Set<string>; payable: number; paid: number; balance: number; overdue: number }>();
      for (const l of lines) {
        const key = f.classId ? l.studentId : l.student.classId;
        const label = f.classId ? `${fullName(l.student)} (${l.student.admissionNo})` : l.student.schoolClass.name;
        const row = map.get(key) ?? { group: label, sort: f.classId ? 0 : l.student.schoolClass.grade, students: new Set<string>(), payable: 0, paid: 0, balance: 0, overdue: 0 };
        row.payable += toNum(l.amount) - toNum(l.concessionAmount) + toNum(l.lateFeeAmount) + toNum(l.adjustmentAmount);
        row.paid += toNum(l.paidAmount);
        const bal = toNum(l.balance);
        if (bal > 0) { row.balance += bal; row.students.add(l.studentId); if (l.dueDate < t) row.overdue += bal; }
        map.set(key, row);
      }
      const rows = [...map.values()].sort((a, b) => a.sort - b.sort || a.group.localeCompare(b.group)).map((r) => ({ group: r.group, students: r.students.size, payable: round2(r.payable), paid: round2(r.paid), balance: round2(r.balance), overdue: round2(r.overdue), collectedPct: r.payable > 0 ? Math.round((r.paid / r.payable) * 1000) / 10 : 0 }));
      return {
        columns: [{ key: "group", label: f.classId ? "Student" : "Class" }, { key: "students", label: f.classId ? "Has dues" : "Students with dues", format: "number", align: "right" }, { key: "payable", label: "Payable", format: "money", align: "right" }, { key: "paid", label: "Paid", format: "money", align: "right" }, { key: "balance", label: "Pending", format: "money", align: "right" }, { key: "overdue", label: "Overdue", format: "money", align: "right" }, { key: "collectedPct", label: "Collected %", format: "number", align: "right" }],
        rows, totals: { group: "Total", students: rows.reduce((s, r) => s + r.students, 0), ...sum(rows, ["payable", "paid", "balance", "overdue"]) },
        chart: f.classId ? undefined : { type: "bar", x: "group", y: ["paid", "balance"] },
      };
    },
  },
  {
    key: "fees.concessions", title: "Concessions given", module: "Fees", perm: "reports.fees",
    description: "Approved concessions and scholarships with the amount applied to fee lines.",
    filters: ["year", "class", "status"],
    statusFilter: { label: "Approved", options: [{ value: "PENDING", label: "Pending approval" }, { value: "REJECTED", label: "Rejected" }] },
    groupBy: [{ value: "student", label: "Student" }, { value: "type", label: "Type" }],
    async run(f, { branchId }) {
      const y = await yearId(f);
      const status = (f.status as "APPROVED" | "PENDING" | "REJECTED" | undefined) ?? "APPROVED";
      const list = await db.concession.findMany({ where: { academicYearId: y, status, student: { branchId, ...(f.classId ? { classId: f.classId } : {}) } }, include: { student: { include: { schoolClass: true } }, feeHead: true }, orderBy: { createdAt: "asc" } });
      const lines = await db.studentFee.findMany({ where: { studentId: { in: list.map((c) => c.studentId) }, academicYearId: y, status: { not: "CANCELLED" } }, include: { feeHead: true } });
      const approverIds = [...new Set(list.map((c) => c.approvedById).filter(Boolean))] as string[];
      const approvers = await db.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } });
      const rows = list.map((c) => {
        const applied = lines.filter((l) => l.studentId === c.studentId && (c.feeHeadId ? l.feeHeadId === c.feeHeadId : l.feeHead.type === "TUITION"))
          .reduce((s, l) => s + Math.min(toNum(l.amount), c.mode === "PERCENT" ? (toNum(l.amount) * toNum(c.value)) / 100 : toNum(c.value)), 0);
        return {
          student: `${fullName(c.student)} (${c.student.admissionNo})`, className: c.student.schoolClass.name, type: CONCESSION_LABEL[c.type], applies: c.feeHead?.name ?? "Tuition fees",
          value: c.mode === "PERCENT" ? `${toNum(c.value)}%` : `₹${toNum(c.value).toLocaleString("en-IN")}`, amount: status === "APPROVED" ? round2(applied) : 0, reason: c.reason,
          approvedBy: approvers.find((a) => a.id === c.approvedById)?.name ?? "", decidedAt: c.decidedAt,
        };
      });
      if (f.groupBy === "type") {
        const m = new Map<string, { count: number; amount: number }>();
        for (const r of rows) { const x = m.get(r.type) ?? { count: 0, amount: 0 }; x.count++; x.amount = round2(x.amount + r.amount); m.set(r.type, x); }
        const g = [...m.entries()].map(([type, x]) => ({ type, count: x.count, amount: x.amount }));
        return { columns: [{ key: "type", label: "Type" }, { key: "count", label: "Students", format: "number", align: "right" }, { key: "amount", label: "Amount", format: "money", align: "right" }], rows: g, totals: { type: "Total", count: g.reduce((s, r) => s + r.count, 0), ...sum(g, ["amount"]) }, chart: { type: "bar", x: "type", y: ["amount"] } };
      }
      return {
        columns: [{ key: "student", label: "Student" }, { key: "className", label: "Class" }, { key: "type", label: "Type" }, { key: "applies", label: "Applies to" }, { key: "value", label: "Value" }, { key: "amount", label: "Amount", format: "money", align: "right" }, { key: "reason", label: "Reason" }, { key: "approvedBy", label: "Approved by" }, { key: "decidedAt", label: "Decided", format: "date" }],
        rows, totals: { student: "Total", ...sum(rows, ["amount"]) },
      };
    },
  },
  {
    key: "fees.defaulters", title: "Defaulters", module: "Fees", perm: "reports.fees",
    description: "Students with dues overdue more than the defaulter period (Settings → Policies), sorted by amount.",
    filters: ["class"],
    async run(f, { branchId }) {
      const d = await defaulters(branchId, { classId: f.classId, sectionId: f.sectionId });
      const rows = d.rows.map((r) => ({
        student: fullName(r.student), admissionNo: r.student.admissionNo, className: r.student.section ? `${r.student.schoolClass.name} - ${r.student.section.name}` : r.student.schoolClass.name,
        parent: r.guardian ? `${r.guardian.name} (${r.guardian.phone})` : "", oldestDue: r.oldestDue, days: r.daysOverdue, overdue: r.overdue, totalDue: r.totalDue,
      }));
      return {
        columns: [{ key: "student", label: "Student" }, { key: "admissionNo", label: "Adm. no" }, { key: "className", label: "Class" }, { key: "parent", label: "Parent" }, { key: "oldestDue", label: "Oldest due", format: "date" }, { key: "days", label: "Days overdue", format: "number", align: "right" }, { key: "overdue", label: "Overdue", format: "money", align: "right" }, { key: "totalDue", label: "Total due", format: "money", align: "right" }],
        rows, totals: { student: `${rows.length} students`, ...sum(rows, ["overdue", "totalDue"]) }, note: `Dues overdue more than ${d.days} days.`,
      };
    },
  },
];

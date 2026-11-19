import "server-only";
import type { PaymentMode, PaymentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { round2, toNum, today } from "@/lib/format";
import { studentWhere } from "@/server/students/service";
import { lineScopeWhere, istDayRange, type FeeScope } from "./access";
import { defaulterCutoff } from "./service";

const OPEN = { status: { in: ["PENDING" as const, "PARTIAL" as const] } };

/** Student accounts list with balance / overdue (scope-aware). */
export async function accountList(branchId: string, scope: FeeScope, f: { q?: string; classId?: string; sectionId?: string; dues?: string; status?: string }, page: { skip: number; take: number }) {
  const lineScope = lineScopeWhere(scope);
  const where: Prisma.StudentWhereInput = {
    ...studentWhere(branchId, { q: f.q, classId: f.classId, sectionId: f.sectionId, status: f.status }),
    ...(f.dues === "due" ? { fees: { some: { ...OPEN, balance: { gt: 0 }, ...lineScope } } } : {}),
    ...(f.dues === "overdue" ? { fees: { some: { ...OPEN, balance: { gt: 0 }, dueDate: { lt: today() }, ...lineScope } } } : {}),
    ...(f.dues === "credit" ? { fees: { some: { balance: { lt: 0 }, ...lineScope } } } : {}),
    ...(scope === "transport" && !f.dues ? { fees: { some: lineScope } } : {}),
  };
  const [total, students] = await Promise.all([
    db.student.count({ where }),
    db.student.findMany({ where, include: { schoolClass: true, section: true }, orderBy: [{ schoolClass: { grade: "asc" } }, { section: { name: "asc" } }, { firstName: "asc" }], skip: page.skip, take: page.take }),
  ]);
  const ids = students.map((s) => s.id);
  const lines = await db.studentFee.findMany({ where: { studentId: { in: ids }, status: { not: "CANCELLED" }, ...lineScope }, select: { studentId: true, amount: true, concessionAmount: true, lateFeeAmount: true, adjustmentAmount: true, paidAmount: true, balance: true, dueDate: true, status: true } });
  const t = today();
  const rows = students.map((s) => {
    const mine = lines.filter((l) => l.studentId === s.id);
    const net = round2(mine.reduce((a, l) => a + toNum(l.amount) - toNum(l.concessionAmount) + toNum(l.lateFeeAmount) + toNum(l.adjustmentAmount), 0));
    const paid = round2(mine.reduce((a, l) => a + toNum(l.paidAmount), 0));
    const balance = round2(mine.reduce((a, l) => a + toNum(l.balance), 0));
    const overdue = round2(mine.filter((l) => (l.status === "PENDING" || l.status === "PARTIAL") && l.dueDate < t).reduce((a, l) => a + Math.max(0, toNum(l.balance)), 0));
    return { student: s, net, paid, balance, overdue };
  });
  return { total, rows };
}

/** Full fee account of one student (scope-aware: transport scope sees only transport lines and the transport part of payments). */
export async function accountDetail(branchId: string, studentId: string, scope: FeeScope) {
  const student = await db.student.findFirst({ where: { id: studentId, branchId }, include: { schoolClass: true, section: true, guardians: { include: { guardian: true } } } });
  if (!student) return null;
  const lineScope = lineScopeWhere(scope);
  const [lines, payments, concessions, adjustments, refunds] = await Promise.all([
    db.studentFee.findMany({ where: { studentId, ...lineScope }, include: { academicYear: true, feeHead: true, term: true }, orderBy: [{ academicYear: { startDate: "desc" } }, { dueDate: "asc" }, { createdAt: "asc" }] }),
    db.payment.findMany({
      where: { studentId, status: { not: "PENDING" }, ...(scope === "transport" ? { purpose: "FEE", allocations: { some: { studentFee: { feeHead: { type: "TRANSPORT" } } } } } : {}) },
      include: { allocations: { include: { studentFee: { include: { feeHead: true } } } } }, orderBy: { paidAt: "desc" },
    }),
    scope === "full" ? db.concession.findMany({ where: { studentId }, include: { academicYear: true, feeHead: true }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    scope === "full" ? db.feeAdjustment.findMany({ where: { studentFee: { studentId } }, include: { studentFee: true }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
    scope === "full" ? db.refund.findMany({ where: { studentId }, include: { payment: true }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
  ]);
  const pendingOnline = scope === "full" ? await db.payment.findMany({ where: { studentId, status: "PENDING" }, orderBy: { createdAt: "desc" } }) : [];
  const visiblePayments = payments.map((p) => {
    const allocs = scope === "transport" ? p.allocations.filter((a) => a.studentFee.feeHead.type === "TRANSPORT") : p.allocations;
    const shown = scope === "transport" ? round2(allocs.filter((a) => toNum(a.amount) > 0).reduce((s, a) => s + toNum(a.amount), 0)) : toNum(p.amount);
    return { ...p, allocations: allocs, shownAmount: shown };
  });
  return { student, lines, payments: visiblePayments, concessions, adjustments, refunds, pendingOnline };
}

/** Defaulters: students whose dues are overdue more than policies.defaulterDays, sorted by overdue amount. */
export async function defaulters(branchId: string, f: { classId?: string; sectionId?: string; q?: string }, page?: { skip: number; take: number }) {
  const { cutoff, days } = await defaulterCutoff(branchId);
  const studentFilter: Prisma.StudentWhereInput = { branchId, status: "ACTIVE", ...(f.classId ? { classId: f.classId } : {}), ...(f.sectionId ? { sectionId: f.sectionId } : {}) };
  if (f.q) Object.assign(studentFilter, { OR: studentWhere(branchId, { q: f.q }).OR });
  const where: Prisma.StudentFeeWhereInput = { ...OPEN, balance: { gt: 0 }, dueDate: { lt: cutoff }, student: studentFilter };
  const all = await db.studentFee.groupBy({ by: ["studentId"], where, _sum: { balance: true }, _min: { dueDate: true }, _count: true, orderBy: { _sum: { balance: "desc" } } });
  const total = all.length;
  const totalAmount = round2(all.reduce((s, g) => s + toNum(g._sum.balance), 0));
  const slice = page ? all.slice(page.skip, page.skip + page.take) : all;
  const ids = slice.map((g) => g.studentId);
  const [students, allDues] = await Promise.all([
    db.student.findMany({ where: { id: { in: ids } }, include: { schoolClass: true, section: true, guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } } } }),
    db.studentFee.groupBy({ by: ["studentId"], where: { studentId: { in: ids }, ...OPEN, balance: { gt: 0 } }, _sum: { balance: true } }),
  ]);
  const t = today();
  const rows = slice.map((g) => {
    const s = students.find((x) => x.id === g.studentId)!;
    const oldest = g._min.dueDate!;
    return {
      student: s, overdue: toNum(g._sum.balance), lines: g._count, oldestDue: oldest, daysOverdue: Math.round((t.getTime() - oldest.getTime()) / 86400000),
      totalDue: toNum(allDues.find((d) => d.studentId === g.studentId)?._sum.balance), guardian: s.guardians[0]?.guardian ?? null,
    };
  });
  return { total, totalAmount, rows, days, cutoff, allIds: all.map((g) => g.studentId) };
}

export type PaymentFilters = { q?: string; mode?: string; status?: string; source?: string; purpose?: string; from?: string; to?: string; reconciled?: string };

export function paymentWhere(branchId: string, f: PaymentFilters): Prisma.PaymentWhereInput {
  const parts = f.q?.split(/\s+/).filter(Boolean) ?? [];
  return {
    branchId,
    ...(f.mode ? { mode: f.mode as PaymentMode } : {}),
    ...(f.status ? { status: f.status as PaymentStatus } : { status: { not: "PENDING" } }),
    ...(f.source ? { source: f.source } : {}),
    ...(f.purpose ? { purpose: f.purpose as "FEE" | "UNIFORM" } : {}),
    ...(f.reconciled === "no" ? { reconciled: false, status: "SUCCESS" } : {}),
    ...(f.from || f.to ? { paidAt: { ...(f.from ? { gte: istDayRange(f.from).gte } : {}), ...(f.to ? { lt: istDayRange(f.to).lt } : {}) } } : {}),
    ...(parts.length ? {
      OR: [
        { receiptNo: { contains: f.q, mode: "insensitive" } },
        { reference: { contains: f.q, mode: "insensitive" } },
        { gatewayPaymentId: { contains: f.q } },
        { student: { admissionNo: { contains: f.q, mode: "insensitive" } } },
        { student: { AND: parts.map((p) => ({ OR: [{ firstName: { contains: p, mode: "insensitive" as const } }, { lastName: { contains: p, mode: "insensitive" as const } }] })) } },
      ],
    } : {}),
  };
}

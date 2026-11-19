import "server-only";
import { db } from "@/lib/db";
import { currentAcademicYear } from "@/lib/settings";
import { fullName, round2, toNum, today } from "@/lib/format";
import { istDayRange, istMonthRange } from "./access";
import { defaulterCutoff } from "./service";

const sumPaid = async (branchId: string, paidAt: { gte: Date; lt?: Date; lte?: Date }) =>
  toNum((await db.payment.aggregate({ where: { branchId, purpose: "FEE", status: "SUCCESS", paidAt }, _sum: { amount: true } }))._sum.amount);

/** Fee tiles for the admin dashboard. Collections are FEE-purpose successful payments (gross of later refunds). */
export async function feesDashboard(branchId: string): Promise<{ collectedToday: number; collectedMonth: number; collectedYear: number; pendingDues: number; overdueDues: number; topDefaulters: { studentId: string; name: string; className: string; amount: number }[]; trend: { month: string; amount: number }[] }> {
  const now = new Date();
  const year = await currentAcademicYear();
  const yearStart = year ? istDayRange(year.startDate).gte : istMonthRange(new Date(now.getFullYear(), 0, 1)).gte;
  const openWhere = { student: { branchId, status: "ACTIVE" as const }, status: { in: ["PENDING" as const, "PARTIAL" as const] }, balance: { gt: 0 } };
  const { cutoff } = await defaulterCutoff(branchId);
  const [collectedToday, collectedMonth, collectedYear, pending, overdue, top] = await Promise.all([
    sumPaid(branchId, istDayRange(today())),
    sumPaid(branchId, istMonthRange(now)),
    sumPaid(branchId, { gte: yearStart }),
    db.studentFee.aggregate({ where: openWhere, _sum: { balance: true } }),
    db.studentFee.aggregate({ where: { ...openWhere, dueDate: { lt: today() } }, _sum: { balance: true } }),
    db.studentFee.groupBy({ by: ["studentId"], where: { ...openWhere, dueDate: { lt: cutoff } }, _sum: { balance: true }, orderBy: { _sum: { balance: "desc" } }, take: 5 }),
  ]);
  const students = await db.student.findMany({ where: { id: { in: top.map((t) => t.studentId) } }, include: { schoolClass: true, section: true } });
  const topDefaulters = top.map((t) => {
    const s = students.find((x) => x.id === t.studentId)!;
    return { studentId: t.studentId, name: fullName(s), className: s.section ? `${s.schoolClass.name} - ${s.section.name}` : s.schoolClass.name, amount: toNum(t._sum.balance) };
  });

  // Last 12 IST months of fee collections
  const start = istMonthRange(new Date(Date.UTC(new Date(now.getTime() + 330 * 60000).getUTCFullYear(), new Date(now.getTime() + 330 * 60000).getUTCMonth() - 11, 15))).gte;
  const paid = await db.payment.findMany({ where: { branchId, purpose: "FEE", status: "SUCCESS", paidAt: { gte: start } }, select: { paidAt: true, amount: true } });
  const byMonth = new Map<string, number>();
  for (const p of paid) {
    const m = new Date(p.paidAt.getTime() + 330 * 60000).toISOString().slice(0, 7); // IST month
    byMonth.set(m, (byMonth.get(m) ?? 0) + Number(p.amount));
  }
  const rows = [...byMonth].map(([m, amount]) => ({ m, amount }));
  const trend: { month: string; amount: number }[] = [];
  const ist = new Date(now.getTime() + 330 * 60000);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    trend.push({ month: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }), amount: round2(rows.find((r) => r.m === key)?.amount ?? 0) });
  }
  return { collectedToday, collectedMonth, collectedYear, pendingDues: toNum(pending._sum.balance), overdueDues: toNum(overdue._sum.balance), topDefaulters, trend };
}

/** Pending fee approvals for the approvals inbox. */
export async function pendingFeeApprovals(branchId: string): Promise<{
  concessions: { id: string; studentId: string; studentName: string; type: string; value: number; mode: string; requestedAt: Date }[];
  refunds: { id: string; studentId: string; studentName: string; amount: number; reason: string; requestedAt: Date }[];
  adjustments: { id: string; studentId: string; studentName: string; amount: number; reason: string; requestedAt: Date }[];
}> {
  const [c, r, a] = await Promise.all([
    db.concession.findMany({ where: { status: "PENDING", student: { branchId } }, include: { student: true }, orderBy: { createdAt: "asc" } }),
    db.refund.findMany({ where: { status: "PENDING", student: { branchId } }, include: { student: true }, orderBy: { createdAt: "asc" } }),
    db.feeAdjustment.findMany({ where: { status: "PENDING", studentFee: { student: { branchId } } }, include: { studentFee: { include: { student: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    concessions: c.map((x) => ({ id: x.id, studentId: x.studentId, studentName: fullName(x.student), type: x.type, value: toNum(x.value), mode: x.mode, requestedAt: x.createdAt })),
    refunds: r.map((x) => ({ id: x.id, studentId: x.studentId, studentName: fullName(x.student), amount: toNum(x.amount), reason: x.reason, requestedAt: x.createdAt })),
    adjustments: a.map((x) => ({ id: x.id, studentId: x.studentFee.studentId, studentName: fullName(x.studentFee.student), amount: toNum(x.amount), reason: x.reason, requestedAt: x.createdAt })),
  };
}

/** Per-child fee summary for the parent home page. */
export async function parentFeeSummary(studentIds: string[]): Promise<{ studentId: string; due: number; overdue: number; nextDueDate: Date | null }[]> {
  if (!studentIds.length) return [];
  const open = await db.studentFee.findMany({ where: { studentId: { in: studentIds }, status: { in: ["PENDING", "PARTIAL"] }, balance: { gt: 0 } }, select: { studentId: true, balance: true, dueDate: true } });
  const t = today();
  return studentIds.map((id) => {
    const mine = open.filter((f) => f.studentId === id);
    const upcoming = mine.filter((f) => f.dueDate >= t).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    return {
      studentId: id,
      due: round2(mine.reduce((s, f) => s + toNum(f.balance), 0)),
      overdue: round2(mine.filter((f) => f.dueDate < t).reduce((s, f) => s + toNum(f.balance), 0)),
      nextDueDate: upcoming[0]?.dueDate ?? null,
    };
  });
}

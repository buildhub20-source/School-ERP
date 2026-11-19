import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { toNum, today, addDays } from "@/lib/format";
import { DEFAULTS } from "@/lib/settings";
import type { SessionUser } from "@/lib/auth/session";
import { createStudent } from "@/server/students/service";
import { generateTermDues, collectPayment, bounceCheque, requestConcession, decideConcession, requestRefund, decideRefund } from "@/server/fees/service";
import { lateFeeFor, feeLateFees } from "@/server/fees/automations";
import { startOnlinePayment, confirmOnlinePayment } from "@/server/fees/payments";
import { testCtx, asUser, uniq } from "./helpers";

/**
 * Fee module tests. Everything runs in a throw-away branch (own receipt counter, own policies) so the
 * dev database's receipt sequence stays gap-free; the branch and all its data are removed afterwards.
 */
let ctx: Awaited<ReturnType<typeof testCtx>>;
let branchId = "";
let classId = "";
let tuitionId = "";
let examId = "";
let user: SessionUser;
const studentIds: string[] = [];
const phones: string[] = [];

const phone = () => {
  const p = `7${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  phones.push(p);
  return p;
};

async function newStudent(name = "Test") {
  const s = await asUser(ctx.adminId, () => createStudent(branchId, { firstName: name, lastName: uniq("S"), gender: "MALE", classId, admissionDate: new Date("2026-05-01T00:00:00Z"), guardians: [{ relation: "Father", name: "Parent " + name, phone: phone() }] }));
  studentIds.push(s.id);
  return s;
}
const lines = (studentId: string) => db.studentFee.findMany({ where: { studentId, status: { not: "CANCELLED" } }, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] });

beforeAll(async () => {
  ctx = await testCtx();
  const code = uniq("TB");
  const b = await db.branch.create({ data: { code, name: `Test branch ${code}` } });
  branchId = b.id;
  const c = await db.schoolClass.create({ data: { branchId, name: "Class 4", grade: 4 } });
  classId = c.id;
  tuitionId = (await db.feeHead.create({ data: { branchId, name: "Tuition Fee", type: "TUITION" } })).id;
  examId = (await db.feeHead.create({ data: { branchId, name: "Exam Fee", type: "OTHER", lateFeeApplies: true } })).id;
  const t1 = ctx.year.terms[0];
  await db.feeStructure.createMany({ data: [
    { academicYearId: ctx.year.id, classId, termId: t1.id, feeHeadId: tuitionId, amount: 10000, dueDate: new Date("2026-06-15T00:00:00Z") },
    { academicYearId: ctx.year.id, classId, termId: null, feeHeadId: examId, amount: 1500.5, dueDate: new Date("2026-06-15T00:00:00Z") },
  ] });
  const admin = await db.user.findUniqueOrThrow({ where: { id: ctx.adminId }, include: { role: true } });
  user = { id: admin.id, name: admin.name, email: admin.email, phone: admin.phone, roleKey: admin.role.key, roleName: admin.role.name, permissions: admin.role.permissions, branchId, homeBranchId: branchId, language: "en", mustChangePassword: false, twoFactorEnabled: false, sessionId: "test", idleMinutes: 30 };
});

afterAll(async () => {
  if (!branchId) return;
  await db.refund.deleteMany({ where: { student: { branchId } } });
  await db.payment.deleteMany({ where: { branchId } });
  await db.dayClosing.deleteMany({ where: { branchId } });
  const guardians = await db.guardian.findMany({ where: { phone: { in: phones } } });
  await db.student.deleteMany({ where: { branchId } });
  await db.guardian.deleteMany({ where: { id: { in: guardians.map((g) => g.id) } } });
  await db.user.deleteMany({ where: { branchId } });
  await db.feeStructure.deleteMany({ where: { classId } });
  await db.studentFee.deleteMany({ where: { feeHead: { branchId } } });
  await db.feeHead.deleteMany({ where: { branchId } });
  await db.schoolClass.deleteMany({ where: { branchId } });
  await db.setting.deleteMany({ where: { branchId } });
  const b = await db.branch.findUnique({ where: { id: branchId } });
  if (b) await db.counter.deleteMany({ where: { key: { contains: `-${b.code}-` } } });
  await db.branch.delete({ where: { id: branchId } });
});

describe("dues generation", () => {
  it("creates term + annual lines once and is idempotent", async () => {
    const s = await newStudent("Dues");
    const before = (await lines(s.id)).length; // createStudent may already generate for terms marked generated
    const r1 = await asUser(ctx.adminId, () => generateTermDues(branchId, { academicYearId: ctx.year.id, termId: ctx.year.terms[0].id }));
    const r2 = await asUser(ctx.adminId, () => generateTermDues(branchId, { academicYearId: ctx.year.id, termId: ctx.year.terms[0].id }));
    const after = await lines(s.id);
    expect(after).toHaveLength(2);
    expect(r1.created + before).toBeGreaterThanOrEqual(1);
    expect(r2.created).toBe(0);
    expect(after.reduce((a, l) => a + toNum(l.amount), 0)).toBeCloseTo(11500.5, 2);
  });
});

describe("concessions", () => {
  it("applies an approved percent concession to tuition lines only", async () => {
    const s = await newStudent("Conc");
    await asUser(ctx.adminId, () => generateTermDues(branchId, { academicYearId: ctx.year.id, termId: ctx.year.terms[0].id }));
    await asUser(ctx.adminId, () => requestConcession(user, branchId, { studentId: s.id, type: "SIBLING", mode: "PERCENT", value: 10, reason: "Sibling" }));
    const c = await db.concession.findFirstOrThrow({ where: { studentId: s.id } });
    let ls = await lines(s.id);
    expect(ls.every((l) => toNum(l.concessionAmount) === 0)).toBe(true);
    await asUser(ctx.adminId, () => decideConcession(user, branchId, { id: c.id, approve: true, note: "ok" }));
    ls = await lines(s.id);
    const tuition = ls.find((l) => l.feeHeadId === tuitionId)!;
    const exam = ls.find((l) => l.feeHeadId === examId)!;
    expect(toNum(tuition.concessionAmount)).toBe(1000);
    expect(toNum(tuition.balance)).toBe(9000);
    expect(toNum(exam.concessionAmount)).toBe(0);
    await expect(asUser(ctx.adminId, () => decideConcession(user, branchId, { id: c.id, approve: true }))).rejects.toThrow(/already/);
  });
});

describe("late fee rules", () => {
  const due = new Date("2026-06-15T00:00:00Z");
  const line = { amount: 10000, concessionAmount: 0, dueDate: due };
  const on = new Date("2026-06-25T00:00:00Z"); // 10 days late
  it("disabled → nothing", () => {
    expect(lateFeeFor({ ...DEFAULTS.policies.lateFee, enabled: false }, line, on)).toBe(0);
  });
  it("fixed, per-day with grace and cap, percent", () => {
    expect(lateFeeFor({ enabled: true, type: "FIXED", amount: 100, graceDays: 0, maxAmount: 0 }, line, on)).toBe(100);
    expect(lateFeeFor({ enabled: true, type: "PER_DAY", amount: 20, graceDays: 3, maxAmount: 0 }, line, on)).toBe(140);
    expect(lateFeeFor({ enabled: true, type: "PER_DAY", amount: 20, graceDays: 3, maxAmount: 100 }, line, on)).toBe(100);
    expect(lateFeeFor({ enabled: true, type: "PERCENT", amount: 2, graceDays: 0, maxAmount: 0 }, { ...line, concessionAmount: 1000 }, on)).toBe(180);
    expect(lateFeeFor({ enabled: true, type: "FIXED", amount: 100, graceDays: 15, maxAmount: 0 }, line, on)).toBe(0);
  });
  it("job applies per branch policy, is idempotent, and does nothing when disabled", async () => {
    const s = await newStudent("Late");
    await asUser(ctx.adminId, () => generateTermDues(branchId, { academicYearId: ctx.year.id, termId: ctx.year.terms[0].id }));
    await db.setting.create({ data: { branchId, key: "policies", value: { lateFee: { enabled: false, type: "FIXED", amount: 250, graceDays: 0, maxAmount: 0 } } } });
    await feeLateFees({});
    expect((await lines(s.id)).every((l) => toNum(l.lateFeeAmount) === 0)).toBe(true);
    await db.setting.updateMany({ where: { branchId, key: "policies" }, data: { value: { lateFee: { enabled: true, type: "FIXED", amount: 250, graceDays: 0, maxAmount: 0 } } } });
    await feeLateFees({});
    await feeLateFees({});
    const ls = await lines(s.id);
    for (const l of ls) expect(toNum(l.lateFeeAmount)).toBe(250);
    expect(toNum(ls.find((l) => l.feeHeadId === tuitionId)!.balance)).toBe(10250);
    await db.setting.deleteMany({ where: { branchId, key: "policies" } });
    await db.studentFee.updateMany({ where: { studentId: s.id }, data: { lateFeeAmount: 0 } });
  });
});

describe("counter payments", () => {
  it("allocates to selected lines and issues consecutive receipt numbers", async () => {
    const s = await newStudent("Pay");
    await asUser(ctx.adminId, () => generateTermDues(branchId, { academicYearId: ctx.year.id, termId: ctx.year.terms[0].id }));
    const [tuition, exam] = (await lines(s.id)).sort((a) => (a.feeHeadId === tuitionId ? -1 : 1));
    const p1 = await asUser(ctx.adminId, () => collectPayment(user, branchId, { studentId: s.id, mode: "CASH", amount: 4000.25, allocations: [{ studentFeeId: tuition.id, amount: 4000.25 }] }));
    const p2 = await asUser(ctx.adminId, () => collectPayment(user, branchId, { studentId: s.id, mode: "UPI", amount: 1500.5, reference: "UTR1", allocations: [{ studentFeeId: exam.id, amount: 1500.5 }] }));
    const n1 = Number(p1.receiptNo!.split("/").pop());
    expect(Number(p2.receiptNo!.split("/").pop())).toBe(n1 + 1);
    const t = await db.studentFee.findUniqueOrThrow({ where: { id: tuition.id } });
    expect(toNum(t.paidAmount)).toBe(4000.25);
    expect(toNum(t.balance)).toBe(5999.75);
    expect(t.status).toBe("PARTIAL");
    expect((await db.studentFee.findUniqueOrThrow({ where: { id: exam.id } })).status).toBe("PAID");
    await expect(asUser(ctx.adminId, () => collectPayment(user, branchId, { studentId: s.id, mode: "CASH", amount: 99999 }))).rejects.toThrow(/more than/);
    await expect(asUser(ctx.adminId, () => collectPayment(user, branchId, { studentId: s.id, mode: "UPI", amount: 10 }))).rejects.toThrow(/reference/);
  });

  it("bounced cheque reverses the allocation and keeps the receipt", async () => {
    const s = await newStudent("Chq");
    await asUser(ctx.adminId, () => generateTermDues(branchId, { academicYearId: ctx.year.id, termId: ctx.year.terms[0].id }));
    const p = await asUser(ctx.adminId, () => collectPayment(user, branchId, { studentId: s.id, mode: "CHEQUE", amount: 11500.5, reference: "123456", chequeBank: "SBI", chequeDate: today() }));
    expect((await lines(s.id)).every((l) => l.status === "PAID")).toBe(true);
    await asUser(ctx.adminId, () => bounceCheque(branchId, p.id, "Insufficient funds"));
    const after = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.status).toBe("BOUNCED");
    expect(after.receiptNo).toBe(p.receiptNo);
    const ls = await lines(s.id);
    expect(ls.every((l) => toNum(l.paidAmount) === 0 && l.status === "PENDING")).toBe(true);
  });
});

describe("refunds", () => {
  it("approval de-allocates from the payment's lines, records approver and refunded amount; waiver keeps balance", async () => {
    const s = await newStudent("Ref");
    await asUser(ctx.adminId, () => generateTermDues(branchId, { academicYearId: ctx.year.id, termId: ctx.year.terms[0].id }));
    const p = await asUser(ctx.adminId, () => collectPayment(user, branchId, { studentId: s.id, mode: "CASH", amount: 11500.5 }));
    await expect(asUser(ctx.adminId, () => requestRefund(user, branchId, { paymentId: p.id, amount: 20000, reason: "x", waiveFee: false, mode: "CASH" }))).rejects.toThrow(/At most/);
    await asUser(ctx.adminId, () => requestRefund(user, branchId, { paymentId: p.id, amount: 500, reason: "Exam fee waived", waiveFee: true, mode: "BANK_TRANSFER" }));
    await asUser(ctx.adminId, () => requestRefund(user, branchId, { paymentId: p.id, amount: 300, reason: "Overcharged", waiveFee: false, mode: "CASH" }));
    const [r1, r2] = await db.refund.findMany({ where: { paymentId: p.id }, orderBy: { createdAt: "asc" } });
    await asUser(ctx.adminId, () => decideRefund(user, branchId, { id: r1.id, approve: true, payoutRef: "NEFT9" }));
    await asUser(ctx.adminId, () => decideRefund(user, branchId, { id: r2.id, approve: true }));
    const pay = await db.payment.findUniqueOrThrow({ where: { id: p.id }, include: { allocations: true } });
    expect(toNum(pay.refundedAmount)).toBe(800);
    expect(pay.allocations.filter((a) => toNum(a.amount) < 0).reduce((x, a) => x + toNum(a.amount), 0)).toBe(-800);
    const ls = await lines(s.id);
    expect(ls.reduce((x, l) => x + toNum(l.paidAmount), 0)).toBeCloseTo(10700.5, 2);
    expect(ls.reduce((x, l) => x + toNum(l.balance), 0)).toBeCloseTo(300, 2); // 500 waived, 300 due again
    const done = await db.refund.findUniqueOrThrow({ where: { id: r1.id } });
    expect(done.status).toBe("APPROVED");
    expect(done.approvedById).toBe(ctx.adminId);
    expect(done.decisionNote).toMatch(/NEFT9/);
    await expect(asUser(ctx.adminId, () => decideRefund(user, branchId, { id: r1.id, approve: true }))).rejects.toThrow(/already/);
  });
});

describe("online payments", () => {
  it("sandbox confirm is idempotent and applies allocations once", async () => {
    const s = await newStudent("Online");
    await asUser(ctx.adminId, () => generateTermDues(branchId, { academicYearId: ctx.year.id, termId: ctx.year.terms[0].id }));
    const tuition = (await lines(s.id)).find((l) => l.feeHeadId === tuitionId)!;
    const start = await startOnlinePayment({ branchId, studentId: s.id, purpose: "FEE", amount: 10000, allocations: [{ studentFeeId: tuition.id, amount: 10000 }], returnTo: "/parent/fees", initiatedById: ctx.adminId });
    expect(start.checkoutUrl).toMatch(/^\/pay\/sandbox\//);
    const pending = await db.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
    expect(pending.status).toBe("PENDING");
    expect(pending.receiptNo).toBeNull();
    const a = await confirmOnlinePayment(start.paymentId, { gatewayPaymentId: "sandbox_t1", mode: "CARD", captured: false });
    const b = await confirmOnlinePayment(start.paymentId, { gatewayPaymentId: "sandbox_t1", mode: "CARD", captured: false });
    expect(a.confirmed).toBe(true);
    expect(b.confirmed).toBe(false);
    const done = await db.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
    expect(done.status).toBe("SUCCESS");
    expect(done.mode).toBe("CARD");
    expect(done.reconciled).toBe(true);
    expect(done.receiptNo).toBeTruthy();
    const t = await db.studentFee.findUniqueOrThrow({ where: { id: tuition.id } });
    expect(toNum(t.paidAmount)).toBe(10000);
    expect(t.status).toBe("PAID");
    // A second checkout for the already-paid line cannot even start
    await expect(startOnlinePayment({ branchId, studentId: s.id, purpose: "FEE", amount: 10000, allocations: [{ studentFeeId: tuition.id, amount: 10000 }], returnTo: "/parent/fees", initiatedById: ctx.adminId })).rejects.toThrow();
    expect(addDays(today(), 0)).toBeInstanceOf(Date);
  });
});

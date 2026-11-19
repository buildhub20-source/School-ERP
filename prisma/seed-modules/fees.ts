import type { PaymentMode } from "@prisma/client";
import type { SeedCtx } from "../seed";
import { db } from "@/lib/db";
import { round2, toNum, today, isoDate } from "@/lib/format";
import { generateDues, reapplyConcessions, recordPayment } from "@/server/fees/core";
import { concessionSuggestions, dayBook } from "@/server/fees/service";
import { feeLateFees } from "@/server/fees/automations";

const d = (s: string) => new Date(s + "T00:00:00.000Z");
/** A timestamp at hh:mm IST on a date. */
const at = (date: string, h: number, m: number) => new Date(d(date).getTime() + (h * 60 + m - 330) * 60000);

/** Demo data for the fees module (idempotent; runs first among module seeds). */
export async function seed_fees(ctx: SeedCtx) {
  const year = await db.academicYear.findUniqueOrThrow({ where: { id: ctx.yearId }, include: { terms: { orderBy: { sequence: "asc" } } } });
  const heads = Object.fromEntries((await db.feeHead.findMany({ where: { branchId: ctx.branchId } })).map((h) => [h.name, h]));
  const classes = await db.schoolClass.findMany({ where: { branchId: ctx.branchId }, orderBy: { grade: "asc" } });
  const [t1, t2, t3] = year.terms;
  const termDue = [d("2026-06-15"), d("2026-10-15"), d("2027-01-15")];

  // 1. Fee structure for every class
  let structures = 0;
  for (const c of classes) {
    const tuition = 5500 + Math.max(0, c.grade) * 500 + (c.grade >= 9 ? 1000 : 0);
    const lines: { termId: string | null; head: string; amount: number; due: Date; instalments?: number }[] = [
      ...[t1, t2, t3].map((t, i) => ({ termId: t.id, head: "Tuition Fee", amount: tuition, due: termDue[i], instalments: c.name === "Class 10" && i === 0 ? 2 : 1 })),
      { termId: null, head: "Exam Fee", amount: c.grade >= 9 ? 2000 : 1200, due: d("2026-06-15") },
      { termId: null, head: "Library Fee", amount: 800, due: d("2026-06-15") },
      { termId: null, head: "Sports & Activities", amount: 1500, due: d("2026-06-15") },
      ...(c.grade >= 6 ? [{ termId: null, head: "Lab Fee", amount: c.grade >= 11 ? 3000 : 2000, due: d("2026-06-15") }] : []),
    ];
    for (const l of lines) {
      const exists = await db.feeStructure.findFirst({ where: { academicYearId: year.id, classId: c.id, termId: l.termId, feeHeadId: heads[l.head].id } });
      if (exists) continue;
      await db.feeStructure.create({ data: { academicYearId: year.id, classId: c.id, termId: l.termId, feeHeadId: heads[l.head].id, amount: l.amount, dueDate: l.due, instalments: l.instalments ?? 1 } });
      structures++;
    }
  }

  // 2. Concessions (before dues so they apply on creation): approved sibling + staff child, one pending merit
  const hasConcessions = (await db.concession.count({ where: { academicYearId: year.id, student: { branchId: ctx.branchId } } })) > 0;
  if (!hasConcessions) {
    const sugg = await concessionSuggestions(ctx.branchId);
    const sib = sugg.filter((s) => s.type === "SIBLING").slice(0, 2);
    const staff = sugg.find((s) => s.type === "STAFF_CHILD");
    const decided = { status: "APPROVED" as const, requestedById: ctx.users.accountant, approvedById: ctx.users.admin, decidedAt: at("2026-06-05", 11, 0), decisionNote: "As per school policy" };
    for (const s of sib) await db.concession.create({ data: { studentId: s.studentId, academicYearId: year.id, type: "SIBLING", mode: "PERCENT", value: s.percent, reason: s.reason, ...decided } });
    if (staff) await db.concession.create({ data: { studentId: staff.studentId, academicYearId: year.id, type: "STAFF_CHILD", mode: "PERCENT", value: staff.percent, reason: staff.reason, ...decided } });
    const topper = await db.student.findFirst({ where: { branchId: ctx.branchId, status: "ACTIVE", schoolClass: { name: "Class 10" } }, orderBy: { admissionNo: "asc" } });
    if (topper) await db.concession.create({ data: { studentId: topper.id, academicYearId: year.id, type: "MERIT", mode: "FIXED", value: 2000, reason: "Scored 98% in Class 9 annual exams — merit scholarship", requestedById: ctx.users.accountant } });
    for (const c of await db.concession.findMany({ where: { academicYearId: year.id, status: "APPROVED" } })) await reapplyConcessions(db, c.studentId, year.id);
  }

  // 3. Dues for Term 1 (with annual) and Term 2
  let created = 0;
  for (const t of [t1, t2]) {
    created += await generateDues({ academicYearId: year.id, termId: t.id, includeAnnual: t.sequence === 1, branchId: ctx.branchId });
    if (!t.duesGeneratedAt) await db.term.update({ where: { id: t.id }, data: { duesGeneratedAt: t.sequence === 1 ? at("2026-06-01", 6, 0) : at("2026-10-01", 6, 0) } });
  }

  // 4. Payments (only once)
  const seeded = await db.payment.count({ where: { branchId: ctx.branchId, notes: { startsWith: "[seed]" } } });
  let payments = 0;
  if (!seeded) {
    const students = await db.student.findMany({ where: { branchId: ctx.branchId, status: "ACTIVE" }, orderBy: { admissionNo: "asc" }, select: { id: true } });
    const modes: PaymentMode[] = ["CASH", "CASH", "UPI", "CASH", "CHEQUE", "UPI", "CARD", "NETBANKING", "BANK_TRANSFER", "CASH"];
    const t1Days = ["2026-06-03", "2026-06-08", "2026-06-10", "2026-06-12", "2026-06-15", "2026-06-22", "2026-07-02", "2026-07-14", "2026-08-05", "2026-09-10"];
    const t2Days = ["2026-10-05", "2026-10-09", "2026-10-13", "2026-10-15", "2026-10-30", "2026-10-30", "2026-11-02"];
    type Plan = { studentId: string; when: Date; mode: PaymentMode; onlyDueBy: Date; fraction: number; online: boolean };
    const plans: Plan[] = [];
    students.forEach((s, i) => {
      const r = (i * 37 + 11) % 100;
      const mode = modes[(i * 7) % modes.length];
      if (r < 65) {
        plans.push({ studentId: s.id, when: at(t1Days[i % t1Days.length], 9 + (i % 6), (i * 7) % 60), mode, onlyDueBy: d("2026-09-30"), fraction: 1, online: mode !== "CASH" && mode !== "CHEQUE" && i % 3 === 0 });
        if ((i * 13) % 100 < 55) {
          const isToday = i % 9 === 0;
          const day = isToday ? isoDate(today()) : t2Days[i % t2Days.length];
          plans.push({ studentId: s.id, when: at(day, isToday ? 9 : 10 + (i % 5), (i * 11) % 60), mode: modes[(i * 3) % modes.length], onlyDueBy: d("2026-12-31"), fraction: 1, online: i % 4 === 0 });
        }
      } else if (r < 80) {
        plans.push({ studentId: s.id, when: at(t1Days[(i + 3) % t1Days.length], 11, (i * 5) % 60), mode: "CASH", onlyDueBy: d("2026-09-30"), fraction: 0.5, online: false });
      }
    });
    // Make sure "today" has a few counter receipts
    plans.filter((p) => isoDate(p.when) === isoDate(today())).forEach((p, k) => { if (k < 2) { p.mode = "CASH"; p.online = false; } });
    plans.sort((a, b) => a.when.getTime() - b.when.getTime());
    const banks = ["State Bank of India", "Indian Bank", "HDFC Bank", "ICICI Bank", "Canara Bank"];
    for (const [k, p] of plans.entries()) {
      await db.$transaction(async (tx) => {
        const open = await tx.studentFee.findMany({ where: { studentId: p.studentId, status: { in: ["PENDING", "PARTIAL"] }, balance: { gt: 0 }, dueDate: { lte: p.onlyDueBy } }, orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] });
        const due = round2(open.reduce((s, f) => s + toNum(f.balance), 0));
        if (due <= 0) return;
        const amount = p.fraction === 1 ? due : Math.max(500, Math.round((due * p.fraction) / 100) * 100);
        const online = p.online && ["UPI", "CARD", "NETBANKING"].includes(p.mode);
        await recordPayment(tx, {
          branchId: ctx.branchId, studentId: p.studentId, amount: Math.min(amount, due), mode: p.mode, purpose: "FEE", paidAt: p.when,
          source: online ? "ONLINE" : "COUNTER", gateway: online ? "sandbox" : undefined, gatewayPaymentId: online ? `sandbox_seed${k}` : undefined,
          reference: p.mode === "CHEQUE" ? String(100000 + k * 37) : p.mode === "CASH" ? undefined : `UTR${(4567000 + k * 131).toString()}`,
          chequeBank: p.mode === "CHEQUE" ? banks[k % banks.length] : undefined, chequeDate: p.mode === "CHEQUE" ? d(isoDate(p.when)) : undefined,
          collectedById: online ? undefined : ctx.users.accountant, notes: "[seed] demo payment", reconciled: p.mode === "CASH" || online || p.when < d("2026-10-25"),
        });
        payments++;
      }, { timeout: 20000 });
    }

    // One bounced cheque (fee due again)
    const cheque = await db.payment.findFirst({ where: { branchId: ctx.branchId, mode: "CHEQUE", status: "SUCCESS", paidAt: { gte: d("2026-09-01") }, notes: { startsWith: "[seed]" } }, include: { allocations: true } });
    if (cheque) {
      const { reversePayment } = await import("@/server/fees/core");
      await db.$transaction((tx) => reversePayment(tx, cheque.id, "BOUNCED", "Cheque bounced: insufficient funds"));
    }

    // One pending refund (excess / duplicate payment claim)
    const forRefund = await db.payment.findFirst({ where: { branchId: ctx.branchId, status: "SUCCESS", mode: "BANK_TRANSFER", notes: { startsWith: "[seed]" } }, orderBy: { paidAt: "asc" } });
    if (forRefund) await db.refund.create({ data: { paymentId: forRefund.id, studentId: forRefund.studentId, amount: 800, reason: "Library fee charged twice — parent also paid it with the admission kit", mode: "BANK_TRANSFER", requestedById: ctx.users.accountant } });

    // A closed cash-book day
    const closeDate = d("2026-10-30");
    if (!(await db.dayClosing.findUnique({ where: { branchId_date: { branchId: ctx.branchId, date: closeDate } } }))) {
      const book = await dayBook(ctx.branchId, closeDate);
      const c = await db.dayClosing.create({
        data: { branchId: ctx.branchId, date: closeDate, totals: { ...book.totals, total: book.total, refundsCash: 0, count: book.count }, cashCounted: book.cash, bankCredited: book.nonCash, cashDeposited: book.cash, difference: 0, notes: "Cash deposited at SBI Anna Nagar", closedById: ctx.users.accountant },
      });
      await db.payment.updateMany({ where: { id: { in: book.payments.filter((p) => p.status === "SUCCESS").map((p) => p.id) } }, data: { dayClosingId: c.id } });
    }

    // Late fees on overdue lines (per Policies)
    await feeLateFees({});
  }
  console.log(`  fees: ${structures} structure lines, ${created} dues created, ${payments} payments`);
}

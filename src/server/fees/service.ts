import "server-only";
import type { ConcessionType, FeeHeadType, PaymentMode } from "@prisma/client";
import { db, type DbOrTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { round2, toNum, today, isoDate, fullName, money, addDays } from "@/lib/format";
import { currentAcademicYear, getSetting } from "@/lib/settings";
import { notifyGuardians, notifyPermission, notifyUsers } from "@/lib/messaging/notify";
import type { SessionUser } from "@/lib/auth/session";
import { createFeeLine, feeNet, generateDues, reapplyConcessions, recalcFee, recordPayment, reversePayment } from "./core";
import { istDayRange, MODE_LABEL } from "./access";
import { sendReceipt, type ReceiptChannel } from "./receipts";

/* ───────────────────────── helpers ───────────────────────── */

/** Serialise fee operations for one student (row lock inside a transaction). */
export async function lockStudent(tx: DbOrTx, studentId: string) {
  await tx.$queryRaw`SELECT id FROM "Student" WHERE id = ${studentId} FOR UPDATE`;
}

/** Closed cash-book days are locked: no payment can be added to or removed from them. */
export async function assertDayOpen(client: DbOrTx, branchId: string, day: Date) {
  const date = new Date(isoDate(day) + "T00:00:00.000Z");
  const closed = await client.dayClosing.findUnique({ where: { branchId_date: { branchId, date } } });
  if (closed) throw new AppError(`The cash book for ${isoDate(day)} is closed. Payments on a closed day cannot be added or changed.`);
}

async function studentInBranch(client: DbOrTx, branchId: string, studentId: string) {
  const s = await client.student.findFirst({ where: { id: studentId, branchId }, include: { schoolClass: true } });
  if (!s) throw new AppError("Student not found.");
  return s;
}

async function requireYear() {
  const y = await currentAcademicYear();
  if (!y) throw new AppError("Set the current academic year first (Settings → Academic years).");
  return y;
}

/* ───────────────────────── fee heads & structure ───────────────────────── */

export async function saveFeeHead(branchId: string, input: { id?: string; name: string; type: FeeHeadType; lateFeeApplies: boolean; isActive: boolean }) {
  if (input.id) {
    const h = await db.feeHead.findFirst({ where: { id: input.id, branchId } });
    if (!h) throw new AppError("Fee head not found.");
    return db.feeHead.update({ where: { id: h.id }, data: { name: input.name, type: input.type, lateFeeApplies: input.lateFeeApplies, isActive: input.isActive } });
  }
  return db.feeHead.create({ data: { branchId, name: input.name, type: input.type, lateFeeApplies: input.lateFeeApplies, isActive: input.isActive } });
}

/** A fee head can be deleted only while nothing uses it; otherwise mark it inactive. */
export async function deleteFeeHead(branchId: string, id: string) {
  const h = await db.feeHead.findFirst({ where: { id, branchId } });
  if (!h) throw new AppError("Fee head not found.");
  const [structures, lines, concessions] = await Promise.all([
    db.feeStructure.count({ where: { feeHeadId: h.id } }), db.studentFee.count({ where: { feeHeadId: h.id } }),
    db.concession.count({ where: { feeHeadId: h.id } }),
  ]);
  if (structures + lines + concessions > 0) {
    throw new AppError(`${h.name} is already used (${lines} student fee lines, ${structures} fee structure lines, ${concessions} concessions). Edit it and untick Active instead.`);
  }
  await db.feeHead.delete({ where: { id: h.id } });
}

export type StructureInput ={ id?: string; academicYearId: string; classId: string; termId: string | null; feeHeadId: string; amount: number; dueDate: Date; instalments: number };

export async function saveStructure(branchId: string, input: StructureInput) {
  if (input.amount <= 0) throw new AppError("Amount must be more than zero.");
  if (input.instalments < 1 || input.instalments > 12) throw new AppError("Instalments must be between 1 and 12.");
  const [cls, head, year] = await Promise.all([
    db.schoolClass.findFirst({ where: { id: input.classId, branchId } }),
    db.feeHead.findFirst({ where: { id: input.feeHeadId, branchId } }),
    db.academicYear.findUnique({ where: { id: input.academicYearId }, include: { terms: true } }),
  ]);
  if (!cls) throw new AppError("Choose a valid class.");
  if (!head) throw new AppError("Choose a valid fee head.");
  if (!year) throw new AppError("Choose a valid academic year.");
  if (year.closedAt) throw new AppError("This academic year is closed.");
  if (input.termId && !year.terms.some((t) => t.id === input.termId)) throw new AppError("The term does not belong to that academic year.");
  if (head.type === "TRANSPORT") throw new AppError("Transport fees are added from the student's bus stop (Transport → Allocation), not the class structure.");
  if (input.id) {
    const s = await db.feeStructure.findFirst({ where: { id: input.id, schoolClass: { branchId } } });
    if (!s) throw new AppError("Fee structure not found.");
    const used = await db.studentFee.count({ where: { structureId: s.id } });
    if (used > 0 && (toNum(s.amount) !== input.amount || s.instalments !== input.instalments || s.classId !== input.classId || s.feeHeadId !== input.feeHeadId || s.termId !== input.termId)) {
      throw new AppError(`Dues from this line were already generated for ${used} fee line(s). Only the due date can be changed now; adjust individual accounts for other changes.`);
    }
    return db.$transaction(async (tx) => {
      const updated = await tx.feeStructure.update({ where: { id: s.id }, data: { classId: input.classId, termId: input.termId, feeHeadId: input.feeHeadId, amount: input.amount, dueDate: input.dueDate, instalments: input.instalments } });
      // Due date change flows to generated single-instalment lines that are still untouched
      if (used > 0 && s.dueDate.getTime() !== input.dueDate.getTime() && s.instalments === 1) {
        await tx.studentFee.updateMany({ where: { structureId: s.id, status: "PENDING", paidAmount: 0, splitFromId: null, instalmentNo: null }, data: { dueDate: input.dueDate } });
      }
      return updated;
    });
  }
  const dup = await db.feeStructure.findFirst({ where: { academicYearId: input.academicYearId, classId: input.classId, termId: input.termId, feeHeadId: input.feeHeadId } });
  if (dup) throw new AppError(`${head.name} is already set for ${cls.name} in this ${input.termId ? "term" : "year (annual)"}. Edit that line instead.`);
  return db.feeStructure.create({ data: { academicYearId: input.academicYearId, classId: input.classId, termId: input.termId, feeHeadId: input.feeHeadId, amount: input.amount, dueDate: input.dueDate, instalments: input.instalments } });
}

export async function deleteStructure(branchId: string, id: string) {
  const s = await db.feeStructure.findFirst({ where: { id, schoolClass: { branchId } } });
  if (!s) throw new AppError("Fee structure not found.");
  const used = await db.studentFee.count({ where: { structureId: s.id } });
  if (used) throw new AppError(`Dues were already generated from this line (${used} fee lines). It cannot be removed.`);
  await db.feeStructure.delete({ where: { id: s.id } });
}

/** Copy one class's structure (for a year) to other classes. Lines that already exist in a target class are skipped. */
export async function copyStructure(branchId: string, input: { academicYearId: string; fromClassId: string; toClassIds: string[] }) {
  const source = await db.feeStructure.findMany({ where: { academicYearId: input.academicYearId, classId: input.fromClassId, schoolClass: { branchId } } });
  if (!source.length) throw new AppError("The source class has no fee structure for this year.");
  const targets = await db.schoolClass.findMany({ where: { branchId, id: { in: input.toClassIds.filter((c) => c !== input.fromClassId) } } });
  if (!targets.length) throw new AppError("Choose at least one other class.");
  let created = 0;
  let skipped = 0;
  await db.$transaction(async (tx) => {
    for (const c of targets) {
      for (const s of source) {
        const exists = await tx.feeStructure.findFirst({ where: { academicYearId: s.academicYearId, classId: c.id, termId: s.termId, feeHeadId: s.feeHeadId } });
        if (exists) { skipped++; continue; }
        await tx.feeStructure.create({ data: { academicYearId: s.academicYearId, classId: c.id, termId: s.termId, feeHeadId: s.feeHeadId, amount: s.amount, dueDate: s.dueDate, instalments: s.instalments } });
        created++;
      }
    }
  }, { timeout: 30000 });
  return { created, skipped };
}

/** "Generate dues now" for a term (term 1 also brings the annual fees) or for annual fees only. Idempotent. */
export async function generateTermDues(branchId: string, input: { academicYearId: string; termId: string | null }) {
  const year = await db.academicYear.findUnique({ where: { id: input.academicYearId }, include: { terms: true } });
  if (!year) throw new AppError("Academic year not found.");
  if (year.closedAt) throw new AppError("This academic year is closed.");
  if (input.termId === null) {
    const created = await generateDues({ academicYearId: year.id, termId: null, branchId });
    return { created, termName: "Annual fees" };
  }
  const term = year.terms.find((t) => t.id === input.termId);
  if (!term) throw new AppError("Term not found.");
  const created = await generateDues({ academicYearId: year.id, termId: term.id, includeAnnual: term.sequence === 1, branchId });
  if (!term.duesGeneratedAt) await db.term.update({ where: { id: term.id }, data: { duesGeneratedAt: new Date() } });
  return { created, termName: term.name };
}

/* ───────────────────────── fee lines ───────────────────────── */

export async function addManualLine(branchId: string, input: { studentId: string; feeHeadId: string; description: string; amount: number; dueDate: Date; termId?: string }) {
  if (input.amount <= 0) throw new AppError("Amount must be more than zero.");
  const [student, head, year] = await Promise.all([studentInBranch(db, branchId, input.studentId), db.feeHead.findFirst({ where: { id: input.feeHeadId, branchId } }), requireYear()]);
  if (!head) throw new AppError("Choose a valid fee head.");
  if (input.termId && !year.terms.some((t) => t.id === input.termId)) throw new AppError("The term does not belong to the current year.");
  return db.$transaction(async (tx) => {
    await lockStudent(tx, student.id);
    return createFeeLine(tx, { studentId: student.id, academicYearId: year.id, termId: input.termId ?? null, feeHeadId: head.id, description: input.description, amount: input.amount, dueDate: input.dueDate, source: "MANUAL" });
  });
}

/** Split an unpaid fee line into instalments with their own due dates. The original line is cancelled and kept for history. */
export async function splitLine(branchId: string, input: { studentFeeId: string; parts: { amount: number; dueDate: Date }[] }) {
  const f = await db.studentFee.findFirst({ where: { id: input.studentFeeId, student: { branchId } } });
  if (!f) throw new AppError("Fee line not found.");
  if (f.status !== "PENDING" || toNum(f.paidAmount) !== 0) throw new AppError("Only an unpaid fee line can be split into instalments.");
  if (toNum(f.lateFeeAmount) !== 0 || toNum(f.adjustmentAmount) !== 0) throw new AppError("This line has a late fee or adjustment. Settle that first, or split before the due date.");
  if (input.parts.length < 2 || input.parts.length > 12) throw new AppError("Split into 2 to 12 instalments.");
  for (const p of input.parts) if (p.amount <= 0) throw new AppError("Each instalment must be more than zero.");
  const sum = round2(input.parts.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(sum - toNum(f.amount)) > 0.009) throw new AppError(`The instalments add up to ${money(sum)} but the fee is ${money(f.amount)}.`);
  const parts = [...input.parts].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return db.$transaction(async (tx) => {
    await lockStudent(tx, f.studentId);
    const fresh = await tx.studentFee.findUniqueOrThrow({ where: { id: f.id } });
    if (fresh.status !== "PENDING" || toNum(fresh.paidAmount) !== 0) throw new AppError("This fee line was paid meanwhile and cannot be split.");
    await tx.studentFee.update({ where: { id: f.id }, data: { status: "CANCELLED" } });
    await recalcFee(tx, f.id);
    const base = f.description.replace(/\s*\(Instalment \d+\/\d+\)$/, "");
    for (const [i, p] of parts.entries()) {
      await createFeeLine(tx, {
        studentId: f.studentId, academicYearId: f.academicYearId, termId: f.termId, feeHeadId: f.feeHeadId, description: `${base} (Instalment ${i + 1}/${parts.length})`,
        amount: p.amount, dueDate: p.dueDate, source: f.source,
        structureId: f.structureId, allocationId: f.allocationId, instalmentNo: i + 1, splitFromId: f.id,
      });
    }
    return { count: parts.length };
  });
}

/* ───────────────────────── counter collection ───────────────────────── */

export type CollectInput = {
  studentId: string;
  mode: PaymentMode;
  amount: number;
  allocations?: { studentFeeId: string; amount: number }[];
  reference?: string;
  chequeBank?: string;
  chequeDate?: Date;
  paidOn?: Date;
  notes?: string;
  sendVia?: ReceiptChannel[];
};

export async function collectPayment(user: SessionUser, branchId: string, input: CollectInput) {
  const student = await studentInBranch(db, branchId, input.studentId);
  if (input.mode === "CHEQUE" && (!input.chequeBank || !input.reference || !input.chequeDate)) throw new AppError("Enter the bank, cheque number and cheque date.");
  if (["UPI", "CARD", "NETBANKING", "BANK_TRANSFER"].includes(input.mode) && !input.reference) throw new AppError(`Enter the ${input.mode === "CARD" ? "card approval / terminal reference" : "transaction reference (UTR / txn id)"}.`);
  const day = input.paidOn ? new Date(isoDate(input.paidOn) + "T00:00:00.000Z") : today();
  if (day > today()) throw new AppError("The payment date cannot be in the future.");
  // Today's payments carry the actual time; back-dated entries are stamped at noon IST of that day.
  const paidAt = day.getTime() === today().getTime() ? new Date() : new Date(day.getTime() + 6.5 * 3600000);
  const allocations = input.allocations?.filter((a) => a.amount > 0);
  const payment = await db.$transaction(async (tx) => {
    await lockStudent(tx, student.id);
    await assertDayOpen(tx, branchId, paidAt);
    return recordPayment(tx, {
      branchId, studentId: student.id, amount: input.amount, mode: input.mode, purpose: "FEE", allocations: allocations?.length ? allocations : undefined,
      reference: input.reference, chequeBank: input.mode === "CHEQUE" ? input.chequeBank : undefined, chequeDate: input.mode === "CHEQUE" ? input.chequeDate : undefined,
      source: "COUNTER", collectedById: user.id, notes: input.notes, paidAt, reconciled: input.mode === "CASH",
    });
  }, { timeout: 20000 });
  if (input.sendVia?.length) await sendReceipt(payment.id, input.sendVia).catch((e) => console.error("[fees] receipt send failed", e));
  return payment;
}

/* ───────────────────────── receipts: cancel / bounce / reconcile ───────────────────────── */

async function paymentInBranch(client: DbOrTx, branchId: string, id: string) {
  const p = await client.payment.findFirst({ where: { id, branchId }, include: { student: true } });
  if (!p) throw new AppError("Payment not found.");
  return p;
}

export async function cancelReceipt(branchId: string, paymentId: string, reason: string) {
  const p = await paymentInBranch(db, branchId, paymentId);
  if (p.purpose !== "FEE") throw new AppError("Uniform payments are cancelled from the uniform order.");
  if (p.dayClosingId) throw new AppError("This receipt belongs to a closed cash-book day and cannot be cancelled. Record a refund instead.");
  return db.$transaction(async (tx) => {
    await lockStudent(tx, p.studentId);
    await assertDayOpen(tx, branchId, p.paidAt);
    return reversePayment(tx, p.id, "CANCELLED", `Cancelled on ${isoDate()}: ${reason}`);
  });
}

export async function bounceCheque(branchId: string, paymentId: string, reason: string) {
  const p = await paymentInBranch(db, branchId, paymentId);
  if (p.mode !== "CHEQUE") throw new AppError("Only cheque payments can be marked as bounced.");
  if (p.purpose !== "FEE") throw new AppError("Uniform payments are handled from the uniform order.");
  // A bounce is a bank event after the fact, so it is allowed even when the receipt day is closed (the closing keeps its snapshot).
  const r = await db.$transaction(async (tx) => {
    await lockStudent(tx, p.studentId);
    return reversePayment(tx, p.id, "BOUNCED", `Cheque bounced on ${isoDate()}: ${reason}`);
  });
  await notifyGuardians(p.studentId, {
    title: "Cheque returned by the bank",
    body: `The cheque ${p.reference ?? ""} for ${money(p.amount)} (receipt ${p.receiptNo}) for ${fullName(p.student)} was returned unpaid. The fee is due again; please pay at the counter or online.`,
    link: "/parent/fees", category: "FEES",
    ta: {
      title: "காசோலை வங்கியால் திருப்பி அனுப்பப்பட்டது",
      body: `${fullName(p.student)} க்கான ${money(p.amount)} காசோலை ${p.reference ?? ""} (ரசீது ${p.receiptNo}) பணம் செலுத்தப்படாமல் திரும்பியது. கட்டணம் மீண்டும் செலுத்த வேண்டியுள்ளது; பள்ளி அலுவலகத்திலோ ஆன்லைனிலோ செலுத்தவும்.`,
    },
  }).catch(() => {});
  return r;
}

export async function markReconciled(branchId: string, paymentId: string) {
  const p = await paymentInBranch(db, branchId, paymentId);
  if (p.status !== "SUCCESS") throw new AppError("Only a successful payment can be matched with the bank.");
  if (p.reconciled) return p;
  return db.payment.update({ where: { id: p.id }, data: { reconciled: true, reconciledAt: new Date() } });
}

/* ───────────────────────── concessions ───────────────────────── */

export async function requestConcession(user: SessionUser, branchId: string, input: { studentId: string; type: ConcessionType; mode: "PERCENT" | "FIXED"; value: number; feeHeadId?: string; reason: string }) {
  const [student, year] = await Promise.all([studentInBranch(db, branchId, input.studentId), requireYear()]);
  if (input.value <= 0) throw new AppError("Value must be more than zero.");
  if (input.mode === "PERCENT" && input.value > 100) throw new AppError("A percentage cannot be more than 100.");
  if (input.feeHeadId && !(await db.feeHead.findFirst({ where: { id: input.feeHeadId, branchId } }))) throw new AppError("Choose a valid fee head.");
  const dup = await db.concession.findFirst({ where: { studentId: student.id, academicYearId: year.id, type: input.type, status: { in: ["PENDING", "APPROVED"] }, feeHeadId: input.feeHeadId ?? null } });
  if (dup) throw new AppError(`${fullName(student)} already has a ${dup.status.toLowerCase()} ${input.type.toLowerCase().replace("_", " ")} concession this year.`);
  const c = await db.concession.create({ data: { studentId: student.id, academicYearId: year.id, type: input.type, mode: input.mode, value: input.value, feeHeadId: input.feeHeadId ?? null, reason: input.reason, requestedById: user.id } });
  await notifyPermission("fees.concession.approve", { title: "Concession awaiting approval", body: `${fullName(student)} (${student.schoolClass.name}): ${input.mode === "PERCENT" ? `${input.value}%` : money(input.value)} — ${input.reason}`, link: "/fees/concessions?status=PENDING", category: "FEES", inAppOnly: true }, branchId);
  return c;
}

export async function decideConcession(user: SessionUser, branchId: string, input: { id: string; approve: boolean; note?: string }) {
  const c = await db.concession.findFirst({ where: { id: input.id, student: { branchId } }, include: { student: true } });
  if (!c) throw new AppError("Concession not found.");
  if (c.status !== "PENDING") throw new AppError("This concession has already been decided.");
  if (c.requestedById === user.id && user.roleKey !== "SUPER_ADMIN" && input.approve) throw new AppError("You cannot approve a concession you requested. Another approver must decide it.");
  if (!input.approve && !input.note) throw new AppError("Give a reason for rejecting.");
  await db.$transaction(async (tx) => {
    await lockStudent(tx, c.studentId);
    const upd = await tx.concession.updateMany({ where: { id: c.id, status: "PENDING" }, data: { status: input.approve ? "APPROVED" : "REJECTED", approvedById: user.id, decidedAt: new Date(), decisionNote: input.note } });
    if (upd.count !== 1) throw new AppError("This concession has already been decided.");
    if (input.approve) await reapplyConcessions(tx, c.studentId, c.academicYearId);
  }, { timeout: 20000 });
  if (c.requestedById) await notifyUsers([c.requestedById], { title: `Concession ${input.approve ? "approved" : "rejected"}`, body: `${fullName(c.student)}${input.note ? ` — ${input.note}` : ""}`, link: `/fees/accounts/${c.studentId}`, category: "FEES", inAppOnly: true });
}

/** Sibling / staff-child candidates without a concession of that type this year (policy percentages pre-filled). */
export async function concessionSuggestions(branchId: string) {
  const [year, policies] = await Promise.all([currentAcademicYear(), getSetting("policies", branchId)]);
  if (!year) return [];
  const existing = await db.concession.findMany({ where: { academicYearId: year.id, status: { in: ["PENDING", "APPROVED"] }, type: { in: ["SIBLING", "STAFF_CHILD"] }, student: { branchId } }, select: { studentId: true, type: true } });
  const has = new Set(existing.map((e) => `${e.studentId}:${e.type}`));
  const out: { studentId: string; name: string; admissionNo: string; className: string; type: "SIBLING" | "STAFF_CHILD"; percent: number; reason: string }[] = [];

  const staffKids = await db.student.findMany({ where: { branchId, status: "ACTIVE", isStaffChild: true }, include: { schoolClass: true, staffUser: true } });
  for (const s of staffKids) {
    if (has.has(`${s.id}:STAFF_CHILD`) || policies.staffChildDiscountPercent <= 0) continue;
    out.push({ studentId: s.id, name: fullName(s), admissionNo: s.admissionNo, className: s.schoolClass.name, type: "STAFF_CHILD", percent: policies.staffChildDiscountPercent, reason: `Child of staff member ${s.staffUser?.name ?? ""}`.trim() });
  }
  if (policies.siblingDiscountPercent > 0) {
    // Families with two or more active children: every child except the eldest gets the sibling discount.
    const links = await db.studentGuardian.findMany({ where: { student: { branchId, status: "ACTIVE" } }, include: { student: { include: { schoolClass: true } } } });
    const byGuardian = new Map<string, typeof links>();
    for (const l of links) byGuardian.set(l.guardianId, [...(byGuardian.get(l.guardianId) ?? []), l]);
    const seen = new Set<string>();
    for (const group of byGuardian.values()) {
      if (group.length < 2) continue;
      const kids = [...new Map(group.map((g) => [g.studentId, g.student])).values()].sort((a, b) => (a.dob?.getTime() ?? 0) - (b.dob?.getTime() ?? 0) || b.schoolClass.grade - a.schoolClass.grade);
      const eldest = kids[0];
      for (const k of kids.slice(1)) {
        if (seen.has(k.id) || has.has(`${k.id}:SIBLING`)) continue;
        seen.add(k.id);
        out.push({ studentId: k.id, name: fullName(k), admissionNo: k.admissionNo, className: k.schoolClass.name, type: "SIBLING", percent: policies.siblingDiscountPercent, reason: `Sibling of ${fullName(eldest)} (${eldest.schoolClass.name})` });
      }
    }
  }
  return out;
}

/* ───────────────────────── adjustments ───────────────────────── */

export async function requestAdjustment(user: SessionUser, branchId: string, input: { studentFeeId: string; amount: number; reason: string }) {
  const f = await db.studentFee.findFirst({ where: { id: input.studentFeeId, student: { branchId } }, include: { student: true } });
  if (!f) throw new AppError("Fee line not found.");
  if (f.status === "CANCELLED") throw new AppError("This fee line is cancelled.");
  if (input.amount === 0) throw new AppError("Enter a non-zero amount (negative reduces the fee, positive adds to it).");
  if (round2(feeNet(f) + input.amount) < 0) throw new AppError(`The fee cannot go below zero. The most you can reduce is ${money(feeNet(f))}.`);
  const a = await db.feeAdjustment.create({ data: { studentFeeId: f.id, amount: input.amount, reason: input.reason, requestedById: user.id } });
  await notifyPermission("fees.refund.approve", { title: "Fee adjustment awaiting approval", body: `${fullName(f.student)} — ${f.description}: ${input.amount > 0 ? "+" : ""}${money(input.amount)} — ${input.reason}`, link: "/fees/refunds?tab=adjustments", category: "FEES", inAppOnly: true }, branchId);
  return a;
}

export async function decideAdjustment(user: SessionUser, branchId: string, input: { id: string; approve: boolean; note?: string }) {
  const a = await db.feeAdjustment.findFirst({ where: { id: input.id, studentFee: { student: { branchId } } }, include: { studentFee: { include: { student: true } } } });
  if (!a) throw new AppError("Adjustment not found.");
  if (a.status !== "PENDING") throw new AppError("This adjustment has already been decided.");
  if (a.requestedById === user.id && user.roleKey !== "SUPER_ADMIN" && input.approve) throw new AppError("You cannot approve a adjustment you requested. Another approver must decide it.");
  if (!input.approve && !input.note) throw new AppError("Give a reason for rejecting.");
  await db.$transaction(async (tx) => {
    await lockStudent(tx, a.studentFee.studentId);
    const upd = await tx.feeAdjustment.updateMany({ where: { id: a.id, status: "PENDING" }, data: { status: input.approve ? "APPROVED" : "REJECTED", approvedById: user.id, decidedAt: new Date(), decisionNote: input.note } });
    if (upd.count !== 1) throw new AppError("This adjustment has already been decided.");
    if (input.approve) {
      const f = await tx.studentFee.findUniqueOrThrow({ where: { id: a.studentFeeId } });
      if (f.status === "CANCELLED") throw new AppError("The fee line has been cancelled.");
      if (round2(feeNet(f) + toNum(a.amount)) < 0) throw new AppError("Approving this would take the fee below zero.");
      await tx.studentFee.update({ where: { id: f.id }, data: { adjustmentAmount: { increment: toNum(a.amount) } } });
      await recalcFee(tx, f.id);
    }
  });
  if (a.requestedById) await notifyUsers([a.requestedById], { title: `Fee adjustment ${input.approve ? "approved" : "rejected"}`, body: `${fullName(a.studentFee.student)} — ${a.studentFee.description}${input.note ? ` — ${input.note}` : ""}`, link: `/fees/accounts/${a.studentFee.studentId}`, category: "FEES", inAppOnly: true });
}

/* ───────────────────────── refunds ───────────────────────── */

export async function requestRefund(user: SessionUser, branchId: string, input: { paymentId: string; amount: number; reason: string; waiveFee: boolean; mode: PaymentMode }) {
  const p = await paymentInBranch(db, branchId, input.paymentId);
  if (p.status !== "SUCCESS") throw new AppError("Refunds can only be made against a successful payment.");
  if (p.purpose !== "FEE") throw new AppError("Uniform refunds are handled from the uniform order (exchange / return).");
  const pending = await db.refund.aggregate({ where: { paymentId: p.id, status: "PENDING" }, _sum: { amount: true } });
  const available = round2(toNum(p.amount) - toNum(p.refundedAmount) - toNum(pending._sum.amount));
  if (input.amount <= 0) throw new AppError("Amount must be more than zero.");
  if (input.amount - available > 0.009) throw new AppError(`At most ${money(available)} can be refunded from this receipt (after earlier and pending refunds).`);
  const r = await db.refund.create({ data: { paymentId: p.id, studentId: p.studentId, amount: input.amount, reason: input.reason, waiveFee: input.waiveFee, mode: input.mode, requestedById: user.id } });
  await notifyPermission("fees.refund.approve", { title: "Refund awaiting approval", body: `${fullName(p.student)} — ${money(input.amount)} from receipt ${p.receiptNo} — ${input.reason}`, link: "/fees/refunds", category: "FEES", inAppOnly: true }, branchId);
  return r;
}

/**
 * Approve or reject a refund. Approval de-allocates the amount from the payment's fee lines (latest allocation first,
 * recorded as negative allocation rows so the original receipt stays unchanged), optionally waives the same amount
 * through an approved fee adjustment, and increases payment.refundedAmount. The approver and payout are recorded.
 */
export async function decideRefund(user: SessionUser, branchId: string, input: { id: string; approve: boolean; note?: string; payoutRef?: string }) {
  const r = await db.refund.findFirst({ where: { id: input.id, student: { branchId } }, include: { payment: true, student: true } });
  if (!r) throw new AppError("Refund not found.");
  if (r.status !== "PENDING") throw new AppError("This refund has already been decided.");
  if (r.requestedById === user.id && user.roleKey !== "SUPER_ADMIN" && input.approve) throw new AppError("You cannot approve a refund you requested. Another approver must decide it.");
  if (!input.approve && !input.note) throw new AppError("Give a reason for rejecting.");
  await db.$transaction(async (tx) => {
    await lockStudent(tx, r.studentId);
    const note = [input.approve ? `Paid out by ${MODE_LABEL[r.mode]}${input.payoutRef ? `, ref ${input.payoutRef}` : ""}` : null, input.note].filter(Boolean).join(". ");
    const upd = await tx.refund.updateMany({ where: { id: r.id, status: "PENDING" }, data: { status: input.approve ? "APPROVED" : "REJECTED", approvedById: user.id, decidedAt: new Date(), decisionNote: note || null } });
    if (upd.count !== 1) throw new AppError("This refund has already been decided.");
    if (!input.approve) return;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: r.paymentId }, include: { allocations: { orderBy: { id: "asc" } } } });
    if (p.status !== "SUCCESS") throw new AppError("The payment is no longer successful (cancelled or bounced).");
    const amount = toNum(r.amount);
    if (amount - (toNum(p.amount) - toNum(p.refundedAmount)) > 0.009) throw new AppError("The refund is more than what is left on this receipt.");
    // Net allocated amount per fee line on this payment (originals minus earlier refunds)
    const net = new Map<string, number>();
    const order: string[] = [];
    for (const a of p.allocations) {
      if (!net.has(a.studentFeeId)) order.push(a.studentFeeId);
      net.set(a.studentFeeId, round2((net.get(a.studentFeeId) ?? 0) + toNum(a.amount)));
    }
    let left = amount;
    for (const feeId of order.reverse()) {
      if (left <= 0) break;
      const take = round2(Math.min(left, net.get(feeId) ?? 0));
      if (take <= 0) continue;
      await tx.paymentAllocation.create({ data: { paymentId: p.id, studentFeeId: feeId, amount: -take } });
      await tx.studentFee.update({ where: { id: feeId }, data: { paidAmount: { decrement: take } } });
      if (r.waiveFee) {
        await tx.feeAdjustment.create({ data: { studentFeeId: feeId, amount: -take, reason: `Waived with refund of receipt ${p.receiptNo}: ${r.reason}`, status: "APPROVED", requestedById: r.requestedById, approvedById: user.id, decidedAt: new Date() } });
        await tx.studentFee.update({ where: { id: feeId }, data: { adjustmentAmount: { decrement: take } } });
      }
      await recalcFee(tx, feeId);
      left = round2(left - take);
    }
    if (left > 0.009) throw new AppError("The refund is more than the amount allocated on this receipt.");
    await tx.payment.update({ where: { id: p.id }, data: { refundedAmount: { increment: amount } } });
  }, { timeout: 20000 });
  if (r.requestedById) await notifyUsers([r.requestedById], { title: `Refund ${input.approve ? "approved" : "rejected"}`, body: `${fullName(r.student)} — ${money(r.amount)}${input.note ? ` — ${input.note}` : ""}`, link: "/fees/refunds", category: "FEES", inAppOnly: true });
}

/* ───────────────────────── cash book ───────────────────────── */

export async function dayBook(branchId: string, day: Date) {
  const date = new Date(isoDate(day) + "T00:00:00.000Z");
  const range = istDayRange(date);
  const [payments, closing, refunds] = await Promise.all([
    db.payment.findMany({ where: { branchId, paidAt: range, status: { in: ["SUCCESS", "BOUNCED", "CANCELLED"] } }, include: { student: { include: { schoolClass: true } } }, orderBy: { paidAt: "asc" } }),
    db.dayClosing.findUnique({ where: { branchId_date: { branchId, date } } }),
    db.refund.findMany({ where: { student: { branchId }, status: "APPROVED", decidedAt: range }, include: { student: true, payment: true } }),
  ]);
  const ok = payments.filter((p) => p.status === "SUCCESS");
  const totals: Record<string, number> = {};
  for (const p of ok) totals[p.mode] = round2((totals[p.mode] ?? 0) + toNum(p.amount));
  const total = round2(ok.reduce((s, p) => s + toNum(p.amount), 0));
  const cash = totals.CASH ?? 0;
  const refundsCash = round2(refunds.filter((r) => r.mode === "CASH").reduce((s, r) => s + toNum(r.amount), 0));
  const counter = round2(ok.filter((p) => p.source !== "ONLINE").reduce((s, p) => s + toNum(p.amount), 0));
  const online = round2(total - counter);
  return { date, payments, closing, refunds, totals, total, cash, nonCash: round2(total - cash), refundsCash, counter, online, count: ok.length };
}

export async function closeDay(user: SessionUser, branchId: string, input: { date: Date; cashCounted: number; bankCredited: number; cashDeposited: number; notes?: string }) {
  const date = new Date(isoDate(input.date) + "T00:00:00.000Z");
  if (date > today()) throw new AppError("You cannot close a future day.");
  const book = await dayBook(branchId, date);
  if (book.closing) throw new AppError("This day is already closed.");
  const expectedCash = round2(book.cash - book.refundsCash);
  const difference = round2(input.cashCounted - expectedCash + (input.bankCredited - book.nonCash));
  if (Math.abs(difference) > 0.009 && !input.notes) throw new AppError(`There is a difference of ${money(difference)}. Explain it in the notes before closing.`);
  return db.$transaction(async (tx) => {
    const c = await tx.dayClosing.create({
      data: { branchId, date, totals: { ...book.totals, total: book.total, refundsCash: book.refundsCash, count: book.count }, cashCounted: input.cashCounted, bankCredited: input.bankCredited, cashDeposited: input.cashDeposited, difference, notes: input.notes, closedById: user.id },
    });
    await tx.payment.updateMany({ where: { id: { in: book.payments.filter((p) => p.status === "SUCCESS").map((p) => p.id) } }, data: { dayClosingId: c.id } });
    return c;
  });
}

/* ───────────────────────── reminders ───────────────────────── */

/** Send a dues reminder (with pay-now link) to the guardians of each student. */
export async function sendDueReminders(branchId: string, studentIds: string[]) {
  const students = await db.student.findMany({ where: { id: { in: studentIds }, branchId }, include: { schoolClass: true } });
  let sent = 0;
  for (const s of students) {
    const agg = await db.studentFee.aggregate({ where: { studentId: s.id, status: { in: ["PENDING", "PARTIAL"] }, dueDate: { lt: today() } }, _sum: { balance: true }, _min: { dueDate: true } });
    const amount = toNum(agg._sum.balance);
    if (amount <= 0) continue;
    await notifyGuardians(s.id, {
      title: "Fee payment overdue",
      body: `Dear parent, fees of ${money(amount)} for ${fullName(s)} (${s.schoolClass.name}) are overdue since ${isoDate(agg._min.dueDate)}. Please pay at the earliest. Pay now:`,
      link: "/parent/fees", category: "FEES", channels: ["SMS"], template: "FEE_REMINDER",
      ta: {
        title: "கட்டணம் செலுத்தும் தேதி கடந்துவிட்டது",
        body: `அன்புள்ள பெற்றோரே, ${fullName(s)} (${s.schoolClass.name}) க்கான ${money(amount)} கட்டணம் ${isoDate(agg._min.dueDate)} முதல் நிலுவையில் உள்ளது. விரைவில் செலுத்தவும். இப்போது செலுத்த:`,
      },
    });
    sent++;
  }
  return sent;
}

/** Defaulter cut-off date: lines due before this are "overdue more than policies.defaulterDays". */
export async function defaulterCutoff(branchId: string) {
  const policies = await getSetting("policies", branchId);
  return { cutoff: addDays(today(), -policies.defaulterDays), days: policies.defaulterDays };
}

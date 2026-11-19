import "server-only";
import type { FeeStatus, PaymentMode, PaymentPurpose, PaymentStatus, Prisma, FeeSource } from "@prisma/client";
import { db, type DbOrTx } from "@/lib/db";
import { round2, toNum } from "@/lib/format";
import { nextNumber } from "@/lib/counters";
import { getSetting } from "@/lib/settings";
import { AppError } from "@/lib/errors";

/**
 * FEE CORE — shared by every module that touches a student's fee account.
 * Balance = amount − concession + late fee + adjustment − paid. Negative balance = credit (refundable).
 */

type FeeNums = { amount: unknown; concessionAmount: unknown; lateFeeAmount: unknown; adjustmentAmount: unknown; paidAmount: unknown; status?: FeeStatus };

export function feeNet(f: FeeNums) {
  return round2(toNum(f.amount as number) - toNum(f.concessionAmount as number) + toNum(f.lateFeeAmount as number) + toNum(f.adjustmentAmount as number));
}

export function feeBalance(f: FeeNums) {
  return round2(feeNet(f) - toNum(f.paidAmount as number));
}

export function feeStatusFor(f: FeeNums): FeeStatus {
  if (f.status === "CANCELLED") return "CANCELLED";
  const net = feeNet(f);
  const paid = toNum(f.paidAmount as number);
  const bal = round2(net - paid);
  if (net <= 0 && paid <= 0) return "WAIVED";
  if (bal <= 0) return "PAID";
  if (paid > 0) return "PARTIAL";
  return "PENDING";
}

/** Recompute balance + status for one fee line. Call after any change to its amounts. */
export async function recalcFee(client: DbOrTx, id: string) {
  const f = await client.studentFee.findUniqueOrThrow({ where: { id } });
  const balance = f.status === "CANCELLED" ? 0 : feeBalance(f);
  const status = feeStatusFor(f);
  if (toNum(f.balance) !== balance || f.status !== status) {
    return client.studentFee.update({ where: { id }, data: { balance, status } });
  }
  return f;
}

/** Concession amount for a fee line from the student's APPROVED concessions in that year. */
export async function concessionFor(client: DbOrTx, studentId: string, academicYearId: string, feeHeadId: string, amount: number) {
  const [concessions, head] = await Promise.all([
    client.concession.findMany({ where: { studentId, academicYearId, status: "APPROVED" } }),
    client.feeHead.findUnique({ where: { id: feeHeadId } }),
  ]);
  let total = 0;
  for (const c of concessions) {
    const applies = c.feeHeadId ? c.feeHeadId === feeHeadId : head?.type === "TUITION";
    if (!applies) continue;
    total += c.mode === "PERCENT" ? (amount * toNum(c.value)) / 100 : toNum(c.value);
  }
  return round2(Math.min(total, amount));
}

/** Re-apply approved concessions to all of a student's open fee lines in a year. */
export async function reapplyConcessions(client: DbOrTx, studentId: string, academicYearId: string) {
  const fees = await client.studentFee.findMany({ where: { studentId, academicYearId, status: { not: "CANCELLED" } } });
  for (const f of fees) {
    const c = await concessionFor(client, studentId, academicYearId, f.feeHeadId, toNum(f.amount));
    if (c !== toNum(f.concessionAmount)) {
      await client.studentFee.update({ where: { id: f.id }, data: { concessionAmount: c } });
      await recalcFee(client, f.id);
    }
  }
}

export type NewFeeLine = {
  studentId: string;
  academicYearId: string;
  termId?: string | null;
  feeHeadId: string;
  description: string;
  amount: number;
  dueDate: Date;
  source: FeeSource;
  structureId?: string | null;
  allocationId?: string | null;
  instalmentNo?: number | null;
  splitFromId?: string | null;
  paidAmount?: number;
};

/** Create a fee line on a student's account (concessions applied automatically). */
export async function createFeeLine(client: DbOrTx, line: NewFeeLine) {
  const concessionAmount = await concessionFor(client, line.studentId, line.academicYearId, line.feeHeadId, line.amount);
  const f = await client.studentFee.create({
    data: {
      studentId: line.studentId, academicYearId: line.academicYearId, termId: line.termId ?? null, feeHeadId: line.feeHeadId,
      description: line.description, amount: line.amount, concessionAmount, dueDate: line.dueDate, source: line.source,
      structureId: line.structureId ?? null, allocationId: line.allocationId ?? null, instalmentNo: line.instalmentNo ?? null,
      splitFromId: line.splitFromId ?? null, paidAmount: line.paidAmount ?? 0,
    },
  });
  return recalcFee(client, f.id);
}

/** Split an amount into n instalments (last one takes the rounding remainder), due every `gapDays` from the first due date. */
export function splitInstalments(amount: number, n: number, firstDue: Date, gapDays = 30) {
  const per = Math.floor((amount / n) * 100) / 100;
  return Array.from({ length: n }, (_, i) => ({
    no: i + 1,
    amount: i === n - 1 ? round2(amount - per * (n - 1)) : per,
    dueDate: new Date(firstDue.getTime() + i * gapDays * 86400000),
  }));
}

/**
 * Generate dues from the fee structure for a year (optionally one term, optionally some students).
 * Idempotent: a student never gets the same structure line twice.
 */
export async function generateDues(opts: { academicYearId: string; termId?: string | null; studentIds?: string[]; branchId?: string; includeAnnual?: boolean }) {
  const structures = await db.feeStructure.findMany({
    where: {
      academicYearId: opts.academicYearId,
      ...(opts.termId !== undefined ? { OR: [{ termId: opts.termId }, ...(opts.includeAnnual ? [{ termId: null }] : [])] } : {}),
      ...(opts.branchId ? { schoolClass: { branchId: opts.branchId } } : {}),
    },
    include: { feeHead: true, term: true },
  });
  let created = 0;
  for (const s of structures) {
    const students = await db.student.findMany({
      where: { classId: s.classId, status: "ACTIVE", ...(opts.studentIds ? { id: { in: opts.studentIds } } : {}) },
      select: { id: true, admissionDate: true },
    });
    const existing = new Set((await db.studentFee.findMany({ where: { structureId: s.id, studentId: { in: students.map((x) => x.id) } }, select: { studentId: true } })).map((x) => x.studentId));
    for (const st of students) {
      if (existing.has(st.id)) continue;
      // Skip a term that ended before the student was admitted
      if (s.term && s.term.endDate < st.admissionDate) continue;
      const desc = `${s.feeHead.name}${s.term ? ` — ${s.term.name}` : " — Annual"}`;
      await db.$transaction(async (tx) => {
        if (s.instalments > 1) {
          for (const inst of splitInstalments(toNum(s.amount), s.instalments, s.dueDate)) {
            await createFeeLine(tx, { studentId: st.id, academicYearId: s.academicYearId, termId: s.termId, feeHeadId: s.feeHeadId, description: `${desc} (Instalment ${inst.no}/${s.instalments})`, amount: inst.amount, dueDate: inst.dueDate, source: "STRUCTURE", structureId: s.id, instalmentNo: inst.no });
          }
        } else {
          await createFeeLine(tx, { studentId: st.id, academicYearId: s.academicYearId, termId: s.termId, feeHeadId: s.feeHeadId, description: desc, amount: toNum(s.amount), dueDate: s.dueDate, source: "STRUCTURE", structureId: s.id });
        }
      });
      created++;
    }
  }
  return created;
}

/** Generate dues for a newly admitted student for every term of the current year whose dues were already generated. */
export async function generateDuesForNewStudent(studentId: string) {
  const year = await db.academicYear.findFirst({ where: { isCurrent: true }, include: { terms: true } });
  if (!year) return 0;
  let n = 0;
  const generatedTerms = year.terms.filter((t) => t.duesGeneratedAt);
  for (const t of generatedTerms) n += await generateDues({ academicYearId: year.id, termId: t.id, studentIds: [studentId], includeAnnual: t.sequence === 1 });
  if (!generatedTerms.length) return 0;
  return n;
}

export async function nextReceiptNo(client: DbOrTx, branchId: string) {
  const [policies, year, branch] = await Promise.all([
    getSetting("policies", branchId),
    client.academicYear.findFirst({ where: { isCurrent: true } }),
    client.branch.findUniqueOrThrow({ where: { id: branchId } }),
  ]);
  const scope = `${branch.code}-${year?.name ?? new Date().getFullYear()}`;
  const n = await nextNumber(`${policies.receiptPrefix}-${scope}`, client);
  return `${policies.receiptPrefix}/${scope}/${String(n).padStart(5, "0")}`;
}

export type PaymentInput = {
  branchId: string;
  studentId: string;
  amount: number;
  mode: PaymentMode;
  purpose?: PaymentPurpose;
  uniformOrderId?: string;
  /** Specific fee lines to pay; omitted = oldest due first. */
  allocations?: { studentFeeId: string; amount: number }[];
  reference?: string;
  chequeBank?: string;
  chequeDate?: Date;
  source?: "COUNTER" | "ONLINE" | "IMPORT";
  gateway?: string;
  gatewayOrderId?: string;
  gatewayPaymentId?: string;
  status?: PaymentStatus;
  collectedById?: string;
  notes?: string;
  paidAt?: Date;
  reconciled?: boolean;
};

/** Allocate an amount across a student's open fee lines, oldest due date first. */
export async function autoAllocate(client: DbOrTx, studentId: string, amount: number, onlyFeeIds?: string[]) {
  const open = await client.studentFee.findMany({
    where: { studentId, status: { in: ["PENDING", "PARTIAL"] }, ...(onlyFeeIds ? { id: { in: onlyFeeIds } } : {}) },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });
  const out: { studentFeeId: string; amount: number }[] = [];
  let left = round2(amount);
  for (const f of open) {
    if (left <= 0) break;
    const bal = toNum(f.balance);
    if (bal <= 0) continue;
    const take = round2(Math.min(bal, left));
    out.push({ studentFeeId: f.id, amount: take });
    left = round2(left - take);
  }
  return { allocations: out, unallocated: left };
}

/**
 * Record a payment (counter or online). For FEE purpose the amount is allocated to fee lines;
 * a receipt number is issued for successful payments. Returns the payment.
 */
export async function recordPayment(client: DbOrTx, p: PaymentInput) {
  if (p.amount <= 0) throw new AppError("Amount must be more than zero.");
  const status = p.status ?? "SUCCESS";
  const purpose = p.purpose ?? "FEE";
  let allocations = p.allocations?.filter((a) => a.amount > 0);
  if (purpose === "FEE") {
    if (!allocations || allocations.length === 0) {
      const auto = await autoAllocate(client, p.studentId, p.amount);
      if (auto.unallocated > 0.009) throw new AppError(`The amount is more than the student's total dues by ₹${auto.unallocated.toLocaleString("en-IN")}.`);
      allocations = auto.allocations;
    } else {
      const sum = round2(allocations.reduce((s, a) => s + a.amount, 0));
      if (Math.abs(sum - p.amount) > 0.009) throw new AppError("The allocated amounts must add up to the payment amount.");
      for (const a of allocations) {
        const f = await client.studentFee.findUniqueOrThrow({ where: { id: a.studentFeeId } });
        if (f.studentId !== p.studentId) throw new AppError("A fee line does not belong to this student.");
        if (a.amount - toNum(f.balance) > 0.009) throw new AppError(`₹${a.amount} is more than the balance of “${f.description}”.`);
      }
    }
  }
  const receiptNo = status === "SUCCESS" ? await nextReceiptNo(client, p.branchId) : null;
  const payment = await client.payment.create({
    data: {
      branchId: p.branchId, studentId: p.studentId, amount: p.amount, mode: p.mode, purpose, uniformOrderId: p.uniformOrderId,
      status, source: p.source ?? "COUNTER", reference: p.reference, chequeBank: p.chequeBank, chequeDate: p.chequeDate,
      gateway: p.gateway, gatewayOrderId: p.gatewayOrderId, gatewayPaymentId: p.gatewayPaymentId, collectedById: p.collectedById,
      notes: p.notes, paidAt: p.paidAt ?? new Date(), receiptNo, reconciled: p.reconciled ?? (p.mode === "CASH"), reconciledAt: p.reconciled ? new Date() : null,
      allocations: purpose === "FEE" && allocations ? { create: allocations.map((a) => ({ studentFeeId: a.studentFeeId, amount: a.amount })) } : undefined,
    },
  });
  if (status === "SUCCESS" && purpose === "FEE" && allocations) await applyAllocations(client, allocations, +1);
  return payment;
}

async function applyAllocations(client: DbOrTx, allocations: { studentFeeId: string; amount: number | Prisma.Decimal }[], sign: 1 | -1) {
  for (const a of allocations) {
    await client.studentFee.update({ where: { id: a.studentFeeId }, data: { paidAmount: { increment: round2(sign * toNum(a.amount)) } } });
    await recalcFee(client, a.studentFeeId);
  }
}

/** Mark a pending (online) payment successful: issue receipt and apply its allocations. */
export async function confirmPendingPayment(client: DbOrTx, paymentId: string, data: { gatewayPaymentId?: string; mode?: PaymentMode } = {}) {
  const p = await client.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: true } });
  if (p.status === "SUCCESS") return p;
  if (p.status !== "PENDING") throw new AppError(`This payment is ${p.status.toLowerCase()}.`);
  const receiptNo = await nextReceiptNo(client, p.branchId);
  const updated = await client.payment.update({ where: { id: p.id }, data: { status: "SUCCESS", receiptNo, paidAt: new Date(), gatewayPaymentId: data.gatewayPaymentId ?? p.gatewayPaymentId, mode: data.mode ?? p.mode, reconciled: true, reconciledAt: new Date() } });
  if (p.purpose === "FEE") await applyAllocations(client, p.allocations, +1);
  return updated;
}

/** Reverse a successful payment (bounced cheque / cancelled receipt): fee lines become due again. */
export async function reversePayment(client: DbOrTx, paymentId: string, status: "BOUNCED" | "CANCELLED", note?: string) {
  const p = await client.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: true } });
  if (p.status !== "SUCCESS") throw new AppError("Only a successful payment can be reversed.");
  if (toNum(p.refundedAmount) > 0) throw new AppError("This payment has refunds recorded against it and cannot be reversed.");
  await client.payment.update({ where: { id: p.id }, data: { status, notes: [p.notes, note].filter(Boolean).join("\n") } });
  if (p.purpose === "FEE") await applyAllocations(client, p.allocations, -1);
  return p;
}

/** Total open dues for a student (optionally only lines due on or before a date). */
export async function studentDues(client: DbOrTx, studentId: string, dueBy?: Date) {
  const agg = await client.studentFee.aggregate({ where: { studentId, status: { in: ["PENDING", "PARTIAL"] }, ...(dueBy ? { dueDate: { lte: dueBy } } : {}) }, _sum: { balance: true }, _count: true });
  return { amount: toNum(agg._sum.balance), count: agg._count };
}

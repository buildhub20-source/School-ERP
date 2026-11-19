import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { round2, toNum } from "@/lib/format";
import { currentAcademicYear } from "@/lib/settings";

/**
 * ADD / EDIT / DELETE A WHOLE FEE (Fee structure → Add new fee): e.g. Miscellaneous, ID card, Annual day.
 * A fee = a fee head of type OTHER + one FeeStructure line per class for the current academic year.
 * Nothing is billed when it is saved: students get it when dues are generated (Fee structure → Generate dues,
 * or automatically when a term starts), exactly like any other structure fee.
 *
 * Once dues have been generated from a class line, that line's amount, term and instalments are locked (only the
 * due date can change) and the line can't be removed — the same rules as the Fee structure page.
 */

export type OtherFeeInput = {
  id?: string;
  name: string;
  lateFeeApplies: boolean;
  isActive: boolean;
  termId: string | null; // null = annual (billed with term 1 dues)
  dueDate: Date;
  instalments: number;
  lines: { classId: string; amount: number }[];
};

async function requireYear() {
  const year = await currentAcademicYear();
  if (!year) throw new AppError("Set the current academic year first (Settings → Academic years).");
  if (year.closedAt) throw new AppError("The current academic year is closed.");
  return year;
}

/** Fee heads billed by the hostel / library modules themselves (hostel fee, library fine) — managed there, not in the structure. */
export async function moduleOwnedHeadIds(branchId: string) {
  const rows = await db.studentFee.findMany({ where: { source: { in: ["HOSTEL", "LIBRARY"] }, feeHead: { branchId } }, select: { feeHeadId: true }, distinct: ["feeHeadId"] });
  return new Set(rows.map((r) => r.feeHeadId));
}

export async function saveOtherFee(branchId: string, input: OtherFeeInput) {
  const name = input.name.trim();
  if (!name) throw new AppError("Enter the fee name.");
  if (!input.lines.length) throw new AppError("Tick at least one class.");
  if (input.instalments < 1 || input.instalments > 12) throw new AppError("Instalments must be between 1 and 12.");
  const lines = input.lines.map((l) => ({ classId: l.classId, amount: round2(l.amount) }));
  if (lines.some((l) => !(l.amount > 0))) throw new AppError("Every ticked class needs an amount more than zero.");
  if (new Set(lines.map((l) => l.classId)).size !== lines.length) throw new AppError("A class is listed twice.");

  const year = await requireYear();
  if (input.termId && !year.terms.some((t) => t.id === input.termId)) throw new AppError("The term does not belong to the current year.");
  const classes = await db.schoolClass.findMany({ where: { branchId, id: { in: lines.map((l) => l.classId) } } });
  if (classes.length !== lines.length) throw new AppError("Choose valid classes.");
  const className = new Map(classes.map((c) => [c.id, c.name]));

  const clash = await db.feeHead.findFirst({ where: { branchId, name, ...(input.id ? { id: { not: input.id } } : {}) } });
  if (clash) throw new AppError(`A fee named “${name}” already exists. Use a different name or edit that fee.`);

  if (!input.id) {
    return db.$transaction(async (tx) => {
      const head = await tx.feeHead.create({ data: { branchId, name, type: "OTHER", lateFeeApplies: input.lateFeeApplies, isActive: input.isActive } });
      for (const l of lines) {
        await tx.feeStructure.create({ data: { academicYearId: year.id, classId: l.classId, termId: input.termId, feeHeadId: head.id, amount: l.amount, dueDate: input.dueDate, instalments: input.instalments } });
      }
      return { id: head.id, classes: lines.length, updated: 0, removed: 0 };
    });
  }

  const head = await db.feeHead.findFirst({ where: { id: input.id, branchId } });
  if (!head) throw new AppError("Fee not found.");
  if (head.type !== "OTHER") throw new AppError(`${head.name} is a ${head.type.toLowerCase()} fee. Edit it in Fee structure.`);
  const existing = await db.feeStructure.findMany({ where: { feeHeadId: head.id, academicYearId: year.id }, include: { _count: { select: { studentFees: true } } } });
  if (new Set(existing.map((e) => e.termId ?? "ANNUAL")).size > 1) {
    throw new AppError(`${head.name} has different lines per term. Edit it in Fee structure instead.`);
  }
  const wanted = new Map(lines.map((l) => [l.classId, l.amount]));

  // Check everything first so a refused change leaves nothing half-saved.
  const problems: string[] = [];
  for (const e of existing) {
    const billed = e._count.studentFees > 0;
    if (!billed) continue;
    const cls = className.get(e.classId) ?? (await db.schoolClass.findUnique({ where: { id: e.classId } }))?.name ?? "a class";
    const amount = wanted.get(e.classId);
    if (amount === undefined) problems.push(`${cls}: dues already generated, can't be removed`);
    else if (toNum(e.amount) !== amount || e.termId !== input.termId || e.instalments !== input.instalments) {
      problems.push(`${cls}: dues already generated, only the due date can change`);
    }
  }
  if (problems.length) throw new AppError(`Can't save: ${problems.join("; ")}. Adjust individual student accounts for those classes instead.`);

  return db.$transaction(async (tx) => {
    await tx.feeHead.update({ where: { id: head.id }, data: { name, lateFeeApplies: input.lateFeeApplies, isActive: input.isActive } });
    let updated = 0;
    let removed = 0;
    for (const e of existing) {
      const amount = wanted.get(e.classId);
      if (amount === undefined) { await tx.feeStructure.delete({ where: { id: e.id } }); removed++; continue; }
      wanted.delete(e.classId);
      await tx.feeStructure.update({ where: { id: e.id }, data: { amount, termId: input.termId, dueDate: input.dueDate, instalments: input.instalments } });
      // A new due date also moves already-generated, untouched single lines (same rule as Fee structure).
      if (e._count.studentFees > 0 && e.dueDate.getTime() !== input.dueDate.getTime() && e.instalments === 1) {
        await tx.studentFee.updateMany({ where: { structureId: e.id, status: "PENDING", paidAmount: 0, splitFromId: null, instalmentNo: null }, data: { dueDate: input.dueDate } });
      }
      // Billed lines keep their description; refresh it on a rename so accounts and receipts show the new name.
      if (e._count.studentFees > 0 && head.name !== name) {
        const billedLines = await tx.studentFee.findMany({ where: { structureId: e.id }, select: { id: true, description: true } });
        for (const b of billedLines) {
          if (b.description.startsWith(head.name)) await tx.studentFee.update({ where: { id: b.id }, data: { description: name + b.description.slice(head.name.length) } });
        }
      }
      updated++;
    }
    for (const [classId, amount] of wanted) {
      await tx.feeStructure.create({ data: { academicYearId: year.id, classId, termId: input.termId, feeHeadId: head.id, amount, dueDate: input.dueDate, instalments: input.instalments } });
    }
    return { id: head.id, classes: lines.length, updated, removed };
  });
}

/** Delete an other fee (its head and class lines) — only while no student has been billed for it. */
export async function deleteOtherFee(branchId: string, id: string) {
  const head = await db.feeHead.findFirst({ where: { id, branchId } });
  if (!head) throw new AppError("Fee not found.");
  if (head.type !== "OTHER") throw new AppError(`${head.name} is not an other fee.`);
  const [billed, concessions] = await Promise.all([db.studentFee.count({ where: { feeHeadId: head.id } }), db.concession.count({ where: { feeHeadId: head.id } })]);
  if (billed) throw new AppError(`${head.name} has already been billed to students (${billed} fee lines), so it can't be deleted. Edit it and untick Active to stop using it.`);
  if (concessions) throw new AppError(`${head.name} is used by ${concessions} concession(s), so it can't be deleted.`);
  await db.$transaction(async (tx) => {
    await tx.feeStructure.deleteMany({ where: { feeHeadId: head.id } });
    await tx.feeHead.delete({ where: { id: head.id } });
  });
  return { name: head.name };
}

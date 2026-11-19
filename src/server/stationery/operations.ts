import "server-only";
import type { MovementType, RecipientType } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getRequestContext } from "@/lib/context";
import { round2, toNum } from "@/lib/format";
import { assertStock, docNumber, mergeLines, moveStock, withStock } from "./core";

// ───────────── Direct issue, returns, damage, loss, adjustments ─────────────

export type MovementKind = "ISSUE" | "RETURN" | "DAMAGE" | "LOSS" | "ADJUST_IN" | "ADJUST_OUT" | "PURCHASE";

export type Recipient = { recipientType?: RecipientType; studentId?: string; recipientUserId?: string; classId?: string; departmentId?: string };

/** Resolve and validate the recipient; fill the class/department the movement is charged to (budget). */
async function resolveRecipient(branchId: string, r: Recipient) {
  const out: Recipient & { label: string } = { ...r, label: "" };
  switch (r.recipientType) {
    case "STUDENT": {
      if (!r.studentId) throw new AppError("Choose the student.");
      const s = await db.student.findFirst({ where: { id: r.studentId, branchId }, include: { schoolClass: true } });
      if (!s) throw new AppError("Student not found.");
      out.classId = r.classId ?? s.classId;
      out.departmentId = undefined;
      out.label = `${s.firstName} ${s.lastName ?? ""}`.trim();
      break;
    }
    case "TEACHER": {
      if (!r.recipientUserId) throw new AppError("Choose the teacher or staff member.");
      const u = await db.user.findFirst({ where: { id: r.recipientUserId, branchId } });
      if (!u) throw new AppError("Staff member not found.");
      out.label = u.name;
      break;
    }
    case "CLASS":
      if (!r.classId) throw new AppError("Choose the class.");
      out.departmentId = undefined;
      break;
    case "DEPARTMENT":
      if (!r.departmentId) throw new AppError("Choose the department.");
      out.classId = undefined;
      break;
    default:
      break;
  }
  if (out.classId && out.departmentId) throw new AppError("Charge the issue to a class or a department, not both.");
  if (out.classId && !(await db.schoolClass.findFirst({ where: { id: out.classId, branchId } }))) throw new AppError("Choose a valid class.");
  if (out.departmentId && !(await db.department.findFirst({ where: { id: out.departmentId, branchId } }))) throw new AppError("Choose a valid department.");
  return out;
}

const KIND_TYPE: Record<MovementKind, { type: MovementType; sign: 1 | -1 }> = {
  ISSUE: { type: "ISSUE", sign: -1 }, RETURN: { type: "RETURN", sign: 1 }, DAMAGE: { type: "DAMAGE", sign: -1 }, LOSS: { type: "LOSS", sign: -1 },
  ADJUST_IN: { type: "ADJUSTMENT", sign: 1 }, ADJUST_OUT: { type: "ADJUSTMENT", sign: -1 }, PURCHASE: { type: "PURCHASE", sign: 1 },
};

/**
 * Record stock movements for one or more items: direct issue to a student/teacher/class/department,
 * returns (back into stock), damage and loss (written off), manual adjustments.
 */
export async function recordMovement(branchId: string, input: Recipient & { kind: MovementKind; note?: string; lines: { itemId: string; qty: number }[] }) {
  const lines = mergeLines(input.lines);
  const { type, sign } = KIND_TYPE[input.kind];
  if ((input.kind === "DAMAGE" || input.kind === "LOSS" || input.kind.startsWith("ADJUST")) && !input.note) throw new AppError("Add a note explaining the damage, loss or adjustment.");
  const rec = input.kind === "ISSUE" || input.kind === "RETURN" ? await resolveRecipient(branchId, input) : ({ label: "" } as Recipient & { label: string });
  if (input.kind === "ISSUE" && !input.recipientType) throw new AppError("Choose who receives the items.");
  if (sign < 0) await assertStock(db, branchId, lines);
  return withStock(branchId, async (tx, touch) => {
    const out = [];
    for (const l of lines) {
      out.push(await moveStock(tx, branchId, {
        itemId: l.itemId, type, qty: sign * l.qty, recipientType: rec.recipientType ?? null, studentId: rec.studentId, recipientUserId: rec.recipientUserId,
        classId: rec.classId, departmentId: rec.departmentId, note: input.note,
      }));
      touch(l.itemId);
    }
    return { count: out.length };
  });
}

// ───────────── Kits ─────────────

export type KitInput = { name: string; classId: string; isActive?: boolean; lines: { itemId: string; qty: number }[] };

export async function saveKit(branchId: string, id: string | undefined, input: KitInput) {
  const lines = mergeLines(input.lines);
  if (!(await db.schoolClass.findFirst({ where: { id: input.classId, branchId } }))) throw new AppError("Choose a valid class.");
  if ((await db.stationeryItem.count({ where: { branchId, id: { in: lines.map((l) => l.itemId) } } })) !== lines.length) throw new AppError("One of the items was not found.");
  return db.$transaction(async (tx) => {
    if (id) {
      const kit = await tx.stationeryKit.findFirst({ where: { id, branchId } });
      if (!kit) throw new AppError("Kit not found.");
      await tx.stationeryKitItem.deleteMany({ where: { kitId: id } });
      return tx.stationeryKit.update({ where: { id }, data: { name: input.name, classId: input.classId, isActive: input.isActive ?? kit.isActive, items: { create: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) } } });
    }
    return tx.stationeryKit.create({ data: { branchId, name: input.name, classId: input.classId, items: { create: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })) } } });
  });
}

/** Active students a kit issue covers. */
export async function kitStudentCount(classId: string, sectionId?: string) {
  return db.student.count({ where: { classId, status: "ACTIVE", ...(sectionId ? { sectionId } : {}) } });
}

/**
 * Issue a kit to a whole class or one section in one step. Checks stock for every item first
 * (kit qty × students) and deducts nothing if anything is short.
 */
export async function issueKit(branchId: string, input: { kitId: string; sectionId?: string; studentCount?: number; note?: string }) {
  const kit = await db.stationeryKit.findFirst({ where: { id: input.kitId, branchId }, include: { items: { include: { item: true } }, schoolClass: { include: { sections: true } } } });
  if (!kit) throw new AppError("Kit not found.");
  if (!kit.isActive) throw new AppError("This kit is inactive.");
  if (!kit.items.length) throw new AppError("This kit has no items.");
  const section = input.sectionId ? kit.schoolClass.sections.find((s) => s.id === input.sectionId) : undefined;
  if (input.sectionId && !section) throw new AppError("The section does not belong to the kit's class.");
  const count = input.studentCount ?? (await kitStudentCount(kit.classId, input.sectionId));
  if (!Number.isInteger(count) || count <= 0) throw new AppError("There are no active students to issue the kit to.");
  const needs = kit.items.map((k) => ({ itemId: k.itemId, qty: k.qty * count }));
  await assertStock(db, branchId, mergeLines(needs));
  const target = `${kit.schoolClass.name}${section ? ` - ${section.name}` : ""}`;
  return withStock(branchId, async (tx, touch) => {
    for (const n of mergeLines(needs)) {
      await moveStock(tx, branchId, { itemId: n.itemId, type: "ISSUE", qty: -n.qty, recipientType: "CLASS", classId: kit.classId, kitId: kit.id, note: `${kit.name} → ${target}, ${count} students${input.note ? ` · ${input.note}` : ""}` });
      touch(n.itemId);
    }
    return tx.kitIssue.create({ data: { kitId: kit.id, sectionId: section?.id ?? null, studentCount: count, issuedById: getRequestContext()?.userId ?? null } });
  });
}

// ───────────── Budgets ─────────────

export async function saveBudget(branchId: string, input: { id?: string; academicYearId: string; classId?: string; departmentId?: string; amount: number }) {
  if (!!input.classId === !!input.departmentId) throw new AppError("Choose a class or a department.");
  if (input.amount <= 0) throw new AppError("Enter a budget amount greater than zero.");
  if (input.classId && !(await db.schoolClass.findFirst({ where: { id: input.classId, branchId } }))) throw new AppError("Choose a valid class.");
  if (input.departmentId && !(await db.department.findFirst({ where: { id: input.departmentId, branchId } }))) throw new AppError("Choose a valid department.");
  const data = { academicYearId: input.academicYearId, classId: input.classId ?? null, departmentId: input.departmentId ?? null, amount: round2(input.amount) };
  if (input.id) {
    const b = await db.stationeryBudget.findFirst({ where: { id: input.id, OR: [{ schoolClass: { branchId } }, { department: { branchId } }] } });
    if (!b) throw new AppError("Budget not found.");
    return db.stationeryBudget.update({ where: { id: input.id }, data });
  }
  const dup = await db.stationeryBudget.findFirst({ where: { academicYearId: data.academicYearId, classId: data.classId, departmentId: data.departmentId } });
  if (dup) throw new AppError("A budget for this class/department and year already exists. Edit it instead.");
  return db.stationeryBudget.create({ data });
}

export async function deleteBudget(branchId: string, id: string) {
  const b = await db.stationeryBudget.findFirst({ where: { id, OR: [{ schoolClass: { branchId } }, { department: { branchId } }] } });
  if (!b) throw new AppError("Budget not found.");
  return db.stationeryBudget.delete({ where: { id } });
}

/** Spend (issued qty × unit cost, less returns) per class and department within a date range. */
export async function spendBy(branchId: string, from: Date, to: Date) {
  const rows = await db.stockMovement.findMany({
    where: { item: { branchId }, type: { in: ["ISSUE", "RETURN"] }, createdAt: { gte: from, lte: to }, OR: [{ classId: { not: null } }, { departmentId: { not: null } }] },
    select: { qty: true, unitCost: true, classId: true, departmentId: true },
  });
  const byClass = new Map<string, number>();
  const byDept = new Map<string, number>();
  for (const r of rows) {
    const v = -r.qty * toNum(r.unitCost);
    if (r.classId) byClass.set(r.classId, (byClass.get(r.classId) ?? 0) + v);
    if (r.departmentId) byDept.set(r.departmentId, (byDept.get(r.departmentId) ?? 0) + v);
  }
  return { byClass, byDept };
}

/** Budgets for a year with spend, remaining and overspend flag. */
export async function budgetStatus(branchId: string, academicYearId: string) {
  const year = await db.academicYear.findUnique({ where: { id: academicYearId } });
  if (!year) return [];
  const budgets = await db.stationeryBudget.findMany({
    where: { academicYearId, OR: [{ schoolClass: { branchId } }, { department: { branchId } }] },
    include: { schoolClass: true, department: true },
  });
  const end = new Date(year.endDate.getTime() + 86400000 - 1);
  const { byClass, byDept } = await spendBy(branchId, year.startDate, end);
  return budgets
    .map((b) => {
      const limit = toNum(b.amount);
      const spent = round2(b.classId ? byClass.get(b.classId) ?? 0 : byDept.get(b.departmentId!) ?? 0);
      return { id: b.id, classId: b.classId, departmentId: b.departmentId, name: b.schoolClass?.name ?? b.department?.name ?? "—", kind: b.classId ? "Class" : "Department", grade: b.schoolClass?.grade ?? 999, limit, spent, remaining: round2(limit - spent), pct: limit > 0 ? Math.round((spent / limit) * 100) : 0, over: spent > limit };
    })
    .sort((a, b) => (a.kind === b.kind ? a.grade - b.grade || a.name.localeCompare(b.name) : a.kind === "Class" ? -1 : 1));
}

// ───────────── Stock audits ─────────────

export async function startAudit(branchId: string, input: { category?: string; notes?: string }) {
  const open = await db.stockAudit.findFirst({ where: { branchId, status: "IN_PROGRESS" } });
  if (open) throw new AppError(`Audit ${open.auditNo} is still in progress. Complete or cancel it first.`);
  const items = await db.stationeryItem.findMany({ where: { branchId, isActive: true, ...(input.category ? { category: input.category } : {}) }, orderBy: [{ category: "asc" }, { name: "asc" }] });
  if (!items.length) throw new AppError("There are no items to count.");
  return db.$transaction(async (tx) => tx.stockAudit.create({
    data: {
      branchId, auditNo: await docNumber("SA", tx), notes: [input.category ? `Category: ${input.category}` : null, input.notes].filter(Boolean).join(" · ") || null,
      startedById: getRequestContext()?.userId ?? null,
      lines: { create: items.map((i) => ({ itemId: i.id, systemQty: i.currentStock })) },
    },
  }));
}

export async function saveCounts(branchId: string, auditId: string, counts: { lineId: string; countedQty: number | null; note?: string }[]) {
  const audit = await db.stockAudit.findFirst({ where: { id: auditId, branchId }, include: { lines: true } });
  if (!audit) throw new AppError("Audit not found.");
  if (audit.status !== "IN_PROGRESS") throw new AppError("This audit is closed.");
  await db.$transaction(async (tx) => {
    for (const c of counts) {
      if (!audit.lines.some((l) => l.id === c.lineId)) continue;
      if (c.countedQty !== null && (!Number.isInteger(c.countedQty) || c.countedQty < 0)) throw new AppError("Counted quantities must be whole numbers, 0 or more.");
      await tx.stockAuditLine.update({ where: { id: c.lineId }, data: { countedQty: c.countedQty, note: c.note ?? null } });
    }
  });
  return { saved: counts.length };
}

/**
 * Complete an audit: for every counted line, post an AUDIT movement of (counted − system qty at start).
 * Using the difference keeps stock moves made during the count. Uncounted lines are left unchanged.
 */
export async function completeAudit(branchId: string, auditId: string) {
  const audit = await db.stockAudit.findFirst({ where: { id: auditId, branchId }, include: { lines: { include: { item: true } } } });
  if (!audit) throw new AppError("Audit not found.");
  if (audit.status !== "IN_PROGRESS") throw new AppError("This audit is already closed.");
  const counted = audit.lines.filter((l) => l.countedQty !== null);
  if (!counted.length) throw new AppError("Enter at least one counted quantity before completing.");
  const diffs = counted.filter((l) => l.countedQty! !== l.systemQty);
  return withStock(branchId, async (tx, touch) => {
    for (const l of diffs) {
      const delta = l.countedQty! - l.systemQty;
      await moveStock(tx, branchId, { itemId: l.itemId, type: "AUDIT", qty: delta, auditId: audit.id, note: `${audit.auditNo}: system ${l.systemQty}, counted ${l.countedQty}${l.note ? ` · ${l.note}` : ""}` });
      touch(l.itemId);
    }
    await tx.stockAudit.update({ where: { id: audit.id }, data: { status: "COMPLETED", completedAt: new Date(), completedById: getRequestContext()?.userId ?? null } });
    return { adjusted: diffs.length, counted: counted.length };
  });
}

export async function cancelAudit(branchId: string, auditId: string) {
  const audit = await db.stockAudit.findFirst({ where: { id: auditId, branchId } });
  if (!audit) throw new AppError("Audit not found.");
  if (audit.status !== "IN_PROGRESS") throw new AppError("This audit is already closed.");
  return db.stockAudit.update({ where: { id: auditId }, data: { status: "CANCELLED" } });
}

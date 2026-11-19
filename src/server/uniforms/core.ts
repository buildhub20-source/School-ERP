import "server-only";
import type { Gender, UniformMovementType, UniformGender } from "@prisma/client";
import { db, type DbOrTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { round2, toNum, today } from "@/lib/format";
import { getSetting } from "@/lib/settings";

/**
 * Move stock for a variant and log the movement. `qty` is signed (negative = out).
 * Outgoing moves are conditional on enough stock, so stock can never go negative.
 */
export async function moveStock(
  tx: DbOrTx,
  m: { variantId: string; qty: number; type: UniformMovementType; orderId?: string; poId?: string; note?: string; userId?: string },
) {
  if (!Number.isInteger(m.qty) || m.qty === 0) return;
  if (m.qty < 0) {
    const r = await tx.uniformVariant.updateMany({ where: { id: m.variantId, stock: { gte: -m.qty } }, data: { stock: { decrement: -m.qty } } });
    if (r.count === 0) {
      const v = await tx.uniformVariant.findUnique({ where: { id: m.variantId }, include: { item: true } });
      if (!v) throw new AppError("Size not found.");
      throw new AppError(`Not enough stock for ${v.item.name} size ${v.size}: ${v.stock} in stock, ${-m.qty} needed.`);
    }
  } else {
    await tx.uniformVariant.update({ where: { id: m.variantId }, data: { stock: { increment: m.qty } } });
  }
  const v = await tx.uniformVariant.findUniqueOrThrow({ where: { id: m.variantId }, select: { stock: true } });
  await tx.uniformMovement.create({
    data: { variantId: m.variantId, type: m.type, qty: m.qty, balanceAfter: v.stock, orderId: m.orderId, poId: m.poId, note: m.note, createdById: m.userId },
  });
  return v.stock;
}

export function studentUniformGender(g: Gender): UniformGender {
  return g === "MALE" ? "BOY" : g === "FEMALE" ? "GIRL" : "UNISEX";
}

/** Items a student of this gender can wear. */
export function gendersFor(g: Gender): UniformGender[] {
  const ug = studentUniformGender(g);
  return ug === "UNISEX" ? ["BOY", "GIRL", "UNISEX"] : [ug, "UNISEX"];
}

export async function currentYear(client: DbOrTx = db) {
  const y = await client.academicYear.findFirst({ where: { isCurrent: true } });
  if (!y) throw new AppError("No current academic year is set. Set one in Settings.");
  return y;
}

/** The academic year that parents can pre-order for (the latest year with the pre-order window open), or null. */
export async function preorderYear(client: DbOrTx = db) {
  return client.academicYear.findFirst({ where: { preorderOpen: true, closedAt: null }, orderBy: { startDate: "desc" } });
}

/** Pick the size `steps` positions up from the last ordered size order (clamped to the largest active size). */
export function stepSize<V extends { sizeOrder: number; isActive: boolean }>(variants: V[], lastSizeOrder: number, steps: number): V | undefined {
  const sorted = variants.filter((v) => v.isActive).sort((a, b) => a.sizeOrder - b.sizeOrder);
  if (!sorted.length) return undefined;
  let idx = sorted.findIndex((v) => v.sizeOrder >= lastSizeOrder);
  if (idx < 0) idx = sorted.length - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, idx + steps))];
}

export type SizeSuggestion = { itemId: string; itemName: string; variantId: string; size: string; lastSize: string; movedUp: boolean };

/**
 * Suggested sizes per item from the student's size profile. When the last order was before the target
 * academic year started, the size moves up by policies.sizeGrowthSteps.
 */
export async function suggestSizes(studentId: string, targetYearStart: Date, client: DbOrTx = db, steps?: number): Promise<Map<string, SizeSuggestion>> {
  const growth = steps ?? (await getSetting("policies")).sizeGrowthSteps;
  const profiles = await client.uniformSizeProfile.findMany({ where: { studentId }, include: { item: { include: { variants: true } } } });
  const out = new Map<string, SizeSuggestion>();
  for (const p of profiles) {
    if (!p.item.isActive) continue;
    const movedUp = p.orderedAt < targetYearStart;
    const v = stepSize(p.item.variants, p.sizeOrder, movedUp ? growth : 0);
    if (v) out.set(p.itemId, { itemId: p.itemId, itemName: p.item.name, variantId: v.id, size: v.size, lastSize: p.size, movedUp: movedUp && v.size !== p.size });
  }
  return out;
}

/** The uniform set for a class and gender: most specific match wins (class + gender, class + unisex, all classes + gender, all + unisex). */
export async function setForStudent(branchId: string, classId: string, gender: Gender, client: DbOrTx = db) {
  const ug = studentUniformGender(gender);
  const sets = await client.uniformSet.findMany({
    where: { branchId, OR: [{ classId }, { classId: null }], gender: { in: [ug, "UNISEX"] } },
    include: { items: { include: { item: { include: { variants: { where: { isActive: true }, orderBy: { sizeOrder: "asc" } } } } } } },
  });
  const score = (s: (typeof sets)[number]) => (s.classId ? 2 : 0) + (s.gender === ug ? 1 : 0);
  return sets.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Recompute the order total from its lines (net of returns), then the paid amount. */
export async function recalcOrderTotal(tx: DbOrTx, orderId: string) {
  const lines = await tx.uniformOrderLine.findMany({ where: { orderId } });
  const total = round2(lines.reduce((s, l) => s + (l.qty - l.qtyReturned) * toNum(l.unitPrice), 0));
  await tx.uniformOrder.update({ where: { id: orderId }, data: { total } });
  return syncOrderPayments(tx, orderId);
}

/**
 * paidAmount = successful uniform payments for the order minus refunds. An ORDERED order becomes PAID when fully paid;
 * a PAID order whose payment was reversed goes back to ORDERED.
 */
export async function syncOrderPayments(tx: DbOrTx, orderId: string) {
  const order = await tx.uniformOrder.findUniqueOrThrow({ where: { id: orderId } });
  const agg = await tx.payment.aggregate({ where: { uniformOrderId: orderId, purpose: "UNIFORM", status: "SUCCESS" }, _sum: { amount: true, refundedAmount: true } });
  const paid = round2(toNum(agg._sum.amount) - toNum(agg._sum.refundedAmount));
  const total = toNum(order.total);
  const fully = paid >= total - 0.009;
  let status = order.status;
  let paidAt = order.paidAt;
  if (order.status === "ORDERED" && fully) { status = "PAID"; paidAt = new Date(); }
  else if (order.status === "PAID" && !fully) { status = "ORDERED"; paidAt = null; }
  if (paid !== toNum(order.paidAmount) || status !== order.status) {
    return tx.uniformOrder.update({ where: { id: orderId }, data: { paidAmount: paid, status, paidAt } });
  }
  return order;
}

/** Save the delivered sizes of an order to the student's size profile (latest order wins). */
export async function updateSizeProfile(tx: DbOrTx, orderId: string) {
  const order = await tx.uniformOrder.findUniqueOrThrow({ where: { id: orderId }, include: { academicYear: true, lines: { include: { variant: true } } } });
  // A pre-order counts as ordered at the start of the year it is for.
  const orderedAt = new Date(Math.max(order.createdAt.getTime(), order.academicYear.startDate.getTime()));
  for (const l of order.lines) {
    if (l.qty - l.qtyReturned <= 0) continue;
    const existing = await tx.uniformSizeProfile.findUnique({ where: { studentId_itemId: { studentId: order.studentId, itemId: l.variant.itemId } } });
    if (existing && existing.orderedAt > orderedAt) continue;
    await tx.uniformSizeProfile.upsert({
      where: { studentId_itemId: { studentId: order.studentId, itemId: l.variant.itemId } },
      create: { studentId: order.studentId, itemId: l.variant.itemId, size: l.variant.size, sizeOrder: l.variant.sizeOrder, orderedAt },
      update: { size: l.variant.size, sizeOrder: l.variant.sizeOrder, orderedAt },
    });
  }
}

/** Target year start used for size suggestions: the pre-order year when pre-ordering, else the current year. */
export async function suggestionYearStart(isPreOrder: boolean) {
  const y = isPreOrder ? (await preorderYear()) ?? (await currentYear()) : await currentYear();
  return y.startDate ?? today();
}

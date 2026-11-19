import "server-only";
import type { MovementType, Prisma, RecipientType } from "@prisma/client";
import { db, type DbOrTx, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getRequestContext } from "@/lib/context";
import { currentAcademicYear } from "@/lib/settings";
import { nextCode, nextNumber } from "@/lib/counters";
import { toNum } from "@/lib/format";

/** Movement types that take stock out (qty is stored negative). */
export const OUT_TYPES: MovementType[] = ["ISSUE", "DAMAGE", "LOSS"];
export const IN_TYPES: MovementType[] = ["OPENING", "PURCHASE", "RETURN"];

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  OPENING: "Opening stock", PURCHASE: "Purchase", ISSUE: "Issue", RETURN: "Return", DAMAGE: "Damage", LOSS: "Loss", ADJUSTMENT: "Adjustment", AUDIT: "Audit adjustment",
};
export const RECIPIENT_LABELS: Record<RecipientType, string> = { STUDENT: "Student", TEACHER: "Teacher", CLASS: "Class", DEPARTMENT: "Department", OTHER: "Other" };

export const CATEGORIES = ["Notebook", "Pen", "Pencil", "Eraser", "Sharpener", "Ruler", "File", "Paper", "Art & Craft", "Office", "Other"];
export const UNITS = ["pcs", "box", "pack", "ream", "set", "sheet", "bottle", "roll", "dozen"];

export type MoveInput = {
  itemId: string;
  type: MovementType;
  /** Signed quantity: positive adds stock, negative removes it. */
  qty: number;
  unitCost?: number;
  recipientType?: RecipientType | null;
  studentId?: string | null;
  recipientUserId?: string | null;
  classId?: string | null;
  departmentId?: string | null;
  requestId?: string | null;
  poId?: string | null;
  kitId?: string | null;
  auditId?: string | null;
  note?: string | null;
};

/**
 * The only place stock changes. Locks the item row, refuses to go below zero,
 * updates currentStock and writes a StockMovement with the balance after, who and when.
 * Must run inside a transaction.
 */
export async function moveStock(tx: Tx, branchId: string, m: MoveInput) {
  if (!Number.isInteger(m.qty) || m.qty === 0) throw new AppError("Quantity must be a whole number other than zero.");
  await tx.$queryRaw`SELECT id FROM "StationeryItem" WHERE id = ${m.itemId} FOR UPDATE`;
  const item = await tx.stationeryItem.findFirst({ where: { id: m.itemId, branchId } });
  if (!item) throw new AppError("Item not found.");
  const balance = item.currentStock + m.qty;
  if (balance < 0) throw new AppError(`Not enough stock of ${item.name}: ${item.currentStock} ${item.unit} available, ${-m.qty} needed.`);
  await tx.stationeryItem.update({ where: { id: item.id }, data: { currentStock: balance } });
  const ctx = getRequestContext();
  return tx.stockMovement.create({
    data: {
      itemId: item.id, type: m.type, qty: m.qty, balanceAfter: balance, unitCost: m.unitCost ?? toNum(item.unitCost),
      recipientType: m.recipientType ?? null, studentId: m.studentId ?? null, recipientUserId: m.recipientUserId ?? null,
      classId: m.classId ?? null, departmentId: m.departmentId ?? null, requestId: m.requestId ?? null, poId: m.poId ?? null,
      kitId: m.kitId ?? null, auditId: m.auditId ?? null, note: m.note ?? null, createdById: ctx?.userId ?? null,
    },
  });
}

/** Run stock changes in a transaction, then run the low-stock check on every touched item. */
export async function withStock<T>(branchId: string, fn: (tx: Tx, touch: (itemId: string) => void) => Promise<T>): Promise<T> {
  const touched = new Set<string>();
  const result = await db.$transaction((tx) => fn(tx, (id) => touched.add(id)), { timeout: 30000 });
  if (touched.size) {
    const { checkLowStock } = await import("./automations");
    await checkLowStock(branchId, [...touched]);
  }
  return result;
}

/** Combine repeated item lines and validate quantities. */
export function mergeLines<T extends { itemId: string; qty: number }>(lines: T[]): { itemId: string; qty: number }[] {
  const map = new Map<string, number>();
  for (const l of lines) {
    if (!l.itemId) continue;
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new AppError("Every quantity must be a whole number greater than zero.");
    map.set(l.itemId, (map.get(l.itemId) ?? 0) + l.qty);
  }
  if (!map.size) throw new AppError("Add at least one item.");
  return [...map.entries()].map(([itemId, qty]) => ({ itemId, qty }));
}

/** Check that every line can be taken out of stock. Throws one message listing all shortages. */
export async function assertStock(client: DbOrTx, branchId: string, needs: { itemId: string; qty: number }[]) {
  const items = await client.stationeryItem.findMany({ where: { branchId, id: { in: needs.map((n) => n.itemId) } } });
  const short: string[] = [];
  for (const n of needs) {
    const it = items.find((i) => i.id === n.itemId);
    if (!it) throw new AppError("One of the items was not found.");
    if (it.currentStock < n.qty) short.push(`${it.name} (need ${n.qty}, have ${it.currentStock})`);
  }
  if (short.length) throw new AppError(`Not enough stock: ${short.join("; ")}. Nothing was issued.`);
  return items;
}

/** Academic-year scoped document number, e.g. SR/2026-27/00001. */
export async function docNumber(prefix: string, client: DbOrTx = db) {
  const year = await currentAcademicYear();
  return nextCode(prefix, year?.name ?? String(new Date().getFullYear()), 5, client);
}

/** Next free item code: STN-0001 … */
export async function nextItemCode(branchId: string, client: DbOrTx = db) {
  for (let i = 0; i < 50; i++) {
    const code = `STN-${String(await nextNumber(`STNITEM-${branchId}`, client)).padStart(4, "0")}`;
    if (!(await client.stationeryItem.findUnique({ where: { branchId_code: { branchId, code } } }))) return code;
  }
  throw new AppError("Could not generate an item code. Enter one manually.");
}

export type StockState = "OUT" | "LOW" | "OK";
export function stockState(i: { currentStock: number; reorderLevel: number }): StockState {
  if (i.currentStock <= 0) return "OUT";
  if (i.reorderLevel > 0 && i.currentStock <= i.reorderLevel) return "LOW";
  return "OK";
}

/** Ids of low-stock items (stock at or below a positive reorder level). Compared in code because Prisma cannot compare two columns. */
export async function lowStockIds(branchId: string, opts: { anyReorderLevel?: boolean } = {}): Promise<string[]> {
  const rows = await db.stationeryItem.findMany({ where: { branchId, isActive: true, ...(opts.anyReorderLevel ? {} : { reorderLevel: { gt: 0 } }) }, select: { id: true, currentStock: true, reorderLevel: true } });
  return rows.filter((r) => r.currentStock <= r.reorderLevel).map((r) => r.id);
}

/** Σ currentStock × unitCost of active items (optionally only items with stock on hand). */
export async function stockValue(branchId: string, opts: { positiveOnly?: boolean } = {}): Promise<number> {
  const rows = await db.stationeryItem.findMany({ where: { branchId, isActive: true, ...(opts.positiveOnly ? { currentStock: { gt: 0 } } : {}) }, select: { currentStock: true, unitCost: true } });
  return rows.reduce((s, r) => s + r.currentStock * Number(r.unitCost), 0);
}

export type ItemFilter = { q?: string; category?: string; supplierId?: string; stock?: string; inactive?: boolean };
export async function itemWhere(branchId: string, f: ItemFilter): Promise<Prisma.StationeryItemWhereInput> {
  const where: Prisma.StationeryItemWhereInput = { branchId, isActive: f.inactive ? false : true };
  if (f.q) where.OR = [{ name: { contains: f.q, mode: "insensitive" } }, { code: { contains: f.q, mode: "insensitive" } }];
  if (f.category) where.category = f.category;
  if (f.supplierId) where.preferredSupplierId = f.supplierId;
  if (f.stock === "out") where.currentStock = { lte: 0 };
  if (f.stock === "low") where.id = { in: await lowStockIds(branchId) };
  return where;
}

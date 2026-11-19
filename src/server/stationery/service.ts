import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getRequestContext } from "@/lib/context";
import { round2, toNum } from "@/lib/format";
import { docNumber, mergeLines, moveStock, nextItemCode, withStock } from "./core";

// ───────────── Items ─────────────

export type ItemInput = {
  code?: string; name: string; category: string; unit: string; reorderLevel: number; reorderQty: number;
  unitCost: number; preferredSupplierId?: string; isActive?: boolean;
};

async function checkSupplier(branchId: string, supplierId?: string) {
  if (!supplierId) return;
  if (!(await db.supplier.findFirst({ where: { id: supplierId, branchId } }))) throw new AppError("Choose a valid supplier.");
}

export async function createItem(branchId: string, input: ItemInput & { openingStock?: number }) {
  await checkSupplier(branchId, input.preferredSupplierId);
  const code = input.code?.trim().toUpperCase() || (await nextItemCode(branchId));
  if (await db.stationeryItem.findUnique({ where: { branchId_code: { branchId, code } } })) throw new AppError(`Item code ${code} is already used.`, "DUP", { code: "Already used" });
  return withStock(branchId, async (tx, touch) => {
    const item = await tx.stationeryItem.create({
      data: { branchId, code, name: input.name, category: input.category, unit: input.unit, reorderLevel: input.reorderLevel, reorderQty: input.reorderQty, unitCost: input.unitCost, preferredSupplierId: input.preferredSupplierId ?? null },
    });
    if (input.openingStock && input.openingStock > 0) {
      await moveStock(tx, branchId, { itemId: item.id, type: "OPENING", qty: input.openingStock, note: "Opening stock" });
      touch(item.id);
    } else touch(item.id);
    return item;
  });
}

export async function updateItem(branchId: string, id: string, input: ItemInput) {
  const existing = await db.stationeryItem.findFirst({ where: { id, branchId } });
  if (!existing) throw new AppError("Item not found.");
  await checkSupplier(branchId, input.preferredSupplierId);
  const code = input.code?.trim().toUpperCase() || existing.code;
  if (code !== existing.code && (await db.stationeryItem.findUnique({ where: { branchId_code: { branchId, code } } }))) throw new AppError(`Item code ${code} is already used.`, "DUP", { code: "Already used" });
  const item = await db.stationeryItem.update({
    where: { id },
    data: { code, name: input.name, category: input.category, unit: input.unit, reorderLevel: input.reorderLevel, reorderQty: input.reorderQty, unitCost: input.unitCost, preferredSupplierId: input.preferredSupplierId ?? null, isActive: input.isActive ?? existing.isActive },
  });
  const { checkLowStock } = await import("./automations");
  await checkLowStock(branchId, [id]);
  return item;
}

export async function setItemActive(branchId: string, id: string, isActive: boolean) {
  const item = await db.stationeryItem.findFirst({ where: { id, branchId } });
  if (!item) throw new AppError("Item not found.");
  return db.stationeryItem.update({ where: { id }, data: { isActive } });
}

// ───────────── Suppliers ─────────────

export type SupplierInput = { name: string; contactPerson?: string; phone?: string; email?: string; address?: string; gstin?: string; notes?: string; isActive?: boolean };

export async function saveSupplier(branchId: string, id: string | undefined, input: SupplierInput) {
  const data = { name: input.name, contactPerson: input.contactPerson ?? null, phone: input.phone ?? null, email: input.email ?? null, address: input.address ?? null, gstin: input.gstin ?? null, notes: input.notes ?? null };
  if (id) {
    const s = await db.supplier.findFirst({ where: { id, branchId } });
    if (!s) throw new AppError("Supplier not found.");
    return db.supplier.update({ where: { id }, data: { ...data, isActive: input.isActive ?? s.isActive, supplies: s.supplies.includes("STATIONERY") ? s.supplies : [...s.supplies, "STATIONERY"] } });
  }
  const dup = await db.supplier.findFirst({ where: { branchId, name: { equals: input.name, mode: "insensitive" } } });
  if (dup) {
    if (dup.supplies.includes("STATIONERY")) throw new AppError(`A supplier named ${input.name} already exists.`);
    return db.supplier.update({ where: { id: dup.id }, data: { ...data, supplies: [...dup.supplies, "STATIONERY"] } });
  }
  return db.supplier.create({ data: { branchId, ...data, supplies: ["STATIONERY"] } });
}

/** Record a supplier quote (price history). */
export async function addQuote(branchId: string, input: { supplierId: string; itemId: string; price: number; effectiveDate?: Date }) {
  const [s, i] = await Promise.all([db.supplier.findFirst({ where: { id: input.supplierId, branchId } }), db.stationeryItem.findFirst({ where: { id: input.itemId, branchId } })]);
  if (!s || !i) throw new AppError("Choose a valid supplier and item.");
  if (input.price <= 0) throw new AppError("Price must be greater than zero.");
  return db.supplierPrice.create({ data: { supplierId: s.id, stationeryItemId: i.id, price: input.price, source: "QUOTE", effectiveDate: input.effectiveDate ?? new Date() } });
}

/** Latest price per supplier for each item, for "compare prices across suppliers". */
export async function priceComparison(branchId: string, itemIds?: string[]) {
  const prices = await db.supplierPrice.findMany({
    where: { stationeryItemId: itemIds ? { in: itemIds } : { not: null }, supplier: { branchId } },
    include: { supplier: { select: { id: true, name: true } } },
    orderBy: { effectiveDate: "desc" },
  });
  const latest = new Map<string, Map<string, { price: number; date: Date; source: string }>>();
  for (const p of prices) {
    const m = latest.get(p.stationeryItemId!) ?? new Map();
    if (!m.has(p.supplierId)) m.set(p.supplierId, { price: toNum(p.price), date: p.effectiveDate, source: p.source });
    latest.set(p.stationeryItemId!, m);
  }
  const suppliers = new Map(prices.map((p) => [p.supplier.id, p.supplier.name]));
  return { latest, suppliers };
}

// ───────────── Purchase orders ─────────────

export type PoLineInput = { itemId: string; qty: number; unitPrice: number };

function cleanPoLines(lines: PoLineInput[]) {
  const seen = new Set<string>();
  const out: PoLineInput[] = [];
  for (const l of lines) {
    if (!l.itemId) continue;
    if (seen.has(l.itemId)) throw new AppError("The same item appears twice. Combine the lines.");
    seen.add(l.itemId);
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new AppError("Every quantity must be a whole number greater than zero.");
    if (!(l.unitPrice >= 0)) throw new AppError("Unit price cannot be negative.");
    out.push({ ...l, unitPrice: round2(l.unitPrice) });
  }
  if (!out.length) throw new AppError("Add at least one item.");
  return out;
}

async function checkPoRefs(branchId: string, supplierId: string, lines: PoLineInput[]) {
  const s = await db.supplier.findFirst({ where: { id: supplierId, branchId } });
  if (!s) throw new AppError("Choose a valid supplier.");
  const n = await db.stationeryItem.count({ where: { branchId, id: { in: lines.map((l) => l.itemId) } } });
  if (n !== lines.length) throw new AppError("One of the items was not found.");
}

export type PoInput = { supplierId: string; expectedDate?: Date; notes?: string; lines: PoLineInput[] };

export async function createPo(branchId: string, input: PoInput) {
  const lines = cleanPoLines(input.lines);
  await checkPoRefs(branchId, input.supplierId, lines);
  return db.$transaction(async (tx) => tx.purchaseOrder.create({
    data: {
      branchId, type: "STATIONERY", poNumber: await docNumber("PO", tx), supplierId: input.supplierId, expectedDate: input.expectedDate ?? null, notes: input.notes ?? null,
      createdById: getRequestContext()?.userId ?? null,
      lines: { create: lines.map((l) => ({ stationeryItemId: l.itemId, qtyOrdered: l.qty, unitPrice: l.unitPrice })) },
    },
  }));
}

async function getPo(branchId: string, id: string) {
  const po = await db.purchaseOrder.findFirst({ where: { id, branchId, type: "STATIONERY" }, include: { lines: { include: { stationeryItem: true } } } });
  if (!po) throw new AppError("Purchase order not found.");
  return po;
}

export async function updatePo(branchId: string, id: string, input: PoInput) {
  const po = await getPo(branchId, id);
  if (po.status !== "DRAFT") throw new AppError("Only draft purchase orders can be edited.");
  const lines = cleanPoLines(input.lines);
  await checkPoRefs(branchId, input.supplierId, lines);
  return db.$transaction(async (tx) => {
    await tx.purchaseOrderLine.deleteMany({ where: { poId: id } });
    return tx.purchaseOrder.update({
      where: { id },
      data: { supplierId: input.supplierId, expectedDate: input.expectedDate ?? null, notes: input.notes ?? null, lines: { create: lines.map((l) => ({ stationeryItemId: l.itemId, qtyOrdered: l.qty, unitPrice: l.unitPrice })) } },
    });
  });
}

export async function markPoOrdered(branchId: string, id: string) {
  const po = await getPo(branchId, id);
  if (po.status !== "DRAFT") throw new AppError("Only a draft can be marked as ordered.");
  if (!po.lines.length) throw new AppError("Add at least one item before ordering.");
  return db.purchaseOrder.update({ where: { id }, data: { status: "ORDERED", orderedAt: new Date() } });
}

export async function cancelPo(branchId: string, id: string, reason: string) {
  const po = await getPo(branchId, id);
  if (!["DRAFT", "ORDERED"].includes(po.status)) throw new AppError("Only draft or ordered purchase orders with nothing received can be cancelled.");
  if (po.lines.some((l) => l.qtyReceived > 0)) throw new AppError("Items have already been received on this order.");
  return db.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED", notes: [po.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n") } });
}

/** Close a partially received order: the rest will not arrive. */
export async function closePo(branchId: string, id: string, reason: string) {
  const po = await getPo(branchId, id);
  if (po.status !== "PARTIALLY_RECEIVED") throw new AppError("Only partially received orders can be closed.");
  return db.purchaseOrder.update({ where: { id }, data: { status: "RECEIVED", receivedAt: new Date(), notes: [po.notes, `Closed short: ${reason}`].filter(Boolean).join("\n") } });
}

/** Receive goods against an order: adds stock (PURCHASE movements), records the supplier price, updates the item cost. */
export async function receivePo(branchId: string, id: string, input: { invoiceNo?: string; lines: { lineId: string; qty: number }[] }) {
  const po = await getPo(branchId, id);
  if (!["ORDERED", "PARTIALLY_RECEIVED"].includes(po.status)) throw new AppError(po.status === "DRAFT" ? "Mark the order as ordered before receiving." : "This order is already closed.");
  const receive = input.lines.filter((l) => l.qty > 0);
  if (!receive.length) throw new AppError("Enter the quantity received for at least one item.");
  for (const r of receive) {
    const line = po.lines.find((l) => l.id === r.lineId);
    if (!line) throw new AppError("Unknown order line.");
    if (!Number.isInteger(r.qty)) throw new AppError("Quantities must be whole numbers.");
    if (r.qty > line.qtyOrdered - line.qtyReceived) throw new AppError(`${line.stationeryItem?.name}: only ${line.qtyOrdered - line.qtyReceived} still to receive.`);
  }
  return withStock(branchId, async (tx, touch) => {
    for (const r of receive) {
      const line = po.lines.find((l) => l.id === r.lineId)!;
      const price = toNum(line.unitPrice);
      await moveStock(tx, branchId, { itemId: line.stationeryItemId!, type: "PURCHASE", qty: r.qty, unitCost: price, poId: po.id, note: `${po.poNumber}${input.invoiceNo ? ` · Invoice ${input.invoiceNo}` : ""}` });
      await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { qtyReceived: { increment: r.qty } } });
      await tx.supplierPrice.create({ data: { supplierId: po.supplierId, stationeryItemId: line.stationeryItemId!, price, source: "PURCHASE" } });
      if (price > 0) await tx.stationeryItem.update({ where: { id: line.stationeryItemId! }, data: { unitCost: price } });
      touch(line.stationeryItemId!);
    }
    const lines = await tx.purchaseOrderLine.findMany({ where: { poId: po.id } });
    const done = lines.every((l) => l.qtyReceived >= l.qtyOrdered);
    return tx.purchaseOrder.update({
      where: { id: po.id },
      data: { status: done ? "RECEIVED" : "PARTIALLY_RECEIVED", receivedAt: done ? new Date() : null, invoiceNo: input.invoiceNo ?? po.invoiceNo },
    });
  });
}

/** "Record purchase": create an order and receive everything in one step. */
export async function quickPurchase(branchId: string, input: PoInput & { invoiceNo?: string }) {
  const po = await createPo(branchId, input);
  await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "ORDERED", orderedAt: new Date() } });
  const lines = await db.purchaseOrderLine.findMany({ where: { poId: po.id } });
  return receivePo(branchId, po.id, { invoiceNo: input.invoiceNo, lines: lines.map((l) => ({ lineId: l.id, qty: l.qtyOrdered })) });
}

export { mergeLines };

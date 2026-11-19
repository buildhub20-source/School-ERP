import "server-only";
import type { PaymentMode, PoStatus, UniformCategory, UniformGender } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { nextCode } from "@/lib/counters";
import { fullName, round2, toNum } from "@/lib/format";
import { recordPayment } from "@/server/fees/core";
import { onUniformPaymentSuccess } from "./payments";
import { currentYear, moveStock, preorderYear, recalcOrderTotal, syncOrderPayments, updateSizeProfile } from "./core";
import { notifyOrderReady } from "./automations";

const TX = { timeout: 20000, maxWait: 10000 };

// ───────────────────────── Items & sizes ─────────────────────────

export function parseSizes(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)) {
    // "28-40/2" or "1-10" range shorthand for numeric sizes
    const m = raw.match(/^(\d+)\s*-\s*(\d+)(?:\s*\/\s*(\d+))?$/);
    if (m) {
      const [a, b, step] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 1)];
      if (b < a || step < 1 || (b - a) / step > 60) throw new AppError(`Size range “${raw}” is not valid.`);
      for (let n = a; n <= b; n += step) out.push(String(n));
    } else out.push(raw);
  }
  const seen = new Set<string>();
  for (const x of out) {
    if (x.length > 20) throw new AppError(`Size “${x}” is too long.`);
    if (seen.has(x.toLowerCase())) throw new AppError(`Size “${x}” is listed twice.`);
    seen.add(x.toLowerCase());
  }
  return out;
}

export type NewItem = {
  name: string; category: UniformCategory; gender: UniformGender; description?: string;
  sizes: string; price: number; reorderLevel: number; openingStock: number;
};

export async function createItem(branchId: string, input: NewItem, userId?: string) {
  const sizes = parseSizes(input.sizes);
  if (!sizes.length) throw new AppError("Add at least one size (use “Free” for one-size items).");
  const dup = await db.uniformItem.findFirst({ where: { branchId, name: { equals: input.name, mode: "insensitive" }, gender: input.gender } });
  if (dup) throw new AppError(`An item called “${input.name}” already exists for ${input.gender.toLowerCase()}.`);
  return db.$transaction(async (tx) => {
    const item = await tx.uniformItem.create({ data: { branchId, name: input.name, category: input.category, gender: input.gender, description: input.description } });
    for (const [i, size] of sizes.entries()) {
      const v = await tx.uniformVariant.create({ data: { itemId: item.id, size, sizeOrder: (i + 1) * 10, price: input.price, reorderLevel: input.reorderLevel } });
      if (input.openingStock > 0) await moveStock(tx, { variantId: v.id, qty: input.openingStock, type: "OPENING", userId });
    }
    return item;
  }, TX);
}

export async function updateItem(branchId: string, input: { id: string; name: string; category: UniformCategory; gender: UniformGender; description?: string; isActive: boolean }) {
  const item = await db.uniformItem.findFirst({ where: { id: input.id, branchId } });
  if (!item) throw new AppError("Item not found.");
  const dup = await db.uniformItem.findFirst({ where: { branchId, id: { not: item.id }, name: { equals: input.name, mode: "insensitive" }, gender: input.gender } });
  if (dup) throw new AppError(`Another item called “${input.name}” already exists for ${input.gender.toLowerCase()}.`);
  return db.uniformItem.update({ where: { id: item.id }, data: { name: input.name, category: input.category, gender: input.gender, description: input.description ?? null, isActive: input.isActive } });
}

async function variantInBranch(branchId: string, variantId: string) {
  const v = await db.uniformVariant.findFirst({ where: { id: variantId, item: { branchId } }, include: { item: true } });
  if (!v) throw new AppError("Size not found.");
  return v;
}

export async function addVariant(branchId: string, input: { itemId: string; size: string; sizeOrder?: number; price: number; reorderLevel: number; openingStock: number; sku?: string }, userId?: string) {
  const item = await db.uniformItem.findFirst({ where: { id: input.itemId, branchId }, include: { variants: true } });
  if (!item) throw new AppError("Item not found.");
  if (item.variants.some((v) => v.size.toLowerCase() === input.size.toLowerCase())) throw new AppError(`Size ${input.size} already exists for ${item.name}.`);
  const sizeOrder = input.sizeOrder ?? (Math.max(0, ...item.variants.map((v) => v.sizeOrder)) + 10);
  return db.$transaction(async (tx) => {
    const v = await tx.uniformVariant.create({ data: { itemId: item.id, size: input.size, sizeOrder, price: input.price, reorderLevel: input.reorderLevel, sku: input.sku } });
    if (input.openingStock > 0) await moveStock(tx, { variantId: v.id, qty: input.openingStock, type: "OPENING", userId });
    return v;
  }, TX);
}

export async function updateVariant(branchId: string, input: { id: string; size: string; sizeOrder: number; price: number; reorderLevel: number; sku?: string; isActive: boolean }) {
  const v = await variantInBranch(branchId, input.id);
  if (input.size !== v.size) {
    const used = await db.uniformOrderLine.count({ where: { variantId: v.id } });
    if (used) throw new AppError("This size is used in orders, so its name cannot be changed. Add a new size instead.");
    const clash = await db.uniformVariant.findFirst({ where: { itemId: v.itemId, id: { not: v.id }, size: { equals: input.size, mode: "insensitive" } } });
    if (clash) throw new AppError(`Size ${input.size} already exists for ${v.item.name}.`);
  }
  return db.uniformVariant.update({ where: { id: v.id }, data: { size: input.size, sizeOrder: input.sizeOrder, price: input.price, reorderLevel: input.reorderLevel, sku: input.sku ?? null, isActive: input.isActive } });
}

/** Manual stock correction: ADJUSTMENT (+/-) or DAMAGE (removes stock). */
export async function adjustStock(branchId: string, input: { variantId: string; qty: number; type: "ADJUSTMENT" | "DAMAGE"; note: string }, userId?: string) {
  const v = await variantInBranch(branchId, input.variantId);
  if (input.qty === 0) throw new AppError("Enter a quantity other than zero.");
  const qty = input.type === "DAMAGE" ? -Math.abs(input.qty) : input.qty;
  return db.$transaction((tx) => moveStock(tx, { variantId: v.id, qty, type: input.type, note: input.note, userId }), TX);
}

// ───────────────────────── Uniform sets ─────────────────────────

export async function saveSet(branchId: string, input: { id?: string; name: string; classId?: string; gender: UniformGender; items: { itemId: string; qty: number }[] }) {
  if (!input.items.length) throw new AppError("Add at least one item to the set.");
  const ids = [...new Set(input.items.map((i) => i.itemId))];
  if (ids.length !== input.items.length) throw new AppError("An item is listed twice in the set.");
  const found = await db.uniformItem.count({ where: { id: { in: ids }, branchId } });
  if (found !== ids.length) throw new AppError("An item in the set was not found.");
  if (input.classId && !(await db.schoolClass.findFirst({ where: { id: input.classId, branchId } }))) throw new AppError("Class not found.");
  const dup = await db.uniformSet.findFirst({ where: { branchId, classId: input.classId ?? null, gender: input.gender, ...(input.id ? { id: { not: input.id } } : {}) } });
  if (dup) throw new AppError(`A set for this class and gender already exists (“${dup.name}”). Edit that set instead.`);
  return db.$transaction(async (tx) => {
    if (input.id) {
      const s = await tx.uniformSet.findFirst({ where: { id: input.id, branchId } });
      if (!s) throw new AppError("Set not found.");
      await tx.uniformSetItem.deleteMany({ where: { setId: s.id } });
      return tx.uniformSet.update({ where: { id: s.id }, data: { name: input.name, classId: input.classId ?? null, gender: input.gender, items: { create: input.items } } });
    }
    return tx.uniformSet.create({ data: { branchId, name: input.name, classId: input.classId ?? null, gender: input.gender, items: { create: input.items } } });
  }, TX);
}

export async function deleteSet(branchId: string, id: string) {
  const s = await db.uniformSet.findFirst({ where: { id, branchId } });
  if (!s) throw new AppError("Set not found.");
  await db.uniformSet.delete({ where: { id: s.id } });
}

// ───────────────────────── Orders ─────────────────────────

export type NewOrder = {
  studentId: string;
  lines: { variantId: string; qty: number }[];
  isPreOrder?: boolean;
  placedVia?: "COUNTER" | "PARENT";
  notes?: string;
};

export async function createOrder(branchId: string, input: NewOrder, userId?: string) {
  const student = await db.student.findFirst({ where: { id: input.studentId, branchId } });
  if (!student) throw new AppError("Student not found.");
  if (student.status !== "ACTIVE") throw new AppError(`${fullName(student)} is not an active student.`);
  const merged = new Map<string, number>();
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > 50) throw new AppError("Quantity must be between 1 and 50.");
    merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.qty);
  }
  if (!merged.size) throw new AppError("Add at least one item to the order.");
  const variants = await db.uniformVariant.findMany({ where: { id: { in: [...merged.keys()] }, item: { branchId } }, include: { item: true } });
  if (variants.length !== merged.size) throw new AppError("A selected size was not found.");
  for (const v of variants) if (!v.isActive || !v.item.isActive) throw new AppError(`${v.item.name} size ${v.size} is no longer available.`);

  const year = input.isPreOrder ? await preorderYear() : await currentYear();
  if (!year) throw new AppError("Pre-orders are not open right now.");
  const total = round2(variants.reduce((s, v) => s + toNum(v.price) * merged.get(v.id)!, 0));

  return db.$transaction(async (tx) => {
    const orderNo = await nextCode("UNI", year.name, 5, tx);
    const order = await tx.uniformOrder.create({
      data: {
        branchId, orderNo, studentId: student.id, academicYearId: year.id, isPreOrder: !!input.isPreOrder,
        placedVia: input.placedVia ?? "COUNTER", placedById: userId, total, notes: input.notes,
        lines: { create: variants.map((v) => ({ variantId: v.id, qty: merged.get(v.id)!, unitPrice: v.price })) },
      },
    });
    if (total === 0) await tx.uniformOrder.update({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date() } });
    return order;
  }, TX);
}

async function orderInBranch(branchId: string, id: string) {
  const o = await db.uniformOrder.findFirst({ where: { id, branchId } });
  if (!o) throw new AppError("Order not found.");
  return o;
}

/** Counter payment for a uniform order (goes through the fees module so it gets a receipt and appears in the cash book). */
export async function recordOrderPayment(branchId: string, input: { orderId: string; amount: number; mode: PaymentMode; reference?: string; notes?: string }, userId?: string) {
  if (!(input.amount > 0)) throw new AppError("Amount must be more than zero.");
  const order = await orderInBranch(branchId, input.orderId);
  if (order.status === "CANCELLED") throw new AppError("This order is cancelled.");
  const balance = round2(toNum(order.total) - toNum(order.paidAmount));
  if (balance <= 0) throw new AppError("This order is already fully paid.");
  if (input.amount > balance + 0.009) throw new AppError(`The amount is more than the balance of ₹${balance.toLocaleString("en-IN")}.`);
  if (input.mode !== "CASH" && !input.reference) throw new AppError("Enter the reference (UTR / card slip / cheque number) for non-cash payments.");
  return db.$transaction(async (tx) => {
    const payment = await recordPayment(tx, {
      branchId, studentId: order.studentId, amount: input.amount, mode: input.mode, purpose: "UNIFORM", uniformOrderId: order.id,
      reference: input.reference, notes: input.notes ?? `Uniform order ${order.orderNo}`, collectedById: userId, source: "COUNTER",
    });
    await onUniformPaymentSuccess(tx, payment.id);
    return payment;
  }, TX);
}

/** Paid → Ready: deducts stock for every line (all or nothing). The parent is notified to collect it. */
export async function markReady(branchId: string, orderId: string, userId?: string) {
  const order = await orderInBranch(branchId, orderId);
  if (order.status === "ORDERED") throw new AppError("Collect the payment before marking the order ready.");
  if (order.status !== "PAID") throw new AppError(`The order is already ${order.status.toLowerCase()}.`);
  await db.$transaction(async (tx) => {
    const r = await tx.uniformOrder.updateMany({ where: { id: order.id, status: "PAID" }, data: { status: "READY", readyAt: new Date() } });
    if (r.count === 0) throw new AppError("The order was updated by someone else. Refresh and try again.");
    const lines = await tx.uniformOrderLine.findMany({ where: { orderId: order.id } });
    for (const l of lines) {
      const qty = l.qty - l.qtyReturned;
      if (qty > 0) await moveStock(tx, { variantId: l.variantId, qty: -qty, type: "ORDER_OUT", orderId: order.id, note: order.orderNo, userId });
    }
  }, TX);
  await notifyOrderReady(order.id).catch((e) => console.error("[uniforms.ready] notify failed", e));
  return db.uniformOrder.findUniqueOrThrow({ where: { id: order.id } });
}

/** Ready → Delivered: saves sizes to the student's size profile. */
export async function markDelivered(branchId: string, orderId: string) {
  const order = await orderInBranch(branchId, orderId);
  if (order.status !== "READY") throw new AppError(order.status === "DELIVERED" ? "The order is already delivered." : "Only a ready order can be delivered.");
  return db.$transaction(async (tx) => {
    const r = await tx.uniformOrder.updateMany({ where: { id: order.id, status: "READY" }, data: { status: "DELIVERED", deliveredAt: new Date() } });
    if (r.count === 0) throw new AppError("The order was updated by someone else. Refresh and try again.");
    await updateSizeProfile(tx, order.id);
    return tx.uniformOrder.findUniqueOrThrow({ where: { id: order.id } });
  }, TX);
}

/** Cancel an open order. Stock already set aside (Ready) goes back. Money paid is refunded through Fees → Refunds. */
export async function cancelOrder(branchId: string, orderId: string, reason: string, userId?: string) {
  const order = await orderInBranch(branchId, orderId);
  if (!["ORDERED", "PAID", "READY"].includes(order.status)) throw new AppError(order.status === "DELIVERED" ? "A delivered order cannot be cancelled. Record a return instead." : "The order is already cancelled.");
  return db.$transaction(async (tx) => {
    const r = await tx.uniformOrder.updateMany({ where: { id: order.id, status: order.status }, data: { status: "CANCELLED", cancelledAt: new Date(), notes: [order.notes, `Cancelled: ${reason}`].filter(Boolean).join("\n") } });
    if (r.count === 0) throw new AppError("The order was updated by someone else. Refresh and try again.");
    if (order.status === "READY") {
      const lines = await tx.uniformOrderLine.findMany({ where: { orderId: order.id } });
      for (const l of lines) {
        const qty = l.qty - l.qtyReturned;
        if (qty > 0) await moveStock(tx, { variantId: l.variantId, qty, type: "RETURN_IN", orderId: order.id, note: `Cancelled ${order.orderNo}`, userId });
      }
    }
    return { refundDue: toNum(order.paidAmount) };
  }, TX);
}

async function lineForChange(branchId: string, orderId: string, lineId: string, qty: number, allowed: string[], what: string) {
  const order = await orderInBranch(branchId, orderId);
  if (!allowed.includes(order.status)) throw new AppError(`${what} is only possible for ${allowed.map((s) => s.toLowerCase()).join(" or ")} orders.`);
  const line = await db.uniformOrderLine.findFirst({ where: { id: lineId, orderId }, include: { variant: { include: { item: true } } } });
  if (!line) throw new AppError("Order line not found.");
  const open = line.qty - line.qtyReturned;
  if (!Number.isInteger(qty) || qty < 1) throw new AppError("Quantity must be at least 1.");
  if (qty > open) throw new AppError(`Only ${open} of ${line.variant.item.name} size ${line.variant.size} can be ${what === "Exchange" ? "exchanged" : "returned"}.`);
  return { order, line };
}

/**
 * Swap a wrong size: the old size comes back into stock, the new size goes out (needs stock).
 * The order total changes by the price difference; extra due is collected as a normal payment, excess is refunded via Fees.
 */
export async function exchangeItem(branchId: string, input: { orderId: string; lineId: string; toVariantId: string; qty: number; reason?: string }, userId?: string) {
  const { order, line } = await lineForChange(branchId, input.orderId, input.lineId, input.qty, ["READY", "DELIVERED"], "Exchange");
  const to = await db.uniformVariant.findFirst({ where: { id: input.toVariantId, itemId: line.variant.itemId } });
  if (!to) throw new AppError("Choose another size of the same item.");
  if (to.id === line.variantId) throw new AppError("Choose a different size.");
  if (!to.isActive) throw new AppError(`Size ${to.size} is no longer available.`);
  const priceDiff = round2((toNum(to.price) - toNum(line.unitPrice)) * input.qty);
  return db.$transaction(async (tx) => {
    const note = `Exchange ${order.orderNo}: ${line.variant.size} → ${to.size}`;
    await moveStock(tx, { variantId: line.variantId, qty: input.qty, type: "EXCHANGE_IN", orderId: order.id, note, userId });
    await moveStock(tx, { variantId: to.id, qty: -input.qty, type: "EXCHANGE_OUT", orderId: order.id, note, userId });
    if (line.qty - input.qty === 0 && line.qtyReturned === 0) await tx.uniformOrderLine.delete({ where: { id: line.id } });
    else await tx.uniformOrderLine.update({ where: { id: line.id }, data: { qty: { decrement: input.qty } } });
    const same = await tx.uniformOrderLine.findFirst({ where: { orderId: order.id, variantId: to.id, unitPrice: to.price } });
    if (same) await tx.uniformOrderLine.update({ where: { id: same.id }, data: { qty: { increment: input.qty } } });
    else await tx.uniformOrderLine.create({ data: { orderId: order.id, variantId: to.id, qty: input.qty, unitPrice: to.price } });
    const ex = await tx.uniformExchange.create({ data: { orderId: order.id, type: "EXCHANGE", fromVariantId: line.variantId, toVariantId: to.id, qty: input.qty, priceDiff, reason: input.reason, createdById: userId } });
    await recalcOrderTotal(tx, order.id);
    if (order.status === "DELIVERED") await updateSizeProfile(tx, order.id);
    return { exchange: ex, priceDiff };
  }, TX);
}

/** Return delivered items: stock comes back, order total goes down (refund of any excess is raised in Fees → Refunds). */
export async function returnItem(branchId: string, input: { orderId: string; lineId: string; qty: number; reason: string }, userId?: string) {
  const { order, line } = await lineForChange(branchId, input.orderId, input.lineId, input.qty, ["DELIVERED"], "Return");
  const credit = round2(toNum(line.unitPrice) * input.qty);
  return db.$transaction(async (tx) => {
    await tx.uniformOrderLine.update({ where: { id: line.id }, data: { qtyReturned: { increment: input.qty } } });
    await moveStock(tx, { variantId: line.variantId, qty: input.qty, type: "RETURN_IN", orderId: order.id, note: `Return ${order.orderNo}: ${input.reason}`, userId });
    const ex = await tx.uniformExchange.create({ data: { orderId: order.id, type: "RETURN", fromVariantId: line.variantId, qty: input.qty, priceDiff: -credit, reason: input.reason, createdById: userId } });
    const updated = await recalcOrderTotal(tx, order.id);
    return { exchange: ex, refundDue: Math.max(0, round2(toNum(updated.paidAmount) - toNum(updated.total))) };
  }, TX);
}

// ───────────────────────── Purchases ─────────────────────────

export async function createSupplier(branchId: string, input: { name: string; contactPerson?: string; phone?: string; email?: string; gstin?: string; address?: string }) {
  const dup = await db.supplier.findFirst({ where: { branchId, name: { equals: input.name, mode: "insensitive" } } });
  if (dup) {
    if (!dup.supplies.includes("UNIFORM")) return db.supplier.update({ where: { id: dup.id }, data: { supplies: [...dup.supplies, "UNIFORM"] } });
    throw new AppError(`A supplier called “${input.name}” already exists.`);
  }
  return db.supplier.create({ data: { branchId, ...input, supplies: ["UNIFORM"] } });
}

export type NewPurchase = {
  supplierId: string;
  lines: { variantId: string; qty: number; unitPrice: number }[];
  status: "DRAFT" | "ORDERED" | "RECEIVED";
  expectedDate?: Date;
  invoiceNo?: string;
  notes?: string;
  isAutoDraft?: boolean;
};

/** Create a uniform purchase order. status RECEIVED = quick purchase: stock is added immediately. */
export async function createPurchase(branchId: string, input: NewPurchase, userId?: string) {
  const supplier = await db.supplier.findFirst({ where: { id: input.supplierId, branchId, isActive: true } });
  if (!supplier) throw new AppError("Supplier not found.");
  const merged = new Map<string, { qty: number; unitPrice: number }>();
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new AppError("Quantity must be at least 1.");
    if (merged.has(l.variantId)) throw new AppError("A size is listed twice.");
    merged.set(l.variantId, { qty: l.qty, unitPrice: round2(l.unitPrice) });
  }
  if (!merged.size) throw new AppError("Add at least one item.");
  const found = await db.uniformVariant.count({ where: { id: { in: [...merged.keys()] }, item: { branchId } } });
  if (found !== merged.size) throw new AppError("A selected size was not found.");
  const year = await currentYear();
  const po = await db.$transaction(async (tx) => {
    if (!supplier.supplies.includes("UNIFORM")) await tx.supplier.update({ where: { id: supplier.id }, data: { supplies: [...supplier.supplies, "UNIFORM"] } });
    const poNumber = await nextCode("UPO", year.name, 5, tx);
    return tx.purchaseOrder.create({
      data: {
        branchId, poNumber, type: "UNIFORM", supplierId: supplier.id, status: input.status === "RECEIVED" ? "ORDERED" : input.status,
        isAutoDraft: !!input.isAutoDraft, invoiceNo: input.invoiceNo, notes: input.notes, expectedDate: input.expectedDate,
        orderedAt: input.status === "DRAFT" ? null : new Date(), createdById: userId,
        lines: { create: [...merged].map(([variantId, l]) => ({ uniformVariantId: variantId, qtyOrdered: l.qty, unitPrice: l.unitPrice })) },
      },
      include: { lines: true },
    });
  }, TX);
  if (input.status === "RECEIVED") await receivePurchase(branchId, { poId: po.id, invoiceNo: input.invoiceNo, lines: po.lines.map((l) => ({ lineId: l.id, qty: l.qtyOrdered })) }, userId);
  return po;
}

export async function markPurchaseOrdered(branchId: string, poId: string) {
  const r = await db.purchaseOrder.updateMany({ where: { id: poId, branchId, type: "UNIFORM", status: "DRAFT" }, data: { status: "ORDERED", orderedAt: new Date() } });
  if (r.count === 0) throw new AppError("Only a draft purchase order can be placed.");
}

export async function cancelPurchase(branchId: string, poId: string) {
  const po = await db.purchaseOrder.findFirst({ where: { id: poId, branchId, type: "UNIFORM" }, include: { lines: true } });
  if (!po) throw new AppError("Purchase order not found.");
  if (!["DRAFT", "ORDERED"].includes(po.status) || po.lines.some((l) => l.qtyReceived > 0)) throw new AppError("Only a draft or ordered purchase with nothing received can be cancelled.");
  await db.purchaseOrder.update({ where: { id: po.id }, data: { status: "CANCELLED" } });
}

/** Receive goods: adds stock (PURCHASE movement) and records the supplier's price. */
export async function receivePurchase(branchId: string, input: { poId: string; invoiceNo?: string; lines: { lineId: string; qty: number }[] }, userId?: string) {
  const po = await db.purchaseOrder.findFirst({ where: { id: input.poId, branchId, type: "UNIFORM" }, include: { lines: true } });
  if (!po) throw new AppError("Purchase order not found.");
  if (!["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"].includes(po.status)) throw new AppError(`This purchase order is ${po.status.toLowerCase().replace("_", " ")}.`);
  const receipts = input.lines.filter((l) => l.qty > 0);
  if (!receipts.length) throw new AppError("Enter the quantity received for at least one item.");
  return db.$transaction(async (tx) => {
    for (const r of receipts) {
      const line = po.lines.find((l) => l.id === r.lineId);
      if (!line || !line.uniformVariantId) throw new AppError("Purchase line not found.");
      if (!Number.isInteger(r.qty)) throw new AppError("Quantities must be whole numbers.");
      const left = line.qtyOrdered - line.qtyReceived;
      if (r.qty > left) throw new AppError(`Only ${left} more can be received on one of the lines.`);
      await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { qtyReceived: { increment: r.qty } } });
      await moveStock(tx, { variantId: line.uniformVariantId, qty: r.qty, type: "PURCHASE", poId: po.id, note: po.poNumber, userId });
      await tx.supplierPrice.create({ data: { supplierId: po.supplierId, uniformVariantId: line.uniformVariantId, price: line.unitPrice, source: "PURCHASE" } });
    }
    const lines = await tx.purchaseOrderLine.findMany({ where: { poId: po.id } });
    const done = lines.every((l) => l.qtyReceived >= l.qtyOrdered);
    const status: PoStatus = done ? "RECEIVED" : "PARTIALLY_RECEIVED";
    return tx.purchaseOrder.update({ where: { id: po.id }, data: { status, receivedAt: done ? new Date() : null, invoiceNo: input.invoiceNo ?? po.invoiceNo, orderedAt: po.orderedAt ?? new Date() } });
  }, TX);
}

// ───────────────────────── Pre-order window ─────────────────────────

export async function setPreorderWindow(yearId: string, open: boolean) {
  const y = await db.academicYear.findUnique({ where: { id: yearId } });
  if (!y) throw new AppError("Academic year not found.");
  if (open && y.closedAt) throw new AppError("This academic year is closed.");
  return db.academicYear.update({ where: { id: y.id }, data: { preorderOpen: open, ...(open && !y.preorderOpen ? { preorderOpensAt: new Date() } : {}) } });
}

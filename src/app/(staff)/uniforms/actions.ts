"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { CATEGORIES, UNIFORM_GENDERS, PAYMENT_MODES } from "@/server/uniforms/labels";
import {
  addVariant, adjustStock, cancelOrder, cancelPurchase, createItem, createOrder, createPurchase, createSupplier, deleteSet, exchangeItem,
  markDelivered, markPurchaseOrdered, markReady, receivePurchase, recordOrderPayment, returnItem, saveSet, setPreorderWindow, updateItem, updateVariant,
} from "@/server/uniforms/service";
import { notifyPreorderSizes } from "@/server/uniforms/automations";
import { importUniforms } from "@/server/uniforms/import";

const R = "/uniforms";
const category = z.enum(CATEGORIES);
const gender = z.enum(UNIFORM_GENDERS);

export const saveItemAction = defineAction({
  perm: "uniforms.manage", revalidate: R,
  schema: z.object({ id: zs.optStr(40), name: zs.str(120), category, gender, description: zs.optStr(500), isActive: zs.bool(), sizes: zs.optStr(1000), price: zs.optMoney(), reorderLevel: zs.optInt(), openingStock: zs.optInt() }),
}, async (i, { branchId, user }) => {
  if (i.id) return updateItem(branchId, { id: i.id, name: i.name, category: i.category, gender: i.gender, description: i.description, isActive: i.isActive });
  if (!i.sizes) throw new AppError("Enter the sizes, e.g. 28-40/2 or S, M, L or Free.");
  if (i.price === undefined) throw new AppError("Enter the price.");
  return createItem(branchId, { name: i.name, category: i.category, gender: i.gender, description: i.description, sizes: i.sizes, price: i.price, reorderLevel: Math.max(0, i.reorderLevel ?? 0), openingStock: Math.max(0, i.openingStock ?? 0) }, user.id);
});

export const saveVariantAction = defineAction({
  perm: "uniforms.manage", revalidate: R,
  schema: z.object({ id: zs.optStr(40), itemId: zs.optStr(40), size: zs.str(20), sizeOrder: zs.optInt(), price: zs.money(), reorderLevel: zs.int(0), openingStock: zs.optInt(), sku: zs.optStr(60), isActive: zs.bool() }),
}, async (i, { branchId, user }) => {
  if (i.id) return updateVariant(branchId, { id: i.id, size: i.size, sizeOrder: i.sizeOrder ?? 0, price: i.price, reorderLevel: i.reorderLevel, sku: i.sku, isActive: i.isActive });
  if (!i.itemId) throw new AppError("Item is missing.");
  return addVariant(branchId, { itemId: i.itemId, size: i.size, sizeOrder: i.sizeOrder, price: i.price, reorderLevel: i.reorderLevel, openingStock: Math.max(0, i.openingStock ?? 0), sku: i.sku }, user.id);
});

export const adjustStockAction = defineAction({
  perm: "uniforms.manage", revalidate: R,
  schema: z.object({ variantId: zs.id, type: z.enum(["ADJUSTMENT", "DAMAGE"]), qty: z.coerce.number().int().min(-100000).max(100000), note: zs.str(300) }),
}, async (i, { branchId, user }) => adjustStock(branchId, i, user.id));

export const saveSetAction = defineAction({
  perm: "uniforms.manage", revalidate: R,
  schema: z.object({ id: zs.optStr(40), name: zs.str(120), classId: zs.optStr(40), gender, items: zs.json(z.array(z.object({ itemId: zs.id, qty: z.coerce.number().int().min(1).max(10) }))) }),
}, async (i, { branchId }) => saveSet(branchId, i));

export const deleteSetAction = defineAction({ perm: "uniforms.manage", revalidate: R, schema: z.object({ id: zs.id }) }, async ({ id }, { branchId }) => deleteSet(branchId, id));

const lines = z.array(z.object({ variantId: zs.id, qty: z.coerce.number().int().min(1).max(50) })).min(1, "Add at least one item");

export const createOrderAction = defineAction({
  perm: "uniforms.orders", revalidate: R,
  schema: z.object({ studentId: zs.id, lines: zs.json(lines), isPreOrder: zs.bool(), notes: zs.optStr(500) }),
}, async (i, { branchId, user }) => {
  const o = await createOrder(branchId, { ...i, placedVia: "COUNTER" }, user.id);
  return { id: o.id, orderNo: o.orderNo };
});

export const orderPaymentAction = defineAction({
  perm: "uniforms.orders", revalidate: R,
  schema: z.object({ orderId: zs.id, amount: zs.money(), mode: z.enum(PAYMENT_MODES), reference: zs.optStr(100), notes: zs.optStr(300) }),
}, async (i, { branchId, user }) => {
  const p = await recordOrderPayment(branchId, i, user.id);
  return { receiptNo: p.receiptNo };
});

export const orderStatusAction = defineAction({
  perm: "uniforms.orders", revalidate: R,
  schema: z.object({ orderId: zs.id, to: z.enum(["READY", "DELIVERED", "CANCELLED"]), reason: zs.optStr(300) }),
}, async ({ orderId, to, reason }, { branchId, user }) => {
  if (to === "READY") return markReady(branchId, orderId, user.id);
  if (to === "DELIVERED") return markDelivered(branchId, orderId);
  if (!reason) throw new AppError("Enter the reason for cancelling.");
  return cancelOrder(branchId, orderId, reason, user.id);
});

export const exchangeAction = defineAction({
  perm: "uniforms.orders", revalidate: R,
  schema: z.object({ orderId: zs.id, lineId: zs.id, toVariantId: zs.id, qty: zs.int(1), reason: zs.optStr(300) }),
}, async (i, { branchId, user }) => exchangeItem(branchId, i, user.id));

export const returnAction = defineAction({
  perm: "uniforms.orders", revalidate: R,
  schema: z.object({ orderId: zs.id, lineId: zs.id, qty: zs.int(1), reason: zs.str(300) }),
}, async (i, { branchId, user }) => returnItem(branchId, i, user.id));

export const supplierAction = defineAction({
  perm: "uniforms.manage", revalidate: R,
  schema: z.object({ name: zs.str(120), contactPerson: zs.optStr(120), phone: zs.optPhone(), email: zs.optEmail(), gstin: zs.optStr(20), address: zs.optStr(300) }),
}, async (i, { branchId }) => {
  const s = await createSupplier(branchId, i);
  return { id: s.id, name: s.name };
});

export const purchaseAction = defineAction({
  perm: "uniforms.manage", revalidate: R,
  schema: z.object({
    supplierId: zs.id, status: z.enum(["DRAFT", "ORDERED", "RECEIVED"]), expectedDate: zs.optDate(), invoiceNo: zs.optStr(60), notes: zs.optStr(500), isAutoDraft: zs.bool(),
    lines: zs.json(z.array(z.object({ variantId: zs.id, qty: z.coerce.number().int().min(1).max(100000), unitPrice: z.coerce.number().min(0).max(1000000) })).min(1, "Add at least one item")),
  }),
}, async (i, { branchId, user }) => {
  const po = await createPurchase(branchId, i, user.id);
  return { id: po.id, poNumber: po.poNumber };
});

export const purchaseStatusAction = defineAction({
  perm: "uniforms.manage", revalidate: R, schema: z.object({ poId: zs.id, to: z.enum(["ORDERED", "CANCELLED"]) }),
}, async ({ poId, to }, { branchId }) => (to === "ORDERED" ? markPurchaseOrdered(branchId, poId) : cancelPurchase(branchId, poId)));

export const receiveAction = defineAction({
  perm: "uniforms.manage", revalidate: R,
  schema: z.object({ poId: zs.id, invoiceNo: zs.optStr(60), lines: zs.json(z.array(z.object({ lineId: zs.id, qty: z.coerce.number().int().min(0) }))) }),
}, async (i, { branchId, user }) => receivePurchase(branchId, i, user.id));

export const preorderWindowAction = defineAction({
  perm: "uniforms.manage", revalidate: ["/uniforms", "/parent/uniforms"],
  schema: z.object({ yearId: zs.id, open: zs.bool(), notify: zs.bool() }),
}, async ({ yearId, open, notify }, { branchId }) => {
  const y = await setPreorderWindow(yearId, open);
  const notified = open && notify ? await notifyPreorderSizes(y.id, branchId) : 0;
  return { notified };
});

export const importAction = defineAction({ perm: "uniforms.manage", schema: z.object({ file: z.instanceof(File), dryRun: zs.bool() }) }, async ({ file, dryRun }, { branchId, user }) => {
  if (!file.name.toLowerCase().endsWith(".xlsx")) throw new AppError("Upload an .xlsx file.");
  return importUniforms(branchId, await file.arrayBuffer(), dryRun, user.id);
});

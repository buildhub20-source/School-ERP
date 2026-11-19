"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { toNum } from "@/lib/format";
import { createItem, updateItem, setItemActive, saveSupplier, addQuote, createPo, updatePo, markPoOrdered, cancelPo, closePo, receivePo, quickPurchase } from "@/server/stationery/service";
import { approveRequest, rejectRequest, issueRequest } from "@/server/stationery/requests";
import { recordMovement, saveKit, issueKit, saveBudget, deleteBudget, startAudit, saveCounts, completeAudit, cancelAudit } from "@/server/stationery/operations";
import { importStationery } from "@/server/stationery/import";

const R = "/stationery";
const lines = z.array(z.object({ itemId: z.string(), qty: z.coerce.number().int("Quantities must be whole numbers") }));
const poLines = z.array(z.object({ itemId: z.string(), qty: z.coerce.number().int("Quantities must be whole numbers"), unitPrice: z.coerce.number().min(0, "Price cannot be negative") }));

// Items
const itemSchema = z.object({
  id: zs.optStr(40), code: zs.optStr(40), name: zs.str(120), category: zs.str(40), unit: zs.str(20),
  reorderLevel: zs.int(0), reorderQty: zs.int(0), unitCost: zs.money(), preferredSupplierId: zs.optStr(40),
  openingStock: zs.optInt(), isActive: zs.bool().optional(),
});
export const saveItem = defineAction({ perm: "stationery.manage", schema: itemSchema, revalidate: R }, async (input, { branchId }) => {
  if (input.openingStock !== undefined && input.openingStock < 0) throw new AppError("Opening stock cannot be negative.");
  const item = input.id ? await updateItem(branchId, input.id, { ...input, isActive: input.isActive ?? false }) : await createItem(branchId, input);
  return { id: item.id };
});
export const toggleItem = defineAction({ perm: "stationery.manage", schema: z.object({ id: zs.id, isActive: zs.bool() }), revalidate: R }, async ({ id, isActive }, { branchId }) => {
  await setItemActive(branchId, id, isActive);
  return true;
});

// Requests
export const approveReq = defineAction({ perm: "stationery.approve", schema: z.object({ id: zs.id, remarks: zs.optStr(500), lines: zs.json(z.array(z.object({ lineId: z.string(), qty: z.coerce.number().int("Quantities must be whole numbers") }))) }), revalidate: [R, "/teacher"] }, async (input, { branchId, user }) => {
  const r = await approveRequest(branchId, user.id, input.id, input);
  return { status: r.status };
});
export const rejectReq = defineAction({ perm: "stationery.approve", schema: z.object({ id: zs.id, reason: zs.str(500) }), revalidate: [R, "/teacher"] }, async ({ id, reason }, { branchId, user }) => {
  await rejectRequest(branchId, user.id, id, reason);
  return true;
});
export const issueReq = defineAction({ perm: "stationery.approve", schema: z.object({ id: zs.id }), revalidate: [R, "/teacher"] }, async ({ id }, { branchId, user }) => {
  await issueRequest(branchId, user.id, id);
  return true;
});
export const approveAndIssue = defineAction({ perm: "stationery.approve", schema: z.object({ id: zs.id, remarks: zs.optStr(500), lines: zs.json(z.array(z.object({ lineId: z.string(), qty: z.coerce.number().int() }))) }), revalidate: [R, "/teacher"] }, async (input, { branchId, user }) => {
  await approveRequest(branchId, user.id, input.id, input);
  await issueRequest(branchId, user.id, input.id);
  return true;
});

// Direct issue / return / damage / loss / adjustments
const recipient = {
  recipientType: z.enum(["STUDENT", "TEACHER", "CLASS", "DEPARTMENT", "OTHER"]).optional().or(z.literal("").transform(() => undefined)),
  studentId: zs.optStr(40), recipientUserId: zs.optStr(40), classId: zs.optStr(40), departmentId: zs.optStr(40),
};
export const recordStock = defineAction({
  perm: "stationery.manage",
  schema: z.object({ kind: z.enum(["ISSUE", "RETURN", "DAMAGE", "LOSS", "ADJUST_IN", "ADJUST_OUT", "PURCHASE"]), note: zs.optStr(500), lines: zs.json(lines), ...recipient }),
  revalidate: R,
}, async (input, { branchId }) => recordMovement(branchId, input));

/** Find an item by its scanned/typed code. */
export const lookupCode = defineAction({ perm: "stationery.manage", schema: z.object({ code: zs.str(80) }) }, async ({ code }, { branchId }) => {
  const item = await db.stationeryItem.findFirst({ where: { branchId, code: { equals: code.trim(), mode: "insensitive" } } });
  if (!item) throw new AppError(`No item with code ${code}.`);
  return { id: item.id, code: item.code, name: item.name, unit: item.unit, currentStock: item.currentStock, reorderLevel: item.reorderLevel, unitCost: toNum(item.unitCost), isActive: item.isActive };
});
export const scanMove = defineAction({ perm: "stationery.manage", schema: z.object({ itemId: zs.id, kind: z.enum(["ISSUE", "RETURN", "DAMAGE", "LOSS", "ADJUST_IN", "ADJUST_OUT", "PURCHASE"]), qty: zs.int(1), note: zs.optStr(300), ...recipient }), revalidate: R }, async (input, { branchId }) => {
  await recordMovement(branchId, { ...input, lines: [{ itemId: input.itemId, qty: input.qty }] });
  const item = await db.stationeryItem.findUniqueOrThrow({ where: { id: input.itemId } });
  return { currentStock: item.currentStock };
});

// Suppliers
const supplierSchema = z.object({ id: zs.optStr(40), name: zs.str(120), contactPerson: zs.optStr(120), phone: zs.optPhone(), email: zs.optEmail(), address: zs.optStr(500), gstin: zs.optStr(20), notes: zs.optStr(1000), isActive: zs.bool().optional() });
export const saveSupplierAction = defineAction({ perm: "stationery.manage", schema: supplierSchema, revalidate: R }, async (input, { branchId }) => {
  const s = await saveSupplier(branchId, input.id, { ...input, isActive: input.id ? input.isActive ?? false : true });
  return { id: s.id };
});
export const addQuoteAction = defineAction({ perm: "stationery.manage", schema: z.object({ supplierId: zs.id, itemId: zs.id, price: zs.money(), effectiveDate: zs.optDate() }), revalidate: R }, async (input, { branchId }) => {
  await addQuote(branchId, input);
  return true;
});

// Purchase orders
const poSchema = z.object({ id: zs.optStr(40), supplierId: zs.id, expectedDate: zs.optDate(), notes: zs.optStr(1000), invoiceNo: zs.optStr(60), lines: zs.json(poLines) });
export const savePo = defineAction({ perm: "stationery.manage", schema: poSchema, revalidate: R }, async (input, { branchId }) => {
  const po = input.id ? await updatePo(branchId, input.id, input) : await createPo(branchId, input);
  return { id: po.id };
});
export const recordPurchase = defineAction({ perm: "stationery.manage", schema: poSchema, revalidate: R }, async (input, { branchId }) => {
  const po = await quickPurchase(branchId, input);
  return { id: po.id };
});
export const orderPo = defineAction({ perm: "stationery.manage", schema: z.object({ id: zs.id }), revalidate: R }, async ({ id }, { branchId }) => {
  await markPoOrdered(branchId, id);
  return true;
});
export const cancelPoAction = defineAction({ perm: "stationery.manage", schema: z.object({ id: zs.id, reason: zs.str(300) }), revalidate: R }, async ({ id, reason }, { branchId }) => {
  await cancelPo(branchId, id, reason);
  return true;
});
export const closePoAction = defineAction({ perm: "stationery.manage", schema: z.object({ id: zs.id, reason: zs.str(300) }), revalidate: R }, async ({ id, reason }, { branchId }) => {
  await closePo(branchId, id, reason);
  return true;
});
export const receivePoAction = defineAction({ perm: "stationery.manage", schema: z.object({ id: zs.id, invoiceNo: zs.optStr(60), lines: zs.json(z.array(z.object({ lineId: z.string(), qty: z.coerce.number().int("Quantities must be whole numbers").min(0) }))) }), revalidate: R }, async (input, { branchId }) => {
  const po = await receivePo(branchId, input.id, input);
  return { status: po.status };
});

// Kits
export const saveKitAction = defineAction({ perm: "stationery.manage", schema: z.object({ id: zs.optStr(40), name: zs.str(120), classId: zs.id, isActive: zs.bool().optional(), lines: zs.json(lines) }), revalidate: R }, async (input, { branchId }) => {
  const k = await saveKit(branchId, input.id, { ...input, isActive: input.id ? input.isActive ?? false : true });
  return { id: k.id };
});
export const issueKitAction = defineAction({ perm: "stationery.manage", schema: z.object({ kitId: zs.id, sectionId: zs.optStr(40), studentCount: zs.optInt(), note: zs.optStr(300) }), revalidate: R }, async (input, { branchId }) => {
  const k = await issueKit(branchId, input);
  return { studentCount: k.studentCount };
});

// Budgets
export const saveBudgetAction = defineAction({ perm: "stationery.manage", schema: z.object({ id: zs.optStr(40), academicYearId: zs.id, target: zs.str(60), amount: zs.money() }), revalidate: R }, async (input, { branchId }) => {
  const [kind, targetId] = input.target.split(":");
  await saveBudget(branchId, { id: input.id, academicYearId: input.academicYearId, amount: input.amount, classId: kind === "c" ? targetId : undefined, departmentId: kind === "d" ? targetId : undefined });
  return true;
});
export const deleteBudgetAction = defineAction({ perm: "stationery.manage", schema: z.object({ id: zs.id }), revalidate: R }, async ({ id }, { branchId }) => {
  await deleteBudget(branchId, id);
  return true;
});

// Audits
export const startAuditAction = defineAction({ perm: "stationery.manage", schema: z.object({ category: zs.optStr(40), notes: zs.optStr(500) }), revalidate: R }, async (input, { branchId }) => {
  const a = await startAudit(branchId, input);
  return { id: a.id };
});
export const saveCountsAction = defineAction({ perm: "stationery.manage", schema: z.object({ id: zs.id, counts: zs.json(z.array(z.object({ lineId: z.string(), countedQty: z.number().int().min(0).nullable(), note: z.string().max(300).optional() }))) }), revalidate: R }, async ({ id, counts }, { branchId }) => saveCounts(branchId, id, counts));
export const completeAuditAction = defineAction({ perm: "stationery.manage", schema: z.object({ id: zs.id }), revalidate: R }, async ({ id }, { branchId }) => completeAudit(branchId, id));
export const cancelAuditAction = defineAction({ perm: "stationery.manage", schema: z.object({ id: zs.id }), revalidate: R }, async ({ id }, { branchId }) => {
  await cancelAudit(branchId, id);
  return true;
});

// Import
export const importItems = defineAction({ perm: "stationery.manage", schema: z.object({ file: z.instanceof(File), dryRun: zs.bool() }), revalidate: R }, async ({ file, dryRun }, { branchId }) => importStationery(branchId, await file.arrayBuffer(), dryRun));

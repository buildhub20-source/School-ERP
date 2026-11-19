"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { disposeAsset, logRepair, moveAsset, saveAsset, setAssetStatus, verifyAsset } from "@/server/assets/service";

const A = "/assets";
const optId = () => z.string().optional().transform((v) => (v ? v : undefined));
const condition = z.enum(["NEW", "GOOD", "FAIR", "POOR"]);
// Schemas live at module level: a "use server" file may only export async functions, and Next rejects inline arrows here.
const optCondition = condition.optional().or(z.literal("").transform(() => undefined));

export const saveAssetAction = defineAction({
  perm: "assets.manage", revalidate: A,
  schema: z.object({
    id: optId(), name: zs.str(200), category: zs.str(80), location: zs.optStr(120), assignedTo: zs.optStr(120), brand: zs.optStr(80), model: zs.optStr(80),
    serialNo: zs.optStr(80), supplierName: zs.optStr(120), invoiceNo: zs.optStr(60), purchaseDate: zs.optDate(), cost: zs.money(),
    usefulLifeYears: zs.int(1), salvageValue: zs.money(), warrantyUntil: zs.optDate(), condition, notes: zs.optStr(1000), quantity: zs.optInt(),
  }),
}, async ({ quantity, ...input }, { branchId, user }) => {
  const made = await saveAsset(branchId, user.name, input, quantity ?? 1);
  return { id: made[0].id, message: input.id ? "Asset updated" : made.length > 1 ? `Added ${made.length} assets: ${made[0].code} – ${made[made.length - 1].code}` : `Added ${made[0].code}` };
});

export const moveAssetAction = defineAction({
  perm: "assets.manage", revalidate: A,
  schema: z.object({ id: zs.id, location: zs.optStr(120), assignedTo: zs.optStr(120), notes: zs.optStr(300) }),
}, async ({ id, ...input }, { branchId, user }) => {
  await moveAsset(branchId, user.name, id, input);
  return true;
});

export const repairAssetAction = defineAction({
  perm: "assets.manage", revalidate: A,
  schema: z.object({ id: zs.id, notes: zs.str(500), cost: zs.optMoney(), status: z.enum(["UNDER_REPAIR", "IN_USE"]), condition: optCondition }),
}, async ({ id, ...input }, { branchId, user }) => {
  await logRepair(branchId, user.name, id, input);
  return true;
});

export const verifyAssetAction = defineAction({
  perm: "assets.manage", revalidate: A,
  schema: z.object({ id: optId(), code: zs.optStr(20), condition: optCondition, location: zs.optStr(120), notes: zs.optStr(300) }),
}, async ({ id, code, ...input }, { branchId, user }) => {
  const a = await verifyAsset(branchId, user.name, { id, code }, input);
  return { message: `${a.code} ${a.name} verified${a.location ? ` at ${a.location}` : ""}` };
});

export const assetStatusAction = defineAction({
  perm: "assets.manage", revalidate: A,
  schema: z.object({ id: zs.id, status: z.enum(["IN_USE", "IN_STORE", "UNDER_REPAIR", "LOST"]), reason: zs.optStr(300) }),
}, async ({ id, status, reason }, { branchId, user }) => {
  await setAssetStatus(branchId, user.name, id, status, reason);
  return true;
});

export const disposeAssetAction = defineAction({
  perm: "assets.manage", revalidate: A,
  schema: z.object({ id: zs.id, date: zs.date(), value: zs.money(), reason: zs.str(300) }),
}, async ({ id, ...input }, { branchId, user }) => {
  await disposeAsset(branchId, user.name, id, input);
  return true;
});

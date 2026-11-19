import "server-only";
import type { Asset, AssetCondition, AssetStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { nextNumber } from "@/lib/counters";
import { addDays, fmtDate, round2, today, toNum } from "@/lib/format";
import { notifyPermission } from "@/lib/messaging/notify";

export const ASSET_CATEGORIES = ["Computers & IT", "Projectors & AV", "Furniture", "Lab equipment", "Sports equipment", "Musical instruments", "Electrical & appliances", "Kitchen & canteen", "Office equipment", "Other"];
export const CONDITIONS: AssetCondition[] = ["NEW", "GOOD", "FAIR", "POOR"];
export const STATUS_LABEL: Record<AssetStatus, string> = { IN_USE: "In use", IN_STORE: "In store", UNDER_REPAIR: "Under repair", LOST: "Lost", DISPOSED: "Disposed" };

/* ───────────── depreciation (straight line) ───────────── */

/** Straight-line depreciation: (cost − salvage) spread evenly over the useful life from the purchase date. */
export function depreciation(a: Pick<Asset, "cost" | "salvageValue" | "usefulLifeYears" | "purchaseDate">, asOf = today()) {
  const cost = toNum(a.cost), salvage = Math.min(toNum(a.salvageValue), cost);
  const life = Math.max(1, a.usefulLifeYears);
  const years = a.purchaseDate ? Math.max(0, (asOf.getTime() - a.purchaseDate.getTime()) / (365.25 * 86400000)) : 0;
  const annual = (cost - salvage) / life;
  const accumulated = round2(Math.min(cost - salvage, annual * years));
  return { annual: round2(annual), accumulated, bookValue: round2(cost - accumulated), fullyDepreciated: years >= life };
}

/* ───────────── register ───────────── */

export type AssetInput = {
  id?: string; name: string; category: string; location?: string; assignedTo?: string; brand?: string; model?: string; serialNo?: string;
  supplierName?: string; invoiceNo?: string; purchaseDate?: Date; cost: number; usefulLifeYears: number; salvageValue: number;
  warrantyUntil?: Date; condition: AssetCondition; notes?: string;
};

async function inBranch(branchId: string, id: string) {
  const a = await db.asset.findFirst({ where: { id, branchId } });
  if (!a) throw new AppError("Asset not found.");
  return a;
}

export async function saveAsset(branchId: string, byName: string, input: AssetInput, quantity = 1) {
  const data = {
    name: input.name, category: input.category, location: input.location ?? null, assignedTo: input.assignedTo ?? null, brand: input.brand ?? null,
    model: input.model ?? null, serialNo: input.serialNo ?? null, supplierName: input.supplierName ?? null, invoiceNo: input.invoiceNo ?? null,
    purchaseDate: input.purchaseDate ?? null, cost: input.cost, usefulLifeYears: input.usefulLifeYears, salvageValue: input.salvageValue,
    warrantyUntil: input.warrantyUntil ?? null, condition: input.condition, notes: input.notes ?? null,
  };
  if (input.salvageValue > input.cost) throw new AppError("The salvage value cannot be more than the cost.");
  if (input.id) {
    const before = await inBranch(branchId, input.id);
    if (before.status === "DISPOSED") throw new AppError("A disposed asset cannot be edited.");
    return [await db.asset.update({ where: { id: input.id }, data: { ...data, ...(input.warrantyUntil?.getTime() !== before.warrantyUntil?.getTime() ? { warrantyAlertAt: null } : {}) } })];
  }
  if (quantity < 1 || quantity > 100) throw new AppError("Add between 1 and 100 identical assets at a time.");
  return db.$transaction(async (tx) => {
    const made = [];
    for (let i = 0; i < quantity; i++) {
      const n = await nextNumber(`AST-${branchId}`, tx);
      const code = `AST-${String(n).padStart(5, "0")}`;
      made.push(await tx.asset.create({ data: { ...data, branchId, code, serialNo: quantity > 1 ? null : data.serialNo, events: { create: { type: "CREATED", toLocation: data.location, byName, notes: data.assignedTo ? `Assigned to ${data.assignedTo}` : null } } } }));
    }
    return made;
  });
}

export async function moveAsset(branchId: string, byName: string, id: string, input: { location?: string; assignedTo?: string; notes?: string }) {
  const a = await inBranch(branchId, id);
  if (a.status === "DISPOSED") throw new AppError("This asset has been disposed of.");
  const location = input.location ?? null, assignedTo = input.assignedTo ?? null;
  if (location === a.location && assignedTo === a.assignedTo) throw new AppError("Nothing changed.");
  return db.asset.update({
    where: { id },
    data: { location, assignedTo, events: { create: { type: "MOVED", fromLocation: a.location, toLocation: location, byName, notes: [assignedTo !== a.assignedTo ? `Assigned to ${assignedTo ?? "nobody"}` : null, input.notes].filter(Boolean).join(" · ") || null } } },
  });
}

/** Record a repair or service. `status` UNDER_REPAIR sends it for repair; IN_USE brings it back. */
export async function logRepair(branchId: string, byName: string, id: string, input: { notes: string; cost?: number; status: "UNDER_REPAIR" | "IN_USE"; condition?: AssetCondition }) {
  const a = await inBranch(branchId, id);
  if (a.status === "DISPOSED") throw new AppError("This asset has been disposed of.");
  return db.asset.update({
    where: { id },
    data: { status: input.status, ...(input.condition ? { condition: input.condition } : {}), events: { create: { type: "REPAIR", cost: input.cost ?? null, notes: `${input.status === "UNDER_REPAIR" ? "Sent for repair" : "Back in use"}: ${input.notes}`, byName } } },
  });
}

/** Physical verification: someone saw the asset where it should be. Optionally corrects its condition or location. */
export async function verifyAsset(branchId: string, byName: string, ref: { id?: string; code?: string }, input: { condition?: AssetCondition; location?: string; notes?: string } = {}) {
  const a = ref.id ? await inBranch(branchId, ref.id) : await db.asset.findFirst({ where: { branchId, code: (ref.code ?? "").trim().toUpperCase() } });
  if (!a) throw new AppError(`No asset with code ${(ref.code ?? "").trim().toUpperCase()}.`);
  if (a.status === "DISPOSED") throw new AppError(`${a.code} was disposed of on ${fmtDate(a.disposedOn)}.`);
  const moved = input.location && input.location !== a.location;
  const updated = await db.asset.update({
    where: { id: a.id },
    data: {
      lastVerifiedAt: new Date(), ...(input.condition ? { condition: input.condition } : {}), ...(moved ? { location: input.location } : {}),
      ...(a.status === "LOST" ? { status: "IN_USE" as const } : {}),
      events: { create: { type: "VERIFIED", byName, fromLocation: moved ? a.location : null, toLocation: moved ? input.location : a.location, notes: [a.status === "LOST" ? "Found" : null, input.condition && input.condition !== a.condition ? `Condition ${input.condition.toLowerCase()}` : null, input.notes].filter(Boolean).join(" · ") || null } },
    },
  });
  return updated;
}

export async function setAssetStatus(branchId: string, byName: string, id: string, status: Exclude<AssetStatus, "DISPOSED">, notes?: string) {
  const a = await inBranch(branchId, id);
  if (a.status === "DISPOSED") throw new AppError("This asset has been disposed of.");
  if (a.status === status) return a;
  return db.asset.update({ where: { id }, data: { status, events: { create: { type: "STATUS", byName, notes: [`${STATUS_LABEL[a.status]} → ${STATUS_LABEL[status]}`, notes].filter(Boolean).join(" · ") } } } });
}

export async function disposeAsset(branchId: string, byName: string, id: string, input: { date: Date; value: number; reason: string }) {
  const a = await inBranch(branchId, id);
  if (a.status === "DISPOSED") throw new AppError("Already disposed of.");
  if (!input.reason.trim()) throw new AppError("Give a reason (sold, scrapped, written off …).");
  return db.asset.update({
    where: { id },
    data: { status: "DISPOSED", disposedOn: input.date, disposalValue: input.value, disposalReason: input.reason, events: { create: { type: "DISPOSED", date: input.date, cost: input.value, notes: input.reason, byName } } },
  });
}

/* ───────────── dashboard & automation ───────────── */

export async function assetsDashboard(branchId: string, warrantyDays = 30) {
  const t = today();
  const assets = await db.asset.findMany({ where: { branchId, status: { not: "DISPOSED" } }, select: { cost: true, salvageValue: true, usefulLifeYears: true, purchaseDate: true, status: true, warrantyUntil: true, lastVerifiedAt: true } });
  const yearAgo = addDays(t, -365);
  return {
    count: assets.length,
    cost: round2(assets.reduce((s, a) => s + toNum(a.cost), 0)),
    bookValue: round2(assets.reduce((s, a) => s + depreciation(a, t).bookValue, 0)),
    underRepair: assets.filter((a) => a.status === "UNDER_REPAIR").length,
    lost: assets.filter((a) => a.status === "LOST").length,
    warrantyExpiring: assets.filter((a) => a.warrantyUntil && a.warrantyUntil >= t && a.warrantyUntil <= addDays(t, warrantyDays)).length,
    notVerified: assets.filter((a) => !a.lastVerifiedAt || a.lastVerifiedAt < yearAgo).length,
  };
}

/** Daily: tell the asset managers once when an asset's warranty will end within N days. */
export async function assetWarrantyAlerts(config: Record<string, unknown>): Promise<string> {
  const days = Math.max(1, Number(config.daysBefore ?? 30) || 30);
  const t = today();
  const due = await db.asset.findMany({ where: { status: { not: "DISPOSED" }, warrantyAlertAt: null, warrantyUntil: { gte: t, lte: addDays(t, days) } }, orderBy: { warrantyUntil: "asc" } });
  const byBranch = new Map<string, typeof due>();
  for (const a of due) byBranch.set(a.branchId, [...(byBranch.get(a.branchId) ?? []), a]);
  for (const [branchId, list] of byBranch) {
    await notifyPermission("assets.manage", {
      title: `${list.length} asset warrant${list.length === 1 ? "y ends" : "ies end"} soon`,
      body: list.slice(0, 8).map((a) => `${a.code} ${a.name} — ${fmtDate(a.warrantyUntil)}`).join("\n") + (list.length > 8 ? `\n…and ${list.length - 8} more` : ""),
      link: "/assets?warranty=soon", category: "ASSETS", inAppOnly: true,
    }, branchId);
    await db.asset.updateMany({ where: { id: { in: list.map((a) => a.id) } }, data: { warrantyAlertAt: new Date() } });
  }
  return `${due.length} warranty alert(s)`;
}

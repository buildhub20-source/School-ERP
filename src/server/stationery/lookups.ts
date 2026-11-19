import "server-only";
import { db } from "@/lib/db";
import { toNum } from "@/lib/format";

/** Active items for dropdowns (client-safe plain objects). */
export async function itemOptions(branchId: string, includeInactive = false) {
  const items = await db.stationeryItem.findMany({ where: { branchId, ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ category: "asc" }, { name: "asc" }] });
  return items.map((i) => ({ id: i.id, name: i.name, code: i.code, unit: i.unit, currentStock: i.currentStock, unitCost: toNum(i.unitCost), category: i.category }));
}

export async function supplierOptions(branchId: string) {
  return db.supplier.findMany({ where: { branchId, isActive: true, supplies: { has: "STATIONERY" } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** Latest price per item from one supplier (to prefill purchase lines). */
export async function lastPrices(supplierId: string) {
  const rows = await db.supplierPrice.findMany({ where: { supplierId, stationeryItemId: { not: null } }, orderBy: { effectiveDate: "desc" } });
  const out: Record<string, number> = {};
  for (const r of rows) if (!(r.stationeryItemId! in out)) out[r.stationeryItemId!] = toNum(r.price);
  return out;
}

export async function studentOptions(branchId: string) {
  const rows = await db.student.findMany({ where: { branchId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, admissionNo: true, classId: true, section: { select: { name: true } } }, orderBy: [{ firstName: "asc" }] });
  return rows.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName ?? ""}`.trim(), admissionNo: s.admissionNo, classId: s.classId, section: s.section?.name ?? "" }));
}

/** Latest price per supplier per item. */
export async function supplierPriceMap(branchId: string) {
  const rows = await db.supplierPrice.findMany({ where: { supplier: { branchId }, stationeryItemId: { not: null } }, orderBy: { effectiveDate: "desc" } });
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const m = (out[r.supplierId] ??= {});
    if (!(r.stationeryItemId! in m)) m[r.stationeryItemId!] = toNum(r.price);
  }
  return out;
}


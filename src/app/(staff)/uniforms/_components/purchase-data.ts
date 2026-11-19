import "server-only";
import { db } from "@/lib/db";
import { toNum } from "@/lib/format";

/** Supplier and size options for the purchase builder (uniform suppliers first). */
export async function purchaseOptions(branchId: string) {
  const [suppliers, variants] = await Promise.all([
    db.supplier.findMany({ where: { branchId, isActive: true }, orderBy: { name: "asc" } }),
    db.uniformVariant.findMany({ where: { item: { branchId, isActive: true }, isActive: true }, include: { item: true, prices: { orderBy: { effectiveDate: "desc" }, take: 1 } }, orderBy: [{ item: { name: "asc" } }, { sizeOrder: "asc" }] }),
  ]);
  return {
    suppliers: suppliers.sort((a, b) => Number(b.supplies.includes("UNIFORM")) - Number(a.supplies.includes("UNIFORM"))).map((s) => ({ id: s.id, name: s.supplies.includes("UNIFORM") ? s.name : `${s.name} (stationery)` })),
    variants: variants.map((v) => ({ id: v.id, label: `${v.item.name} — ${v.size}`, stock: v.stock, price: toNum(v.price), lastCost: toNum(v.prices[0]?.price) })),
  };
}

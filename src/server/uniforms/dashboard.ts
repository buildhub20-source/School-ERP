import "server-only";
import { db } from "@/lib/db";
import { openDemand } from "./queries";
import { OPEN_STATUSES } from "./labels";

/** Uniform widgets for the admin dashboard. needed = max(open order/pre-order demand, reorder level). */
export async function uniformsDashboard(branchId: string): Promise<{ openOrders: number; readyForPickup: number; sizeShortages: { itemName: string; size: string; stock: number; needed: number }[] }> {
  const [openOrders, readyForPickup, demand, variants] = await Promise.all([
    db.uniformOrder.count({ where: { branchId, status: { in: [...OPEN_STATUSES] } } }),
    db.uniformOrder.count({ where: { branchId, status: "READY" } }),
    openDemand(branchId),
    db.uniformVariant.findMany({ where: { isActive: true, item: { branchId, isActive: true } }, include: { item: { select: { name: true } } }, orderBy: [{ item: { name: "asc" } }, { sizeOrder: "asc" }] }),
  ]);
  const sizeShortages = variants
    .map((v) => {
      const d = demand.get(v.id) ?? 0;
      const short = v.stock < d || (v.reorderLevel > 0 && v.stock <= v.reorderLevel);
      return short ? { itemName: v.item.name, size: v.size, stock: v.stock, needed: Math.max(d, v.reorderLevel) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.needed - b.stock - (a.needed - a.stock));
  return { openOrders, readyForPickup, sizeShortages };
}

/** Per child: open orders (Ordered/Paid/Ready) and orders ready for pickup. */
export async function parentUniformSummary(studentIds: string[]): Promise<{ studentId: string; openOrders: number; ready: number }[]> {
  if (!studentIds.length) return [];
  const rows = await db.uniformOrder.groupBy({ by: ["studentId", "status"], where: { studentId: { in: studentIds }, status: { in: [...OPEN_STATUSES] } }, _count: true });
  return studentIds.map((id) => {
    const mine = rows.filter((r) => r.studentId === id);
    return { studentId: id, openOrders: mine.reduce((s, r) => s + r._count, 0), ready: mine.filter((r) => r.status === "READY").reduce((s, r) => s + r._count, 0) };
  });
}

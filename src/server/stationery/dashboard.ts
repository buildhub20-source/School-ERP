import "server-only";
import { db } from "@/lib/db";
import { round2 } from "@/lib/format";
import { lowStockIds, stockValue } from "./core";

/** Dashboard tile: total items, stock value, low-stock alerts, pending teacher requests. */
export async function stationeryDashboard(branchId: string): Promise<{ totalItems: number; stockValue: number; lowStock: { id: string; name: string; currentStock: number; reorderLevel: number }[]; pendingRequests: number }> {
  const [totalItems, value, lowIds, pendingRequests] = await Promise.all([
    db.stationeryItem.count({ where: { branchId, isActive: true } }),
    stockValue(branchId, { positiveOnly: true }),
    lowStockIds(branchId),
    db.stationeryRequest.count({ where: { branchId, status: "PENDING" } }),
  ]);
  const lowStock = await db.stationeryItem.findMany({ where: { id: { in: lowIds } }, select: { id: true, name: true, currentStock: true, reorderLevel: true }, orderBy: { currentStock: "asc" } });
  return { totalItems, stockValue: round2(value), lowStock, pendingRequests };
}

/** Approvals inbox: pending stationery requests, oldest first. */
export async function pendingStationeryApprovals(branchId: string): Promise<{ id: string; requestNo: string; requestedBy: string; createdAt: Date; lineCount: number }[]> {
  const rows = await db.stationeryRequest.findMany({
    where: { branchId, status: "PENDING" },
    include: { requestedBy: { select: { name: true } }, _count: { select: { lines: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ id: r.id, requestNo: r.requestNo, requestedBy: r.requestedBy.name, createdAt: r.createdAt, lineCount: r._count.lines }));
}

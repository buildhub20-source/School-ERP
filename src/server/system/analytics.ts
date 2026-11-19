import "server-only";
import { db } from "@/lib/db";

/**
 * Cross-table figures for the dashboard and analytics pages. They used to be single SQL statements with joins; the JSON
 * data engine has no SQL, so they are computed here from ordinary queries (same output shape as before).
 */

const IST = 330 * 60000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Students per class with per-section counts, e.g. { name: "Class 5", grade: 5, sections: "A:6, B:5", total: 11 }. */
export async function studentsByClass(branchId: string) {
  const classes = await db.schoolClass.findMany({
    where: { branchId },
    orderBy: { grade: "asc" },
    include: { sections: { orderBy: { name: "asc" }, include: { _count: { select: { students: { where: { status: "ACTIVE" } } } } } } },
  });
  return classes.map((c) => ({
    name: c.name, grade: c.grade,
    sections: c.sections.length ? c.sections.map((s) => `${s.name}:${s._count.students}`).sort().join(", ") : null,
    total: BigInt(c.sections.reduce((n, s) => n + s._count.students, 0)),
  }));
}

/** Stationery issued per IST month over the last 12 months (value at cost and quantity), oldest first. */
export async function stationerySpendByMonth(branchId: string) {
  const since = new Date(); since.setMonth(since.getMonth() - 12);
  const moves = await db.stockMovement.findMany({ where: { item: { branchId }, type: "ISSUE", createdAt: { gte: since } }, select: { createdAt: true, qty: true, unitCost: true } });
  const by = new Map<string, { amount: number; qty: number }>();
  for (const m of moves) {
    const d = new Date(m.createdAt.getTime() + IST);
    const key = d.toISOString().slice(0, 7);
    const cur = by.get(key) ?? { amount: 0, qty: 0 };
    cur.amount += -m.qty * Number(m.unitCost ?? 0);
    cur.qty += -m.qty;
    by.set(key, cur);
  }
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({ month: `${MON[Number(key.slice(5)) - 1]} ${key.slice(2, 4)}`, amount: v.amount, qty: v.qty }));
}

/** Uniform quantities ordered per item and academic year (cancelled orders excluded), by item then year. */
export async function uniformDemandByYear(branchId: string) {
  const lines = await db.uniformOrderLine.findMany({
    where: { order: { branchId, status: { not: "CANCELLED" } } },
    select: { qty: true, variant: { select: { item: { select: { name: true } } } }, order: { select: { academicYear: { select: { name: true, isCurrent: true, startDate: true } } } } },
  });
  const by = new Map<string, { item: string; year: string; isCurrent: boolean; start: number; qty: number }>();
  for (const l of lines) {
    const y = l.order.academicYear;
    const k = `${l.variant.item.name}\u0001${y.name}`;
    const cur = by.get(k) ?? { item: l.variant.item.name, year: y.name, isCurrent: y.isCurrent, start: y.startDate.getTime(), qty: 0 };
    cur.qty += l.qty;
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => a.item.localeCompare(b.item) || a.start - b.start).map(({ item, year, isCurrent, qty }) => ({ item, year, isCurrent, qty }));
}

/** Seats and active allocations per active bus. */
export async function busOccupancy(branchId: string) {
  const buses = await db.bus.findMany({ where: { branchId, isActive: true }, orderBy: { busNo: "asc" }, select: { busNo: true, capacity: true, _count: { select: { allocations: { where: { status: "ACTIVE" } } } } } });
  return buses.map((b) => ({ busNo: b.busNo, capacity: b.capacity, filled: b._count.allocations }));
}

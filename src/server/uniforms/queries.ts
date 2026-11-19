import "server-only";
import type { Gender, Prisma, UniformCategory, UniformGender } from "@prisma/client";
import { db } from "@/lib/db";
import { toNum } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import { currentYear, gendersFor, preorderYear, setForStudent, stepSize, suggestSizes } from "./core";
import { UNDEDUCTED_STATUSES } from "./labels";

/** Demand per variant from orders whose stock is not yet deducted (Ordered/Paid). */
export async function openDemand(branchId: string, opts: { academicYearId?: string; isPreOrder?: boolean } = {}) {
  const rows = await db.uniformOrderLine.groupBy({
    by: ["variantId"],
    where: { order: { branchId, status: { in: [...UNDEDUCTED_STATUSES] }, ...(opts.academicYearId ? { academicYearId: opts.academicYearId } : {}), ...(opts.isPreOrder !== undefined ? { isPreOrder: opts.isPreOrder } : {}) } },
    _sum: { qty: true, qtyReturned: true },
  });
  return new Map(rows.map((r) => [r.variantId, (r._sum.qty ?? 0) - (r._sum.qtyReturned ?? 0)]));
}

export type MatrixCell = { variantId: string; size: string; stock: number; reorderLevel: number; demand: number; state: "out" | "low" | "short" | "ok" };
export type MatrixRow = { itemId: string; name: string; gender: UniformGender; category: UniformCategory; cells: Map<string, MatrixCell>; totalStock: number };

/** Size-wise stock matrix grouped by category: columns are the union of sizes in that category (ordered by size order). */
export async function stockMatrix(branchId: string, f: { category?: string; gender?: string; q?: string; onlyGaps?: boolean }) {
  const where: Prisma.UniformItemWhereInput = {
    branchId, isActive: true,
    ...(f.category ? { category: f.category as UniformCategory } : {}),
    ...(f.gender ? { gender: f.gender as UniformGender } : {}),
    ...(f.q ? { name: { contains: f.q, mode: "insensitive" } } : {}),
  };
  const [items, demand] = await Promise.all([
    db.uniformItem.findMany({ where, include: { variants: { where: { isActive: true }, orderBy: { sizeOrder: "asc" } } }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    openDemand(branchId),
  ]);
  const groups = new Map<UniformCategory, { sizes: { size: string; order: number }[]; rows: MatrixRow[] }>();
  for (const it of items) {
    const g = groups.get(it.category) ?? { sizes: [], rows: [] };
    const cells = new Map<string, MatrixCell>();
    for (const v of it.variants) {
      const d = demand.get(v.id) ?? 0;
      const state: MatrixCell["state"] = v.stock <= 0 ? "out" : v.stock < d ? "short" : v.reorderLevel > 0 && v.stock <= v.reorderLevel ? "low" : "ok";
      cells.set(v.size, { variantId: v.id, size: v.size, stock: v.stock, reorderLevel: v.reorderLevel, demand: d, state });
      const ex = g.sizes.find((s) => s.size === v.size);
      if (!ex) g.sizes.push({ size: v.size, order: v.sizeOrder });
      else ex.order = Math.min(ex.order, v.sizeOrder);
    }
    const row: MatrixRow = { itemId: it.id, name: it.name, gender: it.gender, category: it.category, cells, totalStock: it.variants.reduce((s, v) => s + v.stock, 0) };
    if (f.onlyGaps && ![...cells.values()].some((c) => c.state !== "ok")) continue;
    g.rows.push(row);
    groups.set(it.category, g);
  }
  for (const g of groups.values()) {
    g.sizes.sort((a, b) => a.order - b.order || a.size.localeCompare(b.size, undefined, { numeric: true }));
    // Columns only for sizes used by the rows still shown
    g.sizes = g.sizes.filter((s) => g.rows.some((r) => r.cells.has(s.size)));
  }
  return [...groups.entries()].filter(([, g]) => g.rows.length).map(([category, g]) => ({ category, ...g }));
}

export type DemandRow = { variantId: string; itemId: string; itemName: string; category: UniformCategory; size: string; sizeOrder: number; preorders: number; otherOpen: number; stock: number; shortfall: number; price: number; lastCost: number };

/** Pre-order demand by item × size vs stock (other open orders compete for the same stock). */
export async function preorderDemand(branchId: string, academicYearId: string, f: { category?: string } = {}) {
  const [pre, all] = await Promise.all([openDemand(branchId, { academicYearId, isPreOrder: true }), openDemand(branchId)]);
  const ids = [...new Set([...pre.keys()])];
  const variants = await db.uniformVariant.findMany({
    where: { id: { in: ids }, ...(f.category ? { item: { category: f.category as UniformCategory } } : {}) },
    include: { item: true, prices: { orderBy: { effectiveDate: "desc" }, take: 1 } },
  });
  const rows: DemandRow[] = variants.map((v) => {
    const p = pre.get(v.id) ?? 0;
    const other = Math.max(0, (all.get(v.id) ?? 0) - p);
    return {
      variantId: v.id, itemId: v.itemId, itemName: v.item.name, category: v.item.category, size: v.size, sizeOrder: v.sizeOrder,
      preorders: p, otherOpen: other, stock: v.stock, shortfall: Math.max(0, p + other - v.stock), price: toNum(v.price), lastCost: toNum(v.prices[0]?.price),
    };
  });
  return rows.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.sizeOrder - b.sizeOrder);
}

export type PlanRow = { variantId: string; itemName: string; category: UniformCategory; size: string; sizeOrder: number; lastYear: number; forecast: number; orderedThisYear: number; pendingOut: number; stock: number; shortfall: number; lastCost: number };

/**
 * Seasonal planning: sweater and shoe demand forecast from last year's orders by size.
 * Last year's quantities move up by the size growth steps (children grow) and are scaled by growth %.
 * Shortfall = max(0, forecast − ordered this year) + not-yet-deducted orders − stock.
 */
export async function seasonalPlan(branchId: string, opts: { categories: UniformCategory[]; growthPercent: number; shiftSizes: boolean }) {
  const year = await currentYear();
  const last = await db.academicYear.findFirst({ where: { startDate: { lt: year.startDate } }, orderBy: { startDate: "desc" } });
  const steps = opts.shiftSizes ? (await getSetting("policies")).sizeGrowthSteps : 0;
  const items = await db.uniformItem.findMany({
    where: { branchId, category: { in: opts.categories }, isActive: true },
    include: { variants: { orderBy: { sizeOrder: "asc" }, include: { prices: { orderBy: { effectiveDate: "desc" }, take: 1 } } } },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
  const variantIds = items.flatMap((i) => i.variants.map((v) => v.id));
  const sumBy = async (where: Prisma.UniformOrderLineWhereInput) => {
    const rows = await db.uniformOrderLine.groupBy({ by: ["variantId"], where: { variantId: { in: variantIds }, ...where }, _sum: { qty: true, qtyReturned: true } });
    return new Map(rows.map((r) => [r.variantId, (r._sum.qty ?? 0) - (r._sum.qtyReturned ?? 0)]));
  };
  const [lastQty, thisQty, pending] = await Promise.all([
    last ? sumBy({ order: { academicYearId: last.id, status: { not: "CANCELLED" } } }) : Promise.resolve(new Map<string, number>()),
    sumBy({ order: { academicYearId: year.id, status: { not: "CANCELLED" } } }),
    sumBy({ order: { status: { in: [...UNDEDUCTED_STATUSES] } } }),
  ]);
  const rows: PlanRow[] = [];
  for (const it of items) {
    const forecastRaw = new Map<string, number>();
    for (const v of it.variants) {
      const q = lastQty.get(v.id) ?? 0;
      if (!q) continue;
      const target = stepSize(it.variants, v.sizeOrder, steps) ?? v;
      forecastRaw.set(target.id, (forecastRaw.get(target.id) ?? 0) + q);
    }
    for (const v of it.variants) {
      if (!v.isActive && !lastQty.get(v.id)) continue;
      const forecast = Math.ceil((forecastRaw.get(v.id) ?? 0) * (1 + opts.growthPercent / 100));
      const ordered = thisQty.get(v.id) ?? 0;
      const pend = pending.get(v.id) ?? 0;
      const shortfall = Math.max(0, Math.max(0, forecast - ordered) + pend - v.stock);
      rows.push({ variantId: v.id, itemName: it.name, category: it.category, size: v.size, sizeOrder: v.sizeOrder, lastYear: lastQty.get(v.id) ?? 0, forecast, orderedThisYear: ordered, pendingOut: pend, stock: v.stock, shortfall, lastCost: toNum(v.prices[0]?.price) });
    }
  }
  return { year, lastYear: last, steps, rows };
}

/** Everything the order builder needs for one student: catalogue for their gender, suggested sizes and their uniform set. */
export async function orderBuilderData(branchId: string, student: { id: string; classId: string; gender: Gender; schoolClass?: { grade: number } }, isPreOrder: boolean) {
  const year = isPreOrder ? (await preorderYear()) ?? (await currentYear()) : await currentYear();
  const cur = await currentYear();
  // Pre-orders for a future year use next year's class set
  let classId = student.classId;
  if (isPreOrder && year.startDate > cur.startDate) {
    const c = await db.schoolClass.findUnique({ where: { id: student.classId } });
    const next = c ? await db.schoolClass.findFirst({ where: { branchId, grade: c.grade + 1 } }) : null;
    if (next) classId = next.id;
  }
  const [items, suggestions, set] = await Promise.all([
    db.uniformItem.findMany({
      where: { branchId, isActive: true, gender: { in: gendersFor(student.gender) } },
      include: { variants: { where: { isActive: true }, orderBy: { sizeOrder: "asc" } } },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    suggestSizes(student.id, year.startDate),
    setForStudent(branchId, classId, student.gender),
  ]);
  return {
    year: { id: year.id, name: year.name },
    catalog: items.filter((i) => i.variants.length).map((i) => ({
      id: i.id, name: i.name, category: i.category,
      variants: i.variants.map((v) => ({ id: v.id, size: v.size, price: toNum(v.price), stock: v.stock })),
    })),
    suggestions: Object.fromEntries([...suggestions.values()].map((s) => [s.itemId, { variantId: s.variantId, size: s.size, lastSize: s.lastSize, movedUp: s.movedUp }])),
    set: set ? { name: set.name, items: set.items.map((x) => ({ itemId: x.itemId, qty: x.qty })) } : null,
  };
}
export type OrderBuilderData = Awaited<ReturnType<typeof orderBuilderData>>;

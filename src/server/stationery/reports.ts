import "server-only";
import type { Prisma } from "@prisma/client";
import type { ReportDef } from "@/lib/reports/types";
import { dateWhere } from "@/lib/reports/parse";
import { db } from "@/lib/db";
import { round2, toNum } from "@/lib/format";
import { lowStockIds } from "./core";

const monthKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
const monthLabel = (k: string) => new Date(k + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

const usage: ReportDef = {
  key: "stationery-usage",
  title: "Stationery usage",
  description: "Items issued (less returns) by month, class, teacher or item. Value = quantity × unit cost at issue.",
  module: "Stationery",
  perm: "reports.stationery",
  filters: ["dateRange", "class", "item", "teacher"],
  groupBy: [{ value: "month", label: "Month" }, { value: "class", label: "Class / department" }, { value: "teacher", label: "Teacher" }, { value: "item", label: "Item" }],
  async run(f, { branchId }) {
    const where: Prisma.StockMovementWhereInput = {
      item: { branchId }, type: { in: ["ISSUE", "RETURN"] }, createdAt: dateWhere(f),
      ...(f.classId ? { classId: f.classId } : {}), ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.teacherId ? { OR: [{ recipientUserId: f.teacherId }, { request: { requestedById: f.teacherId } }] } : {}),
    };
    const rows = await db.stockMovement.findMany({
      where, include: { item: true, schoolClass: true, department: true, recipientUser: { select: { name: true } }, request: { select: { requestedBy: { select: { name: true } } } } },
      orderBy: { createdAt: "asc" },
    });
    const g = f.groupBy ?? "month";
    const map = new Map<string, { label: string; qty: number; value: number; issues: number; sort: string }>();
    for (const m of rows) {
      let key: string, label: string;
      if (g === "class") { key = m.classId ?? m.departmentId ?? "-"; label = m.schoolClass?.name ?? (m.department ? `${m.department.name} (dept)` : "Not charged"); }
      else if (g === "teacher") { const n = m.recipientUser?.name ?? m.request?.requestedBy.name; key = n ?? "-"; label = n ?? "Students / classes"; }
      else if (g === "item") { key = m.itemId; label = m.item.name; }
      else { key = monthKey(m.createdAt); label = monthLabel(key); }
      const e = map.get(key) ?? { label, qty: 0, value: 0, issues: 0, sort: g === "class" ? String(m.schoolClass?.grade ?? 99).padStart(3, "0") + label : g === "month" ? key : label };
      e.qty += -m.qty;
      e.value += -m.qty * toNum(m.unitCost);
      if (m.type === "ISSUE") e.issues++;
      map.set(key, e);
    }
    const list = [...map.values()].sort((a, b) => (g === "item" || g === "teacher" ? b.value - a.value : a.sort.localeCompare(b.sort)));
    const label = usage.groupBy!.find((x) => x.value === g)?.label ?? "Group";
    return {
      columns: [{ key: "label", label }, { key: "issues", label: "Issues", format: "number", align: "right" }, { key: "qty", label: "Quantity", format: "number", align: "right" }, { key: "value", label: "Value", format: "money", align: "right" }],
      rows: list.map((r) => ({ label: r.label, issues: r.issues, qty: r.qty, value: round2(r.value) })),
      totals: { label: "Total", issues: list.reduce((s, r) => s + r.issues, 0), qty: list.reduce((s, r) => s + r.qty, 0), value: round2(list.reduce((s, r) => s + r.value, 0)) },
      chart: { type: g === "month" ? "line" : "bar", x: "label", y: ["value"] },
    };
  },
};

const valuation: ReportDef = {
  key: "stationery-valuation",
  title: "Stock valuation",
  description: "Current stock of every item valued at its unit cost.",
  module: "Stationery",
  perm: "reports.stationery",
  filters: ["item", "supplier"],
  groupBy: [{ value: "item", label: "Item" }, { value: "category", label: "Category" }],
  async run(f, { branchId }) {
    const items = await db.stationeryItem.findMany({
      where: { branchId, isActive: true, ...(f.itemId ? { id: f.itemId } : {}), ...(f.supplierId ? { preferredSupplierId: f.supplierId } : {}) },
      include: { preferredSupplier: { select: { name: true } } }, orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    if (f.groupBy === "category") {
      const map = new Map<string, { category: string; items: number; qty: number; value: number }>();
      for (const i of items) {
        const e = map.get(i.category) ?? { category: i.category, items: 0, qty: 0, value: 0 };
        e.items++; e.qty += i.currentStock; e.value += i.currentStock * toNum(i.unitCost);
        map.set(i.category, e);
      }
      const rows = [...map.values()].map((r) => ({ ...r, value: round2(r.value) }));
      return {
        columns: [{ key: "category", label: "Category" }, { key: "items", label: "Items", format: "number", align: "right" }, { key: "qty", label: "Stock", format: "number", align: "right" }, { key: "value", label: "Value", format: "money", align: "right" }],
        rows, totals: { category: "Total", items: items.length, qty: rows.reduce((s, r) => s + r.qty, 0), value: round2(rows.reduce((s, r) => s + r.value, 0)) },
        chart: { type: "bar", x: "category", y: ["value"] },
      };
    }
    const rows = items.map((i) => ({ code: i.code, name: i.name, category: i.category, supplier: i.preferredSupplier?.name ?? "—", stock: i.currentStock, unit: i.unit, unitCost: toNum(i.unitCost), value: round2(i.currentStock * toNum(i.unitCost)) }));
    return {
      columns: [{ key: "code", label: "Code" }, { key: "name", label: "Item" }, { key: "category", label: "Category" }, { key: "supplier", label: "Usual supplier" }, { key: "stock", label: "Stock", format: "number", align: "right" }, { key: "unit", label: "Unit" }, { key: "unitCost", label: "Unit cost", format: "money", align: "right" }, { key: "value", label: "Value", format: "money", align: "right" }],
      rows, totals: { code: "Total", stock: rows.reduce((s, r) => s + r.stock, 0), value: round2(rows.reduce((s, r) => s + r.value, 0)) },
    };
  },
};

const purchases: ReportDef = {
  key: "stationery-purchases",
  title: "Purchase history by supplier",
  description: "Goods received from suppliers (quantity × purchase price).",
  module: "Stationery",
  perm: "reports.stationery",
  filters: ["dateRange", "supplier", "item"],
  groupBy: [{ value: "supplier", label: "Supplier" }, { value: "month", label: "Month" }, { value: "detail", label: "Each receipt" }],
  async run(f, { branchId }) {
    const moves = await db.stockMovement.findMany({
      where: { item: { branchId }, type: "PURCHASE", createdAt: dateWhere(f), ...(f.itemId ? { itemId: f.itemId } : {}) },
      include: { item: true }, orderBy: { createdAt: "asc" },
    });
    const poIds = [...new Set(moves.map((m) => m.poId).filter(Boolean))] as string[];
    const pos = await db.purchaseOrder.findMany({ where: { id: { in: poIds } }, include: { supplier: { select: { id: true, name: true } } } });
    const poMap = new Map(pos.map((p) => [p.id, p]));
    const rowsAll = moves
      .map((m) => ({ m, po: m.poId ? poMap.get(m.poId) : undefined }))
      .filter((x) => !f.supplierId || x.po?.supplierId === f.supplierId);
    const g = f.groupBy ?? "supplier";
    if (g === "detail") {
      const rows = rowsAll.map(({ m, po }) => ({ date: m.createdAt, poNumber: po?.poNumber ?? "—", supplier: po?.supplier.name ?? "Without order", item: m.item.name, qty: m.qty, price: toNum(m.unitCost), value: round2(m.qty * toNum(m.unitCost)) }));
      return {
        columns: [{ key: "date", label: "Date", format: "date" }, { key: "poNumber", label: "PO" }, { key: "supplier", label: "Supplier" }, { key: "item", label: "Item" }, { key: "qty", label: "Qty", format: "number", align: "right" }, { key: "price", label: "Price", format: "money", align: "right" }, { key: "value", label: "Value", format: "money", align: "right" }],
        rows, totals: { date: null, poNumber: "Total", qty: rows.reduce((s, r) => s + r.qty, 0), value: round2(rows.reduce((s, r) => s + r.value, 0)) },
      };
    }
    const map = new Map<string, { label: string; orders: Set<string>; qty: number; value: number }>();
    for (const { m, po } of rowsAll) {
      const key = g === "month" ? monthKey(m.createdAt) : po?.supplierId ?? "-";
      const label = g === "month" ? monthLabel(key) : po?.supplier.name ?? "Without order";
      const e = map.get(key) ?? { label, orders: new Set<string>(), qty: 0, value: 0 };
      if (m.poId) e.orders.add(m.poId);
      e.qty += m.qty; e.value += m.qty * toNum(m.unitCost);
      map.set(key, e);
    }
    const entries = [...map.entries()].sort((a, b) => (g === "month" ? a[0].localeCompare(b[0]) : b[1].value - a[1].value));
    const rows = entries.map(([, e]) => ({ label: e.label, orders: e.orders.size, qty: e.qty, value: round2(e.value) }));
    return {
      columns: [{ key: "label", label: g === "month" ? "Month" : "Supplier" }, { key: "orders", label: "Orders", format: "number", align: "right" }, { key: "qty", label: "Quantity", format: "number", align: "right" }, { key: "value", label: "Value", format: "money", align: "right" }],
      rows, totals: { label: "Total", orders: new Set(rowsAll.map((x) => x.m.poId).filter(Boolean)).size, qty: rows.reduce((s, r) => s + r.qty, 0), value: round2(rows.reduce((s, r) => s + r.value, 0)) },
      chart: { type: "bar", x: "label", y: ["value"] },
    };
  },
};

const lowStock: ReportDef = {
  key: "stationery-low-stock",
  title: "Low stock",
  description: "Items at or below their reorder level, with the suggested order quantity.",
  module: "Stationery",
  perm: "reports.stationery",
  filters: ["supplier", "item"],
  async run(f, { branchId }) {
    const ids = await lowStockIds(branchId);
    const items = await db.stationeryItem.findMany({
      where: { id: { in: ids }, ...(f.itemId ? { id: f.itemId } : {}), ...(f.supplierId ? { preferredSupplierId: f.supplierId } : {}) },
      include: { preferredSupplier: { select: { name: true } } }, orderBy: { currentStock: "asc" },
    });
    const rows = items.filter((i) => ids.includes(i.id)).map((i) => {
      const order = i.reorderQty > 0 ? i.reorderQty : Math.max(i.reorderLevel * 2 - i.currentStock, 1);
      return { code: i.code, name: i.name, category: i.category, stock: i.currentStock, reorderLevel: i.reorderLevel, orderQty: order, supplier: i.preferredSupplier?.name ?? "—", cost: round2(order * toNum(i.unitCost)) };
    });
    return {
      columns: [{ key: "code", label: "Code" }, { key: "name", label: "Item" }, { key: "category", label: "Category" }, { key: "stock", label: "Stock", format: "number", align: "right" }, { key: "reorderLevel", label: "Reorder level", format: "number", align: "right" }, { key: "orderQty", label: "Order qty", format: "number", align: "right" }, { key: "supplier", label: "Usual supplier" }, { key: "cost", label: "Est. cost", format: "money", align: "right" }],
      rows, totals: { code: "Total", cost: round2(rows.reduce((s, r) => s + r.cost, 0)) },
      note: rows.length ? undefined : "No items are at or below their reorder level.",
    };
  },
};

export const stationeryReports: ReportDef[] = [usage, valuation, purchases, lowStock];

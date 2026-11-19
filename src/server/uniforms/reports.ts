import "server-only";
import type { Prisma, UniformOrderStatus } from "@prisma/client";
import type { ReportDef } from "@/lib/reports/types";
import { dateWhere } from "@/lib/reports/parse";
import { db } from "@/lib/db";
import { fullName, round2, toNum, daysBetween, today } from "@/lib/format";
import { openDemand } from "./queries";

const distribution: ReportDef = {
  key: "uniform-distribution",
  title: "Uniform distribution",
  description: "Items delivered to students (net of returns) by item and size or by class. Date = delivery date.",
  module: "Uniforms",
  perm: "reports.uniforms",
  filters: ["dateRange", "class", "uniformItem", "year"],
  groupBy: [{ value: "itemSize", label: "Item and size" }, { value: "class", label: "Class" }, { value: "item", label: "Item" }],
  async run(f, { branchId }) {
    const where: Prisma.UniformOrderLineWhereInput = {
      order: {
        branchId, status: "DELIVERED", deliveredAt: dateWhere(f),
        ...(f.classId ? { student: { classId: f.classId } } : {}), ...(f.yearId ? { academicYearId: f.yearId } : {}),
      },
      ...(f.uniformItemId ? { variant: { itemId: f.uniformItemId } } : {}),
    };
    const lines = await db.uniformOrderLine.findMany({ where, include: { variant: { include: { item: true } }, order: { include: { student: { include: { schoolClass: true } } } } } });
    const g = f.groupBy ?? "itemSize";
    const map = new Map<string, { item: string; size: string; class: string; qty: number; amount: number; students: Set<string>; sort: string }>();
    for (const l of lines) {
      const qty = l.qty - l.qtyReturned;
      if (qty <= 0) continue;
      const cls = l.order.student.schoolClass;
      const key = g === "class" ? cls.id : g === "item" ? l.variant.itemId : l.variantId;
      const sort = g === "class" ? String(cls.grade + 10).padStart(3, "0") : `${l.variant.item.name}|${String(l.variant.sizeOrder).padStart(6, "0")}`;
      const e = map.get(key) ?? { item: g === "class" ? "All items" : l.variant.item.name, size: g === "itemSize" ? l.variant.size : "All", class: g === "class" ? cls.name : "All classes", qty: 0, amount: 0, students: new Set<string>(), sort };
      e.qty += qty;
      e.amount = round2(e.amount + qty * toNum(l.unitPrice));
      e.students.add(l.order.studentId);
      map.set(key, e);
    }
    const rows = [...map.values()].sort((a, b) => a.sort.localeCompare(b.sort)).map((e) => ({ item: e.item, size: e.size, class: e.class, students: e.students.size, qty: e.qty, amount: e.amount, label: g === "class" ? e.class : g === "item" ? e.item : `${e.item} ${e.size}` }));
    const columns = [
      ...(g === "class" ? [{ key: "class", label: "Class" }] : [{ key: "item", label: "Item" }]),
      ...(g === "itemSize" ? [{ key: "size", label: "Size" }] : []),
      { key: "students", label: "Students", format: "number" as const, align: "right" as const },
      { key: "qty", label: "Qty delivered", format: "number" as const, align: "right" as const },
      { key: "amount", label: "Value", format: "money" as const, align: "right" as const },
    ];
    return {
      columns, rows,
      totals: { [columns[0].key]: "Total", qty: rows.reduce((s, r) => s + r.qty, 0), amount: round2(rows.reduce((s, r) => s + r.amount, 0)) },
      chart: rows.length ? { type: "bar", x: "label", y: ["qty"] } : undefined,
    };
  },
};

const demand: ReportDef = {
  key: "uniform-size-demand",
  title: "Size-wise demand",
  description: "Quantity on open orders and pre-orders (not yet set aside) by item and size, against current stock.",
  module: "Uniforms",
  perm: "reports.uniforms",
  filters: ["uniformItem", "year"],
  async run(f, { branchId }) {
    const [all, pre] = await Promise.all([openDemand(branchId, { academicYearId: f.yearId }), openDemand(branchId, { academicYearId: f.yearId, isPreOrder: true })]);
    const variants = await db.uniformVariant.findMany({
      where: { id: { in: [...all.keys()] }, ...(f.uniformItemId ? { itemId: f.uniformItemId } : {}) },
      include: { item: true }, orderBy: [{ item: { name: "asc" } }, { sizeOrder: "asc" }],
    });
    const rows = variants.map((v) => {
      const d = all.get(v.id) ?? 0;
      const p = pre.get(v.id) ?? 0;
      return { item: v.item.name, size: v.size, orders: d - p, preorders: p, demand: d, stock: v.stock, shortfall: Math.max(0, d - v.stock), label: `${v.item.name} ${v.size}` };
    });
    const sum = (k: "orders" | "preorders" | "demand" | "shortfall") => rows.reduce((s, r) => s + r[k], 0);
    return {
      columns: [
        { key: "item", label: "Item" }, { key: "size", label: "Size" },
        { key: "orders", label: "Orders", format: "number", align: "right" }, { key: "preorders", label: "Pre-orders", format: "number", align: "right" },
        { key: "demand", label: "Total demand", format: "number", align: "right" }, { key: "stock", label: "In stock", format: "number", align: "right" },
        { key: "shortfall", label: "Shortfall", format: "number", align: "right" },
      ],
      rows,
      totals: { item: "Total", orders: sum("orders"), preorders: sum("preorders"), demand: sum("demand"), shortfall: sum("shortfall") },
      chart: rows.length ? { type: "bar", x: "label", y: ["demand", "stock"] } : undefined,
      note: "Stock is set aside when an order is marked Ready, so only Ordered and Paid orders count as demand.",
    };
  },
};

const pending: ReportDef = {
  key: "uniform-pending-deliveries",
  title: "Pending deliveries",
  description: "Orders not yet delivered (Ordered, Paid or Ready), oldest first. Date = order date.",
  module: "Uniforms",
  perm: "reports.uniforms",
  filters: ["dateRange", "class", "status", "year"],
  statusFilter: { label: "All open orders", options: [{ value: "ORDERED", label: "Ordered" }, { value: "PAID", label: "Paid" }, { value: "READY", label: "Ready for pickup" }] },
  async run(f, { branchId }) {
    const statuses: UniformOrderStatus[] = f.status && ["ORDERED", "PAID", "READY"].includes(f.status) ? [f.status as UniformOrderStatus] : ["ORDERED", "PAID", "READY"];
    const orders = await db.uniformOrder.findMany({
      where: { branchId, status: { in: statuses }, createdAt: dateWhere(f), ...(f.classId ? { student: { classId: f.classId } } : {}), ...(f.yearId ? { academicYearId: f.yearId } : {}) },
      include: { student: { include: { schoolClass: true, section: true } }, lines: true },
      orderBy: { createdAt: "asc" },
    });
    const t = today();
    const rows = orders.map((o) => ({
      orderNo: o.orderNo, date: o.createdAt, student: fullName(o.student), admissionNo: o.student.admissionNo,
      class: o.student.section ? `${o.student.schoolClass.name} - ${o.student.section.name}` : o.student.schoolClass.name,
      type: o.isPreOrder ? "Pre-order" : "Order", status: o.status.charAt(0) + o.status.slice(1).toLowerCase(),
      items: o.lines.reduce((s, l) => s + l.qty - l.qtyReturned, 0), total: toNum(o.total), balance: round2(toNum(o.total) - toNum(o.paidAmount)),
      days: daysBetween(o.createdAt, t),
    }));
    return {
      columns: [
        { key: "orderNo", label: "Order no" }, { key: "date", label: "Ordered", format: "date" }, { key: "student", label: "Student" },
        { key: "admissionNo", label: "Adm. no" }, { key: "class", label: "Class" }, { key: "type", label: "Type" }, { key: "status", label: "Status" },
        { key: "items", label: "Items", format: "number", align: "right" }, { key: "total", label: "Total", format: "money", align: "right" },
        { key: "balance", label: "Balance", format: "money", align: "right" }, { key: "days", label: "Days waiting", format: "number", align: "right" },
      ],
      rows,
      totals: { orderNo: "Total", items: rows.reduce((s, r) => s + r.items, 0), total: round2(rows.reduce((s, r) => s + r.total, 0)), balance: round2(rows.reduce((s, r) => s + r.balance, 0)) },
    };
  },
};

export const uniformReports: ReportDef[] = [distribution, demand, pending];

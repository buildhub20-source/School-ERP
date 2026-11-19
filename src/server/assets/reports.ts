import "server-only";
import type { ReportDef } from "@/lib/reports/types";
import { dateWhere } from "@/lib/reports/parse";
import { db } from "@/lib/db";
import { round2, today, toNum } from "@/lib/format";
import { STATUS_LABEL, depreciation } from "./service";

const register: ReportDef = {
  key: "assets-register", title: "Asset register", module: "Assets", perm: "reports.assets",
  description: "Every asset with cost, depreciation to date and book value, or totals by category or location.",
  filters: ["status"],
  statusFilter: { label: "Not disposed", options: [{ value: "IN_USE", label: "In use" }, { value: "IN_STORE", label: "In store" }, { value: "UNDER_REPAIR", label: "Under repair" }, { value: "LOST", label: "Lost" }, { value: "DISPOSED", label: "Disposed" }] },
  groupBy: [{ value: "asset", label: "Asset" }, { value: "category", label: "Category" }, { value: "location", label: "Location" }],
  async run(f, { branchId }) {
    const t = today();
    const assets = await db.asset.findMany({ where: { branchId, status: f.status ? (f.status as "IN_USE") : { not: "DISPOSED" } }, orderBy: { code: "asc" } });
    const vals = assets.map((a) => ({ a, d: a.status === "DISPOSED" ? { accumulated: 0, bookValue: 0 } : depreciation(a, t) }));
    if (f.groupBy === "category" || f.groupBy === "location") {
      const key = f.groupBy;
      const map = new Map<string, { count: number; cost: number; dep: number; book: number }>();
      for (const { a, d } of vals) {
        const k = (key === "category" ? a.category : a.location) ?? "No location";
        const e = map.get(k) ?? { count: 0, cost: 0, dep: 0, book: 0 };
        e.count++; e.cost += toNum(a.cost); e.dep += d.accumulated; e.book += d.bookValue;
        map.set(k, e);
      }
      const rows = [...map.entries()].sort((x, y) => y[1].book - x[1].book).map(([group, e]) => ({ group, count: e.count, cost: round2(e.cost), dep: round2(e.dep), book: round2(e.book) }));
      return {
        columns: [{ key: "group", label: key === "category" ? "Category" : "Location" }, { key: "count", label: "Assets", format: "number" }, { key: "cost", label: "Cost", format: "money" }, { key: "dep", label: "Depreciation", format: "money" }, { key: "book", label: "Book value", format: "money" }],
        rows, totals: { group: "Total", count: rows.reduce((s, r) => s + r.count, 0), cost: round2(rows.reduce((s, r) => s + r.cost, 0)), dep: round2(rows.reduce((s, r) => s + r.dep, 0)), book: round2(rows.reduce((s, r) => s + r.book, 0)) },
        chart: rows.length ? { type: "bar", x: "group", y: ["book"] } : undefined,
      };
    }
    const rows = vals.map(({ a, d }) => ({ code: a.code, name: a.name, category: a.category, location: a.location ?? "", status: STATUS_LABEL[a.status], purchased: a.purchaseDate, cost: toNum(a.cost), dep: d.accumulated, book: d.bookValue }));
    return {
      columns: [{ key: "code", label: "Code" }, { key: "name", label: "Asset" }, { key: "category", label: "Category" }, { key: "location", label: "Location" }, { key: "status", label: "Status" }, { key: "purchased", label: "Purchased", format: "date" }, { key: "cost", label: "Cost", format: "money" }, { key: "dep", label: "Depreciation", format: "money" }, { key: "book", label: "Book value", format: "money" }],
      rows, totals: { code: `${rows.length} assets`, cost: round2(rows.reduce((s, r) => s + r.cost, 0)), dep: round2(rows.reduce((s, r) => s + r.dep, 0)), book: round2(rows.reduce((s, r) => s + r.book, 0)) },
    };
  },
};

const repairs: ReportDef = {
  key: "assets-repairs", title: "Asset repairs", module: "Assets", perm: "reports.assets",
  description: "Repairs and services recorded in the period, with their cost.",
  filters: ["dateRange"],
  async run(f, { branchId }) {
    const events = await db.assetEvent.findMany({ where: { type: "REPAIR", asset: { branchId }, date: dateWhere(f) }, include: { asset: true }, orderBy: { date: "desc" } });
    const rows = events.map((e) => ({ date: e.date, code: e.asset.code, name: e.asset.name, category: e.asset.category, notes: e.notes ?? "", cost: toNum(e.cost), by: e.byName ?? "" }));
    return {
      columns: [{ key: "date", label: "Date", format: "date" }, { key: "code", label: "Code" }, { key: "name", label: "Asset" }, { key: "category", label: "Category" }, { key: "notes", label: "Details" }, { key: "cost", label: "Cost", format: "money" }, { key: "by", label: "Recorded by" }],
      rows, totals: { date: null, code: `${rows.length} entries`, cost: round2(rows.reduce((s, r) => s + r.cost, 0)) },
    };
  },
};

const disposals: ReportDef = {
  key: "assets-disposals", title: "Asset disposals", module: "Assets", perm: "reports.assets",
  description: "Assets sold, scrapped or written off, with book value at disposal and the gain or loss.",
  filters: ["dateRange"],
  async run(f, { branchId }) {
    const assets = await db.asset.findMany({ where: { branchId, status: "DISPOSED", disposedOn: dateWhere(f, true) }, orderBy: { disposedOn: "desc" } });
    const rows = assets.map((a) => {
      const book = depreciation(a, a.disposedOn ?? today()).bookValue;
      const value = toNum(a.disposalValue);
      return { date: a.disposedOn, code: a.code, name: a.name, reason: a.disposalReason ?? "", cost: toNum(a.cost), book, value, gain: round2(value - book) };
    });
    return {
      columns: [{ key: "date", label: "Disposed", format: "date" }, { key: "code", label: "Code" }, { key: "name", label: "Asset" }, { key: "reason", label: "Reason" }, { key: "cost", label: "Cost", format: "money" }, { key: "book", label: "Book value then", format: "money" }, { key: "value", label: "Received", format: "money" }, { key: "gain", label: "Gain / loss", format: "money" }],
      rows, totals: { date: null, code: `${rows.length} assets`, cost: round2(rows.reduce((s, r) => s + r.cost, 0)), book: round2(rows.reduce((s, r) => s + r.book, 0)), value: round2(rows.reduce((s, r) => s + r.value, 0)), gain: round2(rows.reduce((s, r) => s + r.gain, 0)) },
    };
  },
};

export const assetReports: ReportDef[] = [register, repairs, disposals];

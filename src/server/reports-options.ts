import "server-only";
import { db } from "@/lib/db";
import type { FilterKey } from "@/lib/reports/types";

export type FilterOptions = Partial<Record<FilterKey, { value: string; label: string }[]>>;

/** Dropdown options for the filters a report uses. */
export async function filterOptions(branchId: string, keys: FilterKey[]): Promise<FilterOptions> {
  const out: FilterOptions = {};
  const has = (k: FilterKey) => keys.includes(k);
  await Promise.all([
    has("class") && db.schoolClass.findMany({ where: { branchId }, orderBy: { grade: "asc" } }).then((r) => (out.class = r.map((x) => ({ value: x.id, label: x.name })))),
    has("section") && db.section.findMany({ where: { schoolClass: { branchId } }, include: { schoolClass: true }, orderBy: [{ schoolClass: { grade: "asc" } }, { name: "asc" }] }).then((r) => (out.section = r.map((x) => ({ value: x.id, label: `${x.schoolClass.name}-${x.name}` })))),
    has("item") && db.stationeryItem.findMany({ where: { branchId }, orderBy: { name: "asc" } }).then((r) => (out.item = r.map((x) => ({ value: x.id, label: x.name })))),
    has("uniformItem") && db.uniformItem.findMany({ where: { branchId }, orderBy: { name: "asc" } }).then((r) => (out.uniformItem = r.map((x) => ({ value: x.id, label: x.name })))),
    has("route") && db.route.findMany({ where: { branchId }, orderBy: { code: "asc" } }).then((r) => (out.route = r.map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` })))),
    has("bus") && db.bus.findMany({ where: { branchId }, orderBy: { busNo: "asc" } }).then((r) => (out.bus = r.map((x) => ({ value: x.id, label: x.busNo })))),
    has("term") && db.term.findMany({ include: { academicYear: true }, orderBy: [{ academicYear: { startDate: "desc" } }, { sequence: "asc" }] }).then((r) => (out.term = r.map((x) => ({ value: x.id, label: `${x.academicYear.name} ${x.name}` })))),
    has("supplier") && db.supplier.findMany({ where: { branchId }, orderBy: { name: "asc" } }).then((r) => (out.supplier = r.map((x) => ({ value: x.id, label: x.name })))),
    has("teacher") && db.user.findMany({ where: { branchId, role: { key: { notIn: ["PARENT", "DRIVER"] } } }, orderBy: { name: "asc" } }).then((r) => (out.teacher = r.map((x) => ({ value: x.id, label: x.name })))),
    has("year") && db.academicYear.findMany({ orderBy: { startDate: "desc" } }).then((r) => (out.year = r.map((x) => ({ value: x.id, label: x.name })))),
  ]);
  if (has("mode")) out.mode = ["CASH", "CHEQUE", "UPI", "CARD", "NETBANKING", "BANK_TRANSFER"].map((m) => ({ value: m, label: m.replace("_", " ") }));
  return out;
}

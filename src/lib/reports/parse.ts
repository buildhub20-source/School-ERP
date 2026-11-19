import type { ReportFilters } from "./types";

/** Parse report filters from URL search params. Dates are inclusive (to = end of day). */
export function parseFilters(sp: Record<string, string | string[] | undefined> | URLSearchParams): ReportFilters {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s ? s : undefined;
  };
  const from = get("from");
  const to = get("to");
  return {
    from: from ? new Date(from + "T00:00:00.000Z") : undefined,
    to: to ? new Date(to + "T23:59:59.999Z") : undefined,
    classId: get("classId"), sectionId: get("sectionId"), itemId: get("itemId"), uniformItemId: get("uniformItemId"),
    routeId: get("routeId"), busId: get("busId"), termId: get("termId"), mode: get("mode"), supplierId: get("supplierId"),
    teacherId: get("teacherId"), yearId: get("yearId"), status: get("status"), groupBy: get("groupBy"),
  };
}

/** Date-range where clause for a field (inclusive). Dates are stored UTC; IST offset is applied for timestamps. */
export function dateWhere(f: ReportFilters, isDateColumn = false) {
  if (!f.from && !f.to) return undefined;
  const shift = isDateColumn ? 0 : -330 * 60000; // IST midnight → UTC
  return {
    ...(f.from ? { gte: new Date(f.from.getTime() + shift) } : {}),
    ...(f.to ? { lte: new Date(f.to.getTime() + shift) } : {}),
  };
}

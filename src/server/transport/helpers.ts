/** Pure transport helpers (safe to import from client components). */

export type LatLng = { lat: number; lng: number };

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Length of a path through the points, in km (straight lines between consecutive points). */
export function pathKm(points: LatLng[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += haversineMeters(points[i - 1], points[i]);
  return Math.round(m / 10) / 100;
}

export type DocStatus = "VALID" | "EXPIRING" | "EXPIRED";

const DAY = 86400000;

/** VALID / EXPIRING (within `daysBefore`) / EXPIRED, comparing date-only values. */
export function docStatus(expiryDate: Date, todayDate: Date, daysBefore = 30): DocStatus {
  const diff = Math.round((expiryDate.getTime() - todayDate.getTime()) / DAY);
  if (diff < 0) return "EXPIRED";
  if (diff <= daysBefore) return "EXPIRING";
  return "VALID";
}

export function daysUntil(d: Date, todayDate: Date) {
  return Math.round((d.getTime() - todayDate.getTime()) / DAY);
}

export const DOC_TYPES = ["INSURANCE", "FITNESS", "PERMIT", "POLLUTION", "DRIVER_LICENCE", "OTHER"] as const;
export const DOC_LABELS: Record<string, string> = {
  INSURANCE: "Insurance", FITNESS: "Fitness certificate", PERMIT: "Permit", POLLUTION: "Pollution certificate", DRIVER_LICENCE: "Driver licence", OTHER: "Other",
};

export type ServiceDueInfo = { nextDate: Date; nextKm: number; dueByDate: boolean; dueByKm: boolean; overdue: boolean; reason: string | null };

/** When the next service falls due, by date (last service + interval days) or km (last service km + interval km). */
export function serviceDueInfo(
  bus: { lastServiceDate: Date | null; lastServiceKm: number | null; serviceIntervalDays: number; serviceIntervalKm: number; odometerKm: number; createdAt: Date },
  todayDate: Date,
  opts: { daysAhead: number; kmAhead: number },
): ServiceDueInfo {
  const base = bus.lastServiceDate ?? new Date(Date.UTC(bus.createdAt.getUTCFullYear(), bus.createdAt.getUTCMonth(), bus.createdAt.getUTCDate()));
  const nextDate = new Date(base.getTime() + bus.serviceIntervalDays * DAY);
  const nextKm = (bus.lastServiceKm ?? 0) + bus.serviceIntervalKm;
  const daysLeft = Math.round((nextDate.getTime() - todayDate.getTime()) / DAY);
  const kmLeft = nextKm - bus.odometerKm;
  const dueByDate = daysLeft <= opts.daysAhead;
  const dueByKm = kmLeft <= opts.kmAhead;
  const overdue = daysLeft < 0 || kmLeft < 0;
  const parts: string[] = [];
  if (dueByDate) parts.push(daysLeft < 0 ? `service overdue by ${-daysLeft} day${daysLeft === -1 ? "" : "s"}` : `service due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`);
  if (dueByKm) parts.push(kmLeft < 0 ? `${-kmLeft} km past service interval` : `service due in ${kmLeft} km`);
  return { nextDate, nextKm, dueByDate, dueByKm, overdue, reason: parts.length ? parts.join("; ") : null };
}

/** Student ID card QR text is a URL ending /verify/student/<studentId>. */
export function studentIdFromQr(text: string): string | null {
  const m = text.trim().match(/\/verify\/student\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/);
  return m ? m[1] : null;
}

export const ROUTE_COLORS = ["#4f46e5", "#059669", "#dc2626", "#d97706", "#0891b2", "#7c3aed", "#db2777", "#65a30d", "#0f766e", "#9333ea"];

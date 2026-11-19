import type { Prisma } from "@prisma/client";

type Num = number | string | Prisma.Decimal | null | undefined;

export function toNum(v: Num): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  return Number(v.toString());
}

/** Round to 2 decimals (paise). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** ₹ amount: whole rupees without decimals, otherwise always two decimals (₹1,250 · ₹1,250.50). */
export function money(v: Num): string {
  const n = round2(toNum(v));
  return Number.isInteger(n) ? inr0.format(n) : inr2.format(n);
}

const num = new Intl.NumberFormat("en-IN");
export function number(v: Num): string {
  return num.format(toNum(v));
}

const TZ = "Asia/Kolkata";
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
}
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
}
/** yyyy-mm-dd for <input type=date>, in school timezone. */
export function isoDate(d: Date | string | null | undefined = new Date()): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
  return parts;
}
/** Today's date at UTC midnight (matches @db.Date columns). */
export function today(): Date {
  return new Date(isoDate(new Date()) + "T00:00:00.000Z");
}
export function dateOnly(s: string | Date): Date {
  return new Date(isoDate(s) + "T00:00:00.000Z");
}
export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}
export function daysBetween(a: Date, b: Date): number {
  return Math.round((dateOnly(b).getTime() - dateOnly(a).getTime()) / 86400000);
}
export function fullName(s: { firstName: string; lastName?: string | null }): string {
  return [s.firstName, s.lastName].filter(Boolean).join(" ");
}
export function className(c?: { name: string } | null, s?: { name: string } | null): string {
  if (!c) return "—";
  return s ? `${c.name} - ${s.name}` : c.name;
}

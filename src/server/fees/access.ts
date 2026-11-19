import "server-only";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { AppError } from "@/lib/errors";

/**
 * Fee visibility for staff.
 * - "full": holds fees.view (Accountant, Admin, Super Admin) — every fee line and payment.
 * - "transport": holds only transport.fees.view (Transport Manager) — only TRANSPORT-type fee lines
 *   and the transport part of payments. Enforced in every query that uses these helpers.
 */
export type FeeScope = "full" | "transport";

export function feeScope(user: Pick<SessionUser, "roleKey" | "permissions">): FeeScope | null {
  if (hasPerm(user, "fees.view")) return "full";
  if (hasPerm(user, "transport.fees.view")) return "transport";
  return null;
}

export function requireFeeScope(user: Pick<SessionUser, "roleKey" | "permissions">): FeeScope {
  const s = feeScope(user);
  if (!s) throw new AppError("You do not have permission to see fee details.", "FORBIDDEN");
  return s;
}

/** Extra where-clause for StudentFee queries under a scope. */
export function lineScopeWhere(scope: FeeScope): Prisma.StudentFeeWhereInput {
  return scope === "transport" ? { feeHead: { type: "TRANSPORT" } } : {};
}

/** IST calendar day → UTC timestamp range [gte, lt). `day` is a yyyy-mm-dd string or a @db.Date value. */
export function istDayRange(day: string | Date) {
  const iso = typeof day === "string" ? day : day.toISOString().slice(0, 10);
  const start = new Date(new Date(iso + "T00:00:00.000Z").getTime() - 330 * 60000);
  return { gte: start, lt: new Date(start.getTime() + 86400000) };
}

/** IST month containing `d` → UTC range. */
export function istMonthRange(d: Date) {
  const ist = new Date(d.getTime() + 330 * 60000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1) - 330 * 60000);
  const end = new Date(Date.UTC(y, m + 1, 1) - 330 * 60000);
  return { gte: start, lt: end };
}

export const MODE_LABEL: Record<string, string> = {
  CASH: "Cash", CHEQUE: "Cheque", UPI: "UPI", CARD: "Card", NETBANKING: "Net banking", BANK_TRANSFER: "Bank transfer",
};
export const MODES = ["CASH", "CHEQUE", "UPI", "CARD", "NETBANKING", "BANK_TRANSFER"] as const;

export const CONCESSION_LABEL: Record<string, string> = { SIBLING: "Sibling discount", STAFF_CHILD: "Staff child", MERIT: "Merit scholarship", OTHER: "Other" };

/** Indian-style amount in words (rupees and paise). */
export function amountInWords(n: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x: number) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? " " + ones[x % 10] : ""}`);
  const three = (x: number) => {
    const h = Math.floor(x / 100);
    const r = x % 100;
    return [h ? `${ones[h]} Hundred` : "", r ? two(r) : ""].filter(Boolean).join(" ");
  };
  const words = (x: number): string => {
    if (x === 0) return "Zero";
    const parts: string[] = [];
    const crore = Math.floor(x / 10000000);
    const lakh = Math.floor((x % 10000000) / 100000);
    const thousand = Math.floor((x % 100000) / 1000);
    const rest = x % 1000;
    if (crore) parts.push(`${words(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (rest) parts.push(three(rest));
    return parts.join(" ");
  };
  const rupees = Math.floor(Math.abs(n) + 1e-9);
  const paise = Math.round((Math.abs(n) - rupees) * 100);
  return `Rupees ${words(rupees)}${paise ? ` and ${two(paise)} Paise` : ""} Only`;
}

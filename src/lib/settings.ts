import { db } from "./db";

export type SchoolProfile = {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  affiliation: string;
  logoUrl: string;
  principalName: string;
  principalEmail: string;
};

export type Policies = {
  idleLogoutMinutes: number;
  sessionDays: number;
  defaulterDays: number;
  capacityPolicy: "BLOCK" | "WARN";
  transportFeeMode: "STOP" | "DISTANCE";
  transportFeeBasis: "TERM" | "ANNUAL";
  lateFee: { enabled: boolean; type: "FIXED" | "PER_DAY" | "PERCENT"; amount: number; graceDays: number; maxAmount: number };
  siblingDiscountPercent: number;
  staffChildDiscountPercent: number;
  receiptPrefix: string;
  gpsNearStopMeters: number;
  sizeGrowthSteps: number;
  /** Roles whose users must turn on two-step login before using the system. */
  requireTwoFactorRoles: string[];
};

export type LibraryRules = {
  studentLoanDays: number;
  staffLoanDays: number;
  maxBooksStudent: number;
  maxBooksStaff: number;
  maxRenewals: number;
  /** Fine per late day for students (₹); 0 = no fines. Staff are never fined. */
  finePerDay: number;
  graceDays: number;
  maxFine: number;
};

export type HrRules = {
  /** School start time for staff, HH:MM (IST). A check-in after start + grace counts as late. */
  workStart: string;
  lateGraceMinutes: number;
  /** Weekdays that are always off, e.g. ["Sunday"]. */
  weeklyOff: string[];
  /** Saturdays of the month that are off, e.g. [2, 4] for the 2nd and 4th Saturday. */
  offSaturdays: number[];
  /** Staff may check in and out from their phone. */
  selfCheckIn: boolean;
};

export type MealDay = { breakfast: string; lunch: string; snacks: string; dinner: string };
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export const DEFAULTS = {
  school: {
    name: "My School", tagline: "", address: "", phone: "", email: "", website: "", affiliation: "",
    logoUrl: "", principalName: "", principalEmail: "",
  } as SchoolProfile,
  policies: {
    idleLogoutMinutes: 30,
    sessionDays: 7,
    defaulterDays: 30,
    capacityPolicy: "BLOCK",
    transportFeeMode: "STOP",
    transportFeeBasis: "TERM",
    lateFee: { enabled: true, type: "FIXED", amount: 100, graceDays: 0, maxAmount: 1000 },
    siblingDiscountPercent: 10,
    staffChildDiscountPercent: 50,
    receiptPrefix: "RCPT",
    gpsNearStopMeters: 500,
    sizeGrowthSteps: 1,
    requireTwoFactorRoles: [],
  } as Policies,
  library: {
    studentLoanDays: 14, staffLoanDays: 30, maxBooksStudent: 2, maxBooksStaff: 5, maxRenewals: 2, finePerDay: 1, graceDays: 0, maxFine: 100,
  } as LibraryRules,
  hr: { workStart: "08:30", lateGraceMinutes: 10, weeklyOff: ["Sunday"], offSaturdays: [2], selfCheckIn: true } as HrRules,
  hostelMenu: Object.fromEntries(WEEKDAYS.map((d) => [d, { breakfast: "", lunch: "", snacks: "", dinner: "" }])) as Record<(typeof WEEKDAYS)[number], MealDay>,
};

type Key = keyof typeof DEFAULTS;

export async function getSetting<K extends Key>(key: K, branchId: string | null = null): Promise<(typeof DEFAULTS)[K]> {
  const rows = await db.setting.findMany({ where: { key, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] } });
  const global = rows.find((r) => r.branchId === null)?.value as object | undefined;
  const local = rows.find((r) => r.branchId === branchId && branchId)?.value as object | undefined;
  return { ...DEFAULTS[key], ...(global ?? {}), ...(local ?? {}) } as (typeof DEFAULTS)[K];
}

export async function saveSetting<K extends Key>(key: K, value: Partial<(typeof DEFAULTS)[K]>, branchId: string | null = null) {
  const current = await getSetting(key, branchId);
  const merged = { ...current, ...value };
  const existing = await db.setting.findFirst({ where: { key, branchId } });
  if (existing) await db.setting.update({ where: { id: existing.id }, data: { value: merged as object } });
  else await db.setting.create({ data: { key, branchId, value: merged as object } });
  return merged;
}

export async function currentAcademicYear() {
  const year = await db.academicYear.findFirst({ where: { isCurrent: true }, include: { terms: { orderBy: { sequence: "asc" } } } });
  return year;
}

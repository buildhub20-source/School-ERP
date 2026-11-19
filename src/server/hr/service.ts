import "server-only";
import type { EmploymentType, Gender, LeaveStatus, StaffAttendanceStatus, StaffCategory } from "@prisma/client";
import { db, type DbOrTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { nextNumber } from "@/lib/counters";
import { currentAcademicYear, getSetting, type HrRules } from "@/lib/settings";
import { isAutomationEnabled } from "@/lib/automations/config";
import { notifyPermission, notifyUsers } from "@/lib/messaging/notify";
import { addDays, fmtDate, fmtDateTime, round2, today, toNum } from "@/lib/format";

export const CATEGORY_LABEL: Record<StaffCategory, string> = { TEACHING: "Teaching", NON_TEACHING: "Non-teaching", SUPPORT: "Support staff" };
export const EMPLOYMENT_LABEL: Record<EmploymentType, string> = { PERMANENT: "Permanent", PROBATION: "On probation", CONTRACT: "Contract", PART_TIME: "Part-time" };
export const ATT_LABEL: Record<StaffAttendanceStatus, string> = { PRESENT: "Present", LATE: "Late", HALF_DAY: "Half day", ABSENT: "Absent", ON_LEAVE: "On leave" };
export const ATT_SHORT: Record<StaffAttendanceStatus, string> = { PRESENT: "P", LATE: "L", HALF_DAY: "H", ABSENT: "A", ON_LEAVE: "LV" };
export const LEAVE_LABEL: Record<LeaveStatus, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled" };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORD = ["", "1st", "2nd", "3rd", "4th", "5th"];
/** yyyy-mm-dd of a @db.Date value (stored at UTC midnight). */
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/* ───────────── working-day calendar ───────────── */

export type WorkCalendar = { rules: HrRules; holidays: Map<string, string> };

/** The HR rules plus the school holidays (Circulars & events → type Holiday) between two dates. */
export async function workCalendar(branchId: string, from: Date, to: Date): Promise<WorkCalendar> {
  const rules = await getSetting("hr", branchId);
  const events = await db.schoolEvent.findMany({
    where: { branchId, type: "HOLIDAY", date: { lte: to }, OR: [{ endDate: { gte: from } }, { endDate: null, date: { gte: from } }] },
  });
  const holidays = new Map<string, string>();
  for (const e of events) for (let d = e.date; d <= (e.endDate ?? e.date); d = addDays(d, 1)) holidays.set(dayKey(d), e.title);
  return { rules, holidays };
}

/** Why a day is not a working day (holiday name, weekly off, Saturday off), or null on a working day. */
export function dayOff(cal: WorkCalendar, d: Date): string | null {
  const h = cal.holidays.get(dayKey(d));
  if (h) return h;
  const dow = d.getUTCDay();
  if (cal.rules.weeklyOff.includes(DAY_NAMES[dow])) return `${DAY_NAMES[dow]} (weekly off)`;
  if (dow === 6) {
    const nth = Math.ceil(d.getUTCDate() / 7);
    if (cal.rules.offSaturdays.includes(nth)) return `${ORD[nth]} Saturday (off)`;
  }
  return null;
}

export function workingDays(cal: WorkCalendar, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!dayOff(cal, d)) out.push(d);
  return out;
}

/** Minutes since midnight in school time (IST). */
function istMinutes(d: Date) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).split(":").map(Number);
  return (h % 24) * 60 + m;
}
const hhmm = (s: string) => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
export function isLate(rules: HrRules, at: Date) {
  return istMinutes(at) > hhmm(rules.workStart) + Math.max(0, rules.lateGraceMinutes);
}

/* ───────────── staff profiles ───────────── */

export type StaffInput = {
  id?: string; userId?: string; name: string; gender?: Gender; dob?: Date; phone?: string; email?: string; designation: string; departmentId?: string;
  category: StaffCategory; employmentType: EmploymentType; joiningDate: Date; probationEndsOn?: Date; qualifications?: string; subjects?: string;
  priorExperienceYears?: number; bloodGroup?: string; address?: string; emergencyName?: string; emergencyPhone?: string; notes?: string;
};

export async function staffInBranch(branchId: string, id: string) {
  const s = await db.staffProfile.findFirst({ where: { id, branchId } });
  if (!s) throw new AppError("Staff member not found.");
  return s;
}

async function newEmployeeCode(branchId: string, tx: DbOrTx = db) {
  const n = await nextNumber(`EMP-${branchId}`, tx);
  return `EMP-${String(n).padStart(4, "0")}`;
}

export async function saveStaff(branchId: string, input: StaffInput) {
  if (input.userId) {
    const u = await db.user.findFirst({ where: { id: input.userId, branchId }, include: { role: true, staffProfile: true } });
    if (!u || u.role.key === "PARENT" || u.role.key === "DRIVER") throw new AppError("Pick a staff login from this branch.");
    if (u.staffProfile && u.staffProfile.id !== input.id) throw new AppError(`That login already belongs to ${u.staffProfile.name} (${u.staffProfile.employeeCode}).`);
  }
  if (input.departmentId && !(await db.department.findFirst({ where: { id: input.departmentId, branchId } }))) throw new AppError("Unknown department.");
  if (input.probationEndsOn && input.probationEndsOn < input.joiningDate) throw new AppError("Probation cannot end before the joining date.");
  const data = {
    userId: input.userId ?? null, name: input.name, gender: input.gender ?? null, dob: input.dob ?? null, phone: input.phone ?? null, email: input.email ?? null,
    designation: input.designation, departmentId: input.departmentId ?? null, category: input.category, employmentType: input.employmentType,
    joiningDate: input.joiningDate, probationEndsOn: input.probationEndsOn ?? null, qualifications: input.qualifications ?? null, subjects: input.subjects ?? null,
    priorExperienceYears: input.priorExperienceYears ?? null, bloodGroup: input.bloodGroup ?? null, address: input.address ?? null,
    emergencyName: input.emergencyName ?? null, emergencyPhone: input.emergencyPhone ?? null, notes: input.notes ?? null,
  };
  if (input.id) {
    const before = await staffInBranch(branchId, input.id);
    const probationMoved = before.probationEndsOn?.getTime() !== input.probationEndsOn?.getTime();
    return db.staffProfile.update({ where: { id: input.id }, data: { ...data, ...(probationMoved ? { probationAlertAt: null } : {}) } });
  }
  return db.$transaction(async (tx) => tx.staffProfile.create({ data: { ...data, branchId, employeeCode: await newEmployeeCode(branchId, tx) } }));
}

/** Staff logins (not parents, drivers or the Super Admin) in this branch that have no HR profile yet. */
export function loginsWithoutProfile(branchId: string) {
  return db.user.findMany({
    where: { branchId, isActive: true, staffProfile: null, role: { key: { notIn: ["PARENT", "DRIVER", "SUPER_ADMIN"] } } },
    include: { role: true }, orderBy: { name: "asc" },
  });
}

/** Create a basic profile for every staff login without one, so they can apply for leave and check in. */
export async function profilesFromLogins(branchId: string) {
  const users = await loginsWithoutProfile(branchId);
  for (const u of users) {
    await db.$transaction(async (tx) => tx.staffProfile.create({
      data: {
        branchId, employeeCode: await newEmployeeCode(branchId, tx), userId: u.id, name: u.name, phone: u.phone, email: u.email, dob: u.dob,
        designation: u.role.key === "TEACHER" ? "Teacher" : u.role.name, departmentId: u.departmentId,
        category: u.role.key === "TEACHER" ? "TEACHING" : "NON_TEACHING", joiningDate: new Date(u.createdAt.toISOString().slice(0, 10) + "T00:00:00.000Z"),
      },
    }));
  }
  return users.length;
}

/** The staff member leaves: profile closed, pending leave cancelled, and (by default) their login switched off. */
export async function markLeft(branchId: string, byName: string, id: string, input: { leftOn: Date; reason: string; disableLogin: boolean }) {
  const s = await staffInBranch(branchId, id);
  if (!s.isActive) throw new AppError("Already marked as left.");
  if (!input.reason.trim()) throw new AppError("Give a reason (resigned, retired, contract ended …).");
  await db.$transaction(async (tx) => {
    await tx.staffProfile.update({ where: { id }, data: { isActive: false, leftOn: input.leftOn, leftReason: input.reason } });
    await tx.leaveRequest.updateMany({ where: { staffId: id, status: "PENDING" }, data: { status: "CANCELLED", decidedByName: byName, decidedAt: new Date(), decisionNote: "Staff member left" } });
    if (input.disableLogin && s.userId) {
      await tx.user.update({ where: { id: s.userId }, data: { isActive: false } });
      await tx.session.deleteMany({ where: { userId: s.userId } });
    }
  });
}

export async function rejoin(branchId: string, id: string) {
  const s = await staffInBranch(branchId, id);
  if (s.isActive) throw new AppError("This staff member is active.");
  return db.staffProfile.update({ where: { id }, data: { isActive: true, leftOn: null, leftReason: null } });
}

export async function addStaffDocument(branchId: string, staffId: string, input: { title: string; number?: string; expiresOn?: Date; fileUrl?: string }) {
  await staffInBranch(branchId, staffId);
  return db.staffDocument.create({ data: { staffId, title: input.title, number: input.number ?? null, expiresOn: input.expiresOn ?? null, fileUrl: input.fileUrl ?? null } });
}

export async function deleteStaffDocument(branchId: string, id: string) {
  const d = await db.staffDocument.findFirst({ where: { id, staff: { branchId } } });
  if (!d) throw new AppError("Document not found.");
  await db.staffDocument.delete({ where: { id } });
  return d;
}

/* ───────────── leave types & balances ───────────── */

export async function saveLeaveType(branchId: string, input: { id?: string; name: string; code: string; daysPerYear: number; isPaid: boolean; allowHalfDay: boolean; carryForwardMax: number; isActive?: boolean; sortOrder?: number }) {
  const data = { name: input.name, code: input.code.trim().toUpperCase(), daysPerYear: input.isPaid ? input.daysPerYear : 0, isPaid: input.isPaid, allowHalfDay: input.allowHalfDay, carryForwardMax: input.isPaid ? input.carryForwardMax : 0, isActive: input.isActive ?? true, sortOrder: input.sortOrder ?? 0 };
  if (input.id) {
    if (!(await db.leaveType.findFirst({ where: { id: input.id, branchId } }))) throw new AppError("Leave type not found.");
    return db.leaveType.update({ where: { id: input.id }, data });
  }
  return db.leaveType.create({ data: { ...data, branchId } });
}

type Year = { id: string; name: string; startDate: Date; endDate: Date };

export type Balance = { typeId: string; name: string; code: string; isPaid: boolean; allowHalfDay: boolean; entitled: number | null; custom: boolean; used: number; pending: number; available: number | null };

/** Leave entitlement, taken, pending and left per leave type for one staff member in an academic year. Unpaid leave has no limit. */
export async function leaveBalances(branchId: string, staffId: string, year?: Year | null): Promise<Balance[]> {
  const y = year ?? (await currentAcademicYear());
  const types = await db.leaveType.findMany({ where: { branchId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  if (!y) return [];
  const [allocs, reqs] = await Promise.all([
    db.leaveAllocation.findMany({ where: { staffId, academicYearId: y.id } }),
    db.leaveRequest.findMany({ where: { staffId, status: { in: ["PENDING", "APPROVED"] }, fromDate: { gte: y.startDate, lte: y.endDate } }, select: { leaveTypeId: true, status: true, days: true } }),
  ]);
  return types
    .map((t) => {
      const alloc = allocs.find((a) => a.leaveTypeId === t.id);
      const used = round2(reqs.filter((r) => r.leaveTypeId === t.id && r.status === "APPROVED").reduce((s, r) => s + toNum(r.days), 0));
      const pending = round2(reqs.filter((r) => r.leaveTypeId === t.id && r.status === "PENDING").reduce((s, r) => s + toNum(r.days), 0));
      const entitled = t.isPaid ? (alloc ? toNum(alloc.days) : t.daysPerYear) : null;
      return { typeId: t.id, name: t.name, code: t.code, isPaid: t.isPaid, allowHalfDay: t.allowHalfDay, entitled, custom: !!alloc, used, pending, available: entitled === null ? null : round2(entitled - used - pending), active: t.isActive };
    })
    .filter((b) => b.active || b.used || b.pending)
    .map(({ active: _a, ...b }) => b);
}

/** Override one staff member's entitlement for a leave type in the current academic year. */
export async function setAllocation(branchId: string, input: { staffId: string; leaveTypeId: string; days: number; note?: string }) {
  await staffInBranch(branchId, input.staffId);
  const t = await db.leaveType.findFirst({ where: { id: input.leaveTypeId, branchId } });
  if (!t) throw new AppError("Leave type not found.");
  if (!t.isPaid) throw new AppError("Unpaid leave has no balance to set.");
  const y = await currentAcademicYear();
  if (!y) throw new AppError("Set up the current academic year first.");
  return db.leaveAllocation.upsert({
    where: { staffId_leaveTypeId_academicYearId: { staffId: input.staffId, leaveTypeId: t.id, academicYearId: y.id } },
    create: { staffId: input.staffId, leaveTypeId: t.id, academicYearId: y.id, days: input.days, note: input.note ?? null },
    update: { days: input.days, note: input.note ?? null },
  });
}

/**
 * Move unused leave from the previous academic year into the current one, up to each leave type's carry-forward limit.
 * Sets each staff member's current-year entitlement to the yearly days plus what carries over. Safe to run twice.
 */
export async function carryForwardLeave(branchId: string) {
  const current = await currentAcademicYear();
  if (!current) throw new AppError("Set up the current academic year first.");
  const prev = await db.academicYear.findFirst({ where: { endDate: { lt: current.startDate } }, orderBy: { endDate: "desc" } });
  if (!prev) throw new AppError("There is no earlier academic year to carry leave from.");
  const types = await db.leaveType.findMany({ where: { branchId, isPaid: true, isActive: true, carryForwardMax: { gt: 0 } } });
  if (!types.length) throw new AppError("No leave type allows carry forward. Set a carry-forward limit on a leave type first.");
  const staff = await db.staffProfile.findMany({ where: { branchId, isActive: true }, select: { id: true } });
  let moved = 0;
  for (const s of staff) {
    const bal = await leaveBalances(branchId, s.id, prev);
    for (const t of types) {
      const b = bal.find((x) => x.typeId === t.id);
      const carry = Math.min(t.carryForwardMax, Math.max(0, (b?.available ?? 0) + (b?.pending ?? 0)));
      if (carry <= 0) continue;
      await db.leaveAllocation.upsert({
        where: { staffId_leaveTypeId_academicYearId: { staffId: s.id, leaveTypeId: t.id, academicYearId: current.id } },
        create: { staffId: s.id, leaveTypeId: t.id, academicYearId: current.id, days: t.daysPerYear + carry, note: `${carry} carried from ${prev.name}` },
        update: { days: t.daysPerYear + carry, note: `${carry} carried from ${prev.name}` },
      });
      moved++;
    }
  }
  return { moved, from: prev.name, to: current.name };
}

/* ───────────── leave requests ───────────── */

export type LeaveInput = { staffId: string; leaveTypeId: string; fromDate: Date; toDate: Date; halfDay?: boolean; reason: string };

/** Working days a leave would take (0.5 for a half day). */
export async function leaveDays(branchId: string, from: Date, to: Date, halfDay = false) {
  const cal = await workCalendar(branchId, from, to);
  const n = workingDays(cal, from, to).length;
  return halfDay ? (n ? 0.5 : 0) : n;
}

export async function applyLeave(branchId: string, byName: string, input: LeaveInput, opts: { approveAs?: { name: string; userId?: string } } = {}) {
  const staff = await staffInBranch(branchId, input.staffId);
  if (!staff.isActive) throw new AppError("This staff member has left.");
  const type = await db.leaveType.findFirst({ where: { id: input.leaveTypeId, branchId } });
  if (!type || !type.isActive) throw new AppError("Pick a leave type.");
  if (input.toDate < input.fromDate) throw new AppError("The end date is before the start date.");
  if (input.halfDay && input.fromDate.getTime() !== input.toDate.getTime()) throw new AppError("A half day must start and end on the same date.");
  if (input.halfDay && !type.allowHalfDay) throw new AppError(`${type.name} cannot be taken as a half day.`);
  if (input.fromDate < staff.joiningDate) throw new AppError(`The leave starts before ${staff.name} joined (${fmtDate(staff.joiningDate)}).`);
  if (input.toDate > addDays(today(), 366)) throw new AppError("Leave can be applied at most a year ahead.");
  const days = await leaveDays(branchId, input.fromDate, input.toDate, input.halfDay);
  if (!days) throw new AppError("Every chosen day is a holiday or a weekly off. No leave is needed.");
  const clash = await db.leaveRequest.findFirst({ where: { staffId: staff.id, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: input.toDate }, toDate: { gte: input.fromDate } } });
  if (clash) throw new AppError(`This overlaps ${clash.requestNo} (${fmtDate(clash.fromDate)}${clash.toDate > clash.fromDate ? ` to ${fmtDate(clash.toDate)}` : ""}, ${LEAVE_LABEL[clash.status].toLowerCase()}).`);
  if (type.isPaid) {
    const bal = (await leaveBalances(branchId, staff.id)).find((b) => b.typeId === type.id);
    const left = bal?.available ?? type.daysPerYear;
    if (days > left) throw new AppError(`Only ${left} day${left === 1 ? "" : "s"} of ${type.name} left${bal?.pending ? ` (${bal.pending} waiting for approval)` : ""}. Choose fewer days or another leave type.`);
  }
  const req = await db.$transaction(async (tx) => {
    const n = await nextNumber(`LV-${branchId}`, tx);
    return tx.leaveRequest.create({
      data: { branchId, requestNo: `LV-${String(n).padStart(5, "0")}`, staffId: staff.id, leaveTypeId: type.id, fromDate: input.fromDate, toDate: input.toDate, halfDay: !!input.halfDay, days, reason: input.reason, appliedByName: byName },
    });
  });
  if (opts.approveAs) {
    await decideLeave(branchId, opts.approveAs.name, req.id, { approve: true, note: "Recorded by the office" }, opts.approveAs.userId);
  } else if (await isAutomationEnabled("hr.leaveRequested")) {
    await notifyPermission("hr.leave.approve", {
      title: `Leave request ${req.requestNo}`,
      body: `${staff.name}: ${type.name}, ${days} day${days === 1 ? "" : "s"} from ${fmtDate(input.fromDate)}${days > 1 ? ` to ${fmtDate(input.toDate)}` : ""}. ${input.reason}`,
      link: `/hr/leave?status=PENDING#${req.id}`, category: "HR", inAppOnly: true,
    }, branchId);
  }
  return req;
}

/** Approved leave marks attendance "On leave" (or "Half day") on each working day. Days the person actually worked are kept. */
async function leaveToAttendance(tx: DbOrTx, req: { id: string; branchId: string; staffId: string; fromDate: Date; toDate: Date; halfDay: boolean; requestNo: string }, typeName: string, byName: string) {
  const cal = await workCalendar(req.branchId, req.fromDate, req.toDate);
  const days = workingDays(cal, req.fromDate, req.toDate);
  const existing = await tx.staffAttendance.findMany({ where: { staffId: req.staffId, date: { gte: req.fromDate, lte: req.toDate } } });
  const note = `${typeName} (${req.requestNo})`;
  for (const d of days) {
    const ex = existing.find((e) => dayKey(e.date) === dayKey(d));
    if (ex && !req.halfDay && (ex.status === "PRESENT" || ex.status === "LATE") && ex.checkIn) continue; // came in to work
    const status: StaffAttendanceStatus = req.halfDay ? "HALF_DAY" : "ON_LEAVE";
    await tx.staffAttendance.upsert({
      where: { staffId_date: { staffId: req.staffId, date: d } },
      create: { branchId: req.branchId, staffId: req.staffId, date: d, status, source: "LEAVE", leaveRequestId: req.id, note, markedByName: byName },
      update: { status, source: "LEAVE", leaveRequestId: req.id, note, markedByName: byName },
    });
  }
}

export async function decideLeave(branchId: string, byName: string, id: string, input: { approve: boolean; note?: string; substituteId?: string }, actorUserId?: string) {
  const req = await db.leaveRequest.findFirst({ where: { id, branchId }, include: { staff: true, leaveType: true } });
  if (!req) throw new AppError("Leave request not found.");
  if (req.status !== "PENDING") throw new AppError(`${req.requestNo} is already ${LEAVE_LABEL[req.status].toLowerCase()}.`);
  if (actorUserId && req.staff.userId === actorUserId) throw new AppError("You cannot approve or reject your own leave. Another approver must decide it.");
  if (!input.approve && !input.note?.trim()) throw new AppError("Give a reason for rejecting.");
  let substitute: { id: string; name: string; userId: string | null } | null = null;
  if (input.approve && input.substituteId) {
    substitute = await db.staffProfile.findFirst({ where: { id: input.substituteId, branchId, isActive: true }, select: { id: true, name: true, userId: true } });
    if (!substitute || substitute.id === req.staffId) throw new AppError("Pick another active staff member as the substitute.");
  }
  await db.$transaction(async (tx) => {
    const done = await tx.leaveRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: input.approve ? "APPROVED" : "REJECTED", decidedByName: byName, decidedAt: new Date(), decisionNote: input.note?.trim() || null, substituteId: substitute?.id ?? null },
    });
    if (!done.count) throw new AppError("Someone else has just decided this request.");
    if (input.approve) await leaveToAttendance(tx, req, req.leaveType.name, byName);
  });
  if (await isAutomationEnabled("hr.leaveDecided")) {
    const when = `${fmtDate(req.fromDate)}${req.toDate > req.fromDate ? ` to ${fmtDate(req.toDate)}` : ""}`;
    if (req.staff.userId) {
      await notifyUsers([req.staff.userId], {
        title: `Leave ${input.approve ? "approved" : "not approved"}: ${req.requestNo}`,
        body: `${req.leaveType.name}, ${when}.${input.note ? ` ${input.note}` : ""}${substitute ? ` Substitute: ${substitute.name}.` : ""}`,
        link: "/my-hr", category: "HR",
      });
    }
    if (substitute?.userId) {
      await notifyUsers([substitute.userId], { title: "You are covering for a colleague", body: `Please cover ${req.staff.name}'s duties on ${when}.`, link: "/my-hr", category: "HR" });
    }
  }
}

/**
 * Cancel a leave request. The staff member can cancel their own pending leave, or approved leave that has not started;
 * an approver can cancel any. Attendance marked from the leave is removed.
 */
export async function cancelLeave(branchId: string, byName: string, id: string, actor: { userId: string; isApprover: boolean }, reason?: string) {
  const req = await db.leaveRequest.findFirst({ where: { id, branchId }, include: { staff: true } });
  if (!req) throw new AppError("Leave request not found.");
  const own = req.staff.userId === actor.userId;
  if (req.status !== "PENDING" && req.status !== "APPROVED") throw new AppError(`${req.requestNo} is already ${LEAVE_LABEL[req.status].toLowerCase()}.`);
  if (!actor.isApprover) {
    if (!own) throw new AppError("You can cancel only your own leave.");
    if (req.status === "APPROVED" && req.fromDate <= today()) throw new AppError("This leave has already started. Ask the office to change it.");
  }
  await db.$transaction(async (tx) => {
    await tx.leaveRequest.update({ where: { id }, data: { status: "CANCELLED", decidedByName: byName, decidedAt: new Date(), decisionNote: reason?.trim() || (own ? "Cancelled by the staff member" : "Cancelled") } });
    const rows = await tx.staffAttendance.findMany({ where: { leaveRequestId: id } });
    for (const r of rows) {
      if (r.checkIn) await tx.staffAttendance.update({ where: { id: r.id }, data: { status: "PRESENT", source: "SELF", leaveRequestId: null, note: null } });
      else await tx.staffAttendance.delete({ where: { id: r.id } });
    }
  });
}

/* ───────────── attendance ───────────── */

/** Everyone who should be on the register for a date: active and joined by then (or left after it). */
export function staffOnRoll(branchId: string, date: Date) {
  return db.staffProfile.findMany({
    where: { branchId, joiningDate: { lte: date }, OR: [{ isActive: true }, { leftOn: { gt: date } }] },
    include: { department: true }, orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}

export async function saveRegister(branchId: string, byName: string, date: Date, entries: { staffId: string; status: StaffAttendanceStatus; note?: string }[]) {
  if (date > today()) throw new AppError("Attendance cannot be marked for a future date.");
  const onRoll = new Set((await staffOnRoll(branchId, date)).map((s) => s.id));
  const bad = entries.find((e) => !onRoll.has(e.staffId));
  if (bad) throw new AppError("The list has someone who was not on the staff roll that day. Reload and try again.");
  const existing = await db.staffAttendance.findMany({ where: { branchId, date, staffId: { in: entries.map((e) => e.staffId) } } });
  await db.$transaction(async (tx) => {
    for (const e of entries) {
      const ex = existing.find((x) => x.staffId === e.staffId);
      const keepLeave = e.status === "ON_LEAVE" || e.status === "HALF_DAY";
      if (ex && ex.status === e.status && (e.note ?? null) === (ex.note ?? null)) continue;
      await tx.staffAttendance.upsert({
        where: { staffId_date: { staffId: e.staffId, date } },
        create: { branchId, staffId: e.staffId, date, status: e.status, source: "REGISTER", note: e.note ?? null, markedByName: byName },
        update: { status: e.status, note: e.note ?? ex?.note ?? null, markedByName: byName, source: ex?.source === "SELF" ? "SELF" : ex?.source === "LEAVE" && keepLeave ? "LEAVE" : "REGISTER", leaveRequestId: keepLeave ? ex?.leaveRequestId ?? null : null },
      });
    }
  });
  const count = (s: StaffAttendanceStatus) => entries.filter((e) => e.status === s).length;
  return { marked: entries.length, absent: count("ABSENT"), late: count("LATE"), onLeave: count("ON_LEAVE") };
}

export async function myProfile(userId: string) {
  return db.staffProfile.findUnique({ where: { userId }, include: { department: true } });
}

export async function checkIn(userId: string, at = new Date()) {
  const me = await myProfile(userId);
  if (!me || !me.isActive) throw new AppError("Your HR profile is not set up yet. Ask the office to add you under HR → Staff.");
  const rules = await getSetting("hr", me.branchId);
  if (!rules.selfCheckIn) throw new AppError("Phone check-in is switched off. The office marks attendance.");
  const date = today();
  const row = await db.staffAttendance.findUnique({ where: { staffId_date: { staffId: me.id, date } } });
  if (row?.status === "ON_LEAVE") throw new AppError("You are on leave today. Cancel the leave first if you have come in.");
  if (row?.checkIn) throw new AppError(`You checked in at ${fmtDateTime(row.checkIn)}.`);
  const status: StaffAttendanceStatus = row?.status === "HALF_DAY" ? "HALF_DAY" : isLate(rules, at) ? "LATE" : "PRESENT";
  return db.staffAttendance.upsert({
    where: { staffId_date: { staffId: me.id, date } },
    create: { branchId: me.branchId, staffId: me.id, date, status, checkIn: at, source: "SELF", markedByName: me.name },
    update: { checkIn: at, status, source: row?.source === "LEAVE" ? "LEAVE" : "SELF", markedByName: me.name },
  });
}

export async function checkOut(userId: string, at = new Date()) {
  const me = await myProfile(userId);
  if (!me) throw new AppError("Your HR profile is not set up yet.");
  const row = await db.staffAttendance.findUnique({ where: { staffId_date: { staffId: me.id, date: today() } } });
  if (!row?.checkIn) throw new AppError("Check in first.");
  if (row.checkOut) throw new AppError(`You checked out at ${fmtDateTime(row.checkOut)}.`);
  return db.staffAttendance.update({ where: { id: row.id }, data: { checkOut: at } });
}

/* ───────────── dashboard & automations ───────────── */

export async function hrDashboard(branchId: string, soonDays = 30) {
  const t = today();
  const [active, rows, pending, onLeave, docs, probation, cal] = await Promise.all([
    db.staffProfile.count({ where: { branchId, isActive: true } }),
    db.staffAttendance.groupBy({ by: ["status"], where: { branchId, date: t, staff: { isActive: true } }, _count: true }),
    db.leaveRequest.count({ where: { branchId, status: "PENDING" } }),
    db.leaveRequest.findMany({ where: { branchId, status: "APPROVED", fromDate: { lte: t }, toDate: { gte: t } }, include: { staff: true, leaveType: true, substitute: true }, orderBy: { staff: { name: "asc" } } }),
    db.staffDocument.findMany({ where: { staff: { branchId, isActive: true }, expiresOn: { lte: addDays(t, soonDays) } }, include: { staff: true }, orderBy: { expiresOn: "asc" } }),
    db.staffProfile.findMany({ where: { branchId, isActive: true, employmentType: "PROBATION", probationEndsOn: { lte: addDays(t, soonDays) } }, orderBy: { probationEndsOn: "asc" } }),
    workCalendar(branchId, t, t),
  ]);
  const c = (s: StaffAttendanceStatus) => rows.find((r) => r.status === s)?._count ?? 0;
  const marked = rows.reduce((s, r) => s + r._count, 0);
  return {
    active, pending, onLeave, docs, probation, off: dayOff(cal, t),
    present: c("PRESENT") + c("LATE") + c("HALF_DAY"), late: c("LATE"), absent: c("ABSENT"), leaveToday: c("ON_LEAVE"), notMarked: Math.max(0, active - marked),
  };
}

/** Daily: remind the office when staff attendance has not been marked for everyone on a working day. */
export async function hrAttendanceReminder(): Promise<string> {
  const t = today();
  const branches = await db.staffProfile.groupBy({ by: ["branchId"], where: { isActive: true, joiningDate: { lte: t } }, _count: true });
  let reminded = 0;
  for (const b of branches) {
    if (dayOff(await workCalendar(b.branchId, t, t), t)) continue;
    const marked = await db.staffAttendance.count({ where: { branchId: b.branchId, date: t, staff: { isActive: true } } });
    const missing = b._count - marked;
    if (missing <= 0) continue;
    await notifyPermission("hr.attendance", { title: "Staff attendance not marked", body: `${missing} staff member${missing === 1 ? " has" : "s have"} no attendance for today yet.`, link: "/hr/attendance", category: "HR", inAppOnly: true }, b.branchId);
    reminded++;
  }
  return `${reminded} branch reminder(s)`;
}

/** Daily: alert HR once when a staff document is about to expire or a probation period is about to end. */
export async function hrExpiryAlerts(config: Record<string, unknown>): Promise<string> {
  const days = Math.max(1, Number(config.daysBefore ?? 30) || 30);
  const t = today(), until = addDays(t, days);
  const docs = await db.staffDocument.findMany({ where: { alertedAt: null, expiresOn: { lte: until }, staff: { isActive: true } }, include: { staff: true }, orderBy: { expiresOn: "asc" } });
  const probation = await db.staffProfile.findMany({ where: { isActive: true, employmentType: "PROBATION", probationAlertAt: null, probationEndsOn: { gte: t, lte: until } } });
  const branches = new Set([...docs.map((d) => d.staff.branchId), ...probation.map((p) => p.branchId)]);
  for (const branchId of branches) {
    const ds = docs.filter((d) => d.staff.branchId === branchId), ps = probation.filter((p) => p.branchId === branchId);
    const lines = [
      ...ds.map((d) => `${d.staff.name}: ${d.title} ${d.expiresOn! < t ? "expired" : "expires"} ${fmtDate(d.expiresOn)}`),
      ...ps.map((p) => `${p.name}: probation ends ${fmtDate(p.probationEndsOn)}`),
    ];
    await notifyPermission("hr.manage", {
      title: `${lines.length} HR date${lines.length === 1 ? "" : "s"} coming up`,
      body: lines.slice(0, 8).join("\n") + (lines.length > 8 ? `\n…and ${lines.length - 8} more` : ""),
      link: "/hr", category: "HR", inAppOnly: true,
    }, branchId);
  }
  if (docs.length) await db.staffDocument.updateMany({ where: { id: { in: docs.map((d) => d.id) } }, data: { alertedAt: new Date() } });
  if (probation.length) await db.staffProfile.updateMany({ where: { id: { in: probation.map((p) => p.id) } }, data: { probationAlertAt: new Date() } });
  return `${docs.length} document and ${probation.length} probation alert(s)`;
}

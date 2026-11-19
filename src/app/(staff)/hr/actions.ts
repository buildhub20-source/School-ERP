"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { hasPerm } from "@/lib/permissions";
import { saveSetting } from "@/lib/settings";
import { saveUpload } from "@/lib/uploads";
import { AppError } from "@/lib/errors";
import { dateOnly } from "@/lib/format";
import {
  addStaffDocument, applyLeave, cancelLeave, carryForwardLeave, checkIn, checkOut, decideLeave, deleteStaffDocument, markLeft, myProfile,
  profilesFromLogins, rejoin, saveLeaveType, saveRegister, saveStaff, setAllocation,
} from "@/server/hr/service";

const H = ["/hr", "/my-hr", "/approvals", "/dashboard"];
const optId = () => z.string().optional().transform((v) => (v ? v : undefined));
const day = () => z.coerce.date().transform((d) => dateOnly(d));
const optDay = () => zs.optDate().transform((d) => (d ? dateOnly(d) : undefined));

const staffSchema = z.object({
  id: optId(), userId: optId(), name: zs.str(100), gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional().or(z.literal("").transform(() => undefined)),
  dob: optDay(), phone: zs.optPhone(), email: zs.optEmail(), designation: zs.str(80), departmentId: optId(),
  category: z.enum(["TEACHING", "NON_TEACHING", "SUPPORT"]), employmentType: z.enum(["PERMANENT", "PROBATION", "CONTRACT", "PART_TIME"]),
  joiningDate: day(), probationEndsOn: optDay(), qualifications: zs.optStr(300), subjects: zs.optStr(200), priorExperienceYears: zs.optInt(),
  bloodGroup: zs.optStr(10), address: zs.optStr(500), emergencyName: zs.optStr(100), emergencyPhone: zs.optPhone(), notes: zs.optStr(1000),
});
export const saveStaffAction = defineAction({ perm: "hr.manage", revalidate: H, schema: staffSchema }, async (input, { branchId }) => ({ id: (await saveStaff(branchId, input)).id }));

export const profilesFromLoginsAction = defineAction({ perm: "hr.manage", revalidate: H, schema: z.object({}) }, async (_i, { branchId }) => {
  const n = await profilesFromLogins(branchId);
  return { message: n ? `Added ${n} staff profile${n === 1 ? "" : "s"}. Open each one to fill in the details.` : "Every staff login already has a profile." };
});

export const markLeftAction = defineAction({
  perm: "hr.manage", revalidate: H,
  schema: z.object({ id: zs.id, leftOn: day(), reason: zs.str(300), disableLogin: zs.bool() }),
}, async ({ id, ...input }, { branchId, user }) => { await markLeft(branchId, user.name, id, input); return true; });

export const rejoinAction = defineAction({ perm: "hr.manage", revalidate: H, schema: z.object({ id: zs.id }) }, async ({ id }, { branchId }) => { await rejoin(branchId, id); return true; });

const docSchema = z.object({ staffId: zs.id, title: zs.str(100), number: zs.optStr(60), expiresOn: optDay(), file: z.any().optional() });
export const addStaffDocumentAction = defineAction({ perm: "hr.manage", revalidate: H, schema: docSchema }, async (input, { branchId }) => {
  const fileUrl = input.file instanceof File && input.file.size > 0 ? await saveUpload(input.file, "staff-docs", { maxMb: 5 }) : undefined;
  await addStaffDocument(branchId, input.staffId, { title: input.title, number: input.number, expiresOn: input.expiresOn, fileUrl });
  return true;
});

export const deleteStaffDocumentAction = defineAction({ perm: "hr.manage", revalidate: H, schema: z.object({ id: zs.id }) }, async ({ id }, { branchId }) => { await deleteStaffDocument(branchId, id); return true; });

/* leave types, rules, balances */

export const saveLeaveTypeAction = defineAction({
  perm: "hr.manage", revalidate: H,
  schema: z.object({ id: optId(), name: zs.str(60), code: z.string().trim().min(1).max(8).regex(/^[A-Za-z0-9]+$/, "Letters and numbers only"), daysPerYear: zs.int(0), isPaid: zs.bool(), allowHalfDay: zs.bool(), carryForwardMax: zs.int(0), isActive: zs.bool(), sortOrder: zs.optInt() }),
}, async (input, { branchId }) => { await saveLeaveType(branchId, input); return true; });

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const saveHrRulesAction = defineAction({
  perm: "hr.manage", revalidate: H,
  schema: z.object({ workStart: hhmm, lateGraceMinutes: zs.int(0), weeklyOff: z.array(z.string()).optional(), offSaturdays: z.array(z.coerce.number().int().min(1).max(5)).optional(), selfCheckIn: zs.bool() }),
}, async (input, { branchId }) => {
  await saveSetting("hr", { ...input, weeklyOff: input.weeklyOff ?? [], offSaturdays: input.offSaturdays ?? [] }, branchId);
  return true;
});

const halfDays = () => z.coerce.number().min(0).max(365).transform((n) => Math.round(n * 2) / 2);
const allocationSchema = z.object({ staffId: zs.id, leaveTypeId: zs.id, days: halfDays(), note: zs.optStr(200) });
export const setAllocationAction = defineAction({ perm: "hr.manage", revalidate: H, schema: allocationSchema }, async (input, { branchId }) => { await setAllocation(branchId, input); return true; });

export const carryForwardAction = defineAction({ perm: "hr.manage", revalidate: H, schema: z.object({}) }, async (_i, { branchId }) => {
  const r = await carryForwardLeave(branchId);
  return { message: `Carried unused leave from ${r.from} into ${r.to} (${r.moved} balance${r.moved === 1 ? "" : "s"} updated)` };
});

/* leave requests */

const leaveSchema = z.object({ staffId: optId(), leaveTypeId: zs.id, fromDate: day(), toDate: optDay(), halfDay: zs.bool().optional(), reason: zs.str(500), approveNow: zs.bool().optional() });

/** Apply for leave: your own (any staff with hr.self), or for someone else (office, hr.manage). */
export const applyLeaveAction = defineAction({ perm: ["hr.self", "hr.manage"], revalidate: H, schema: leaveSchema }, async (input, { branchId, user }) => {
  let staffId = input.staffId;
  const me = await myProfile(user.id);
  if (!staffId || staffId === me?.id) {
    if (!me || !hasPerm(user, "hr.self")) throw new AppError("Your HR profile is not set up yet. Ask the office to add you under HR → Staff.");
    staffId = me.id;
  } else if (!hasPerm(user, "hr.manage")) throw new AppError("You can apply only for your own leave.");
  const own = staffId === me?.id;
  if (input.approveNow && (own || !hasPerm(user, "hr.leave.approve"))) throw new AppError(own ? "Your own leave must be approved by someone else." : "Only a leave approver can record leave as approved.");
  const req = await applyLeave(branchId, user.name, { staffId, leaveTypeId: input.leaveTypeId, fromDate: input.fromDate, toDate: input.toDate ?? input.fromDate, halfDay: input.halfDay, reason: input.reason },
    input.approveNow ? { approveAs: { name: user.name, userId: user.id } } : {});
  return { message: `${req.requestNo}: ${Number(req.days)} day${Number(req.days) === 1 ? "" : "s"} ${input.approveNow ? "recorded and approved" : "sent for approval"}` };
});

export const approveLeaveAction = defineAction({
  perm: "hr.leave.approve", revalidate: H,
  schema: z.object({ id: zs.id, note: zs.optStr(300), substituteId: optId() }),
}, async ({ id, note, substituteId }, { branchId, user }) => { await decideLeave(branchId, user.name, id, { approve: true, note, substituteId }, user.id); return true; });

export const rejectLeaveAction = defineAction({ perm: "hr.leave.approve", revalidate: H, schema: z.object({ id: zs.id, reason: zs.str(300) }) }, async ({ id, reason }, { branchId, user }) => {
  await decideLeave(branchId, user.name, id, { approve: false, note: reason }, user.id);
  return true;
});

export const cancelLeaveAction = defineAction({ perm: ["hr.self", "hr.leave.approve"], revalidate: H, schema: z.object({ id: zs.id, reason: zs.optStr(300) }) }, async ({ id, reason }, { branchId, user }) => {
  await cancelLeave(branchId, user.name, id, { userId: user.id, isApprover: hasPerm(user, "hr.leave.approve") }, reason);
  return true;
});

/* attendance */

export const saveRegisterAction = defineAction({
  perm: "hr.attendance", revalidate: H,
  schema: z.object({ date: day(), entries: zs.json(z.array(z.object({ staffId: z.string(), status: z.enum(["PRESENT", "LATE", "HALF_DAY", "ABSENT", "ON_LEAVE"]), note: z.string().max(200).optional() }))) }),
}, async ({ date, entries }, { branchId, user }) => {
  const r = await saveRegister(branchId, user.name, date, entries.map((e) => ({ ...e, note: e.note?.trim() || undefined })));
  return { message: `Saved: ${r.marked} marked${r.absent ? `, ${r.absent} absent` : ""}${r.late ? `, ${r.late} late` : ""}` };
});

export const checkInAction = defineAction({ perm: "hr.self", revalidate: H, schema: z.object({}) }, async (_i, { user }) => {
  const r = await checkIn(user.id);
  return { message: r.status === "LATE" ? "Checked in (late)" : "Checked in" };
});

export const checkOutAction = defineAction({ perm: "hr.self", revalidate: H, schema: z.object({}) }, async (_i, { user }) => { await checkOut(user.id); return { message: "Checked out" }; });

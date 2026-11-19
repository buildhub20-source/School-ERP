import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { addDays, today } from "@/lib/format";
import { getSetting } from "@/lib/settings";
import {
  addStaffDocument, applyLeave, cancelLeave, checkIn, checkOut, dayOff, decideLeave, hrExpiryAlerts, isLate, leaveBalances, leaveDays, saveLeaveType, saveRegister, saveStaff,
  workCalendar, workingDays, type WorkCalendar,
} from "@/server/hr/service";
import { asUser, testCtx, uniq } from "./helpers";

let ctx: Awaited<ReturnType<typeof testCtx>>;
let staffId: string;
let typeId: string;
const d = (s: string) => new Date(s + "T00:00:00.000Z");

beforeAll(async () => {
  ctx = await testCtx();
  typeId = (await saveLeaveType(ctx.branchId, { name: uniq("Test leave "), code: uniq("T").slice(0, 8), daysPerYear: 3, isPaid: true, allowHalfDay: true, carryForwardMax: 0 })).id;
  staffId = (await saveStaff(ctx.branchId, { name: uniq("Test staff "), designation: "Tester", category: "SUPPORT", employmentType: "PERMANENT", joiningDate: addDays(today(), -400) })).id;
});

afterAll(async () => {
  await db.leaveRequest.deleteMany({ where: { leaveTypeId: typeId } });
  await db.staffProfile.delete({ where: { id: staffId } });
  await db.leaveType.delete({ where: { id: typeId } });
});

/** The first stretch of `n` consecutive working days starting 3+ weeks ahead (away from seeded leave). */
async function aheadWorking(n: number) {
  const cal = await workCalendar(ctx.branchId, today(), addDays(today(), 120));
  let start = addDays(today(), 21);
  for (;;) {
    const days = Array.from({ length: n }, (_, i) => addDays(start, i));
    if (days.every((x) => !dayOff(cal, x))) return days;
    start = addDays(start, 1);
  }
}

describe("working-day calendar", () => {
  const cal: WorkCalendar = { rules: { workStart: "08:30", lateGraceMinutes: 10, weeklyOff: ["Sunday"], offSaturdays: [2], selfCheckIn: true }, holidays: new Map([["2026-11-12", "Test holiday"]]) };
  it("skips Sundays, the 2nd Saturday and holidays", () => {
    expect(dayOff(cal, d("2026-11-08"))).toMatch(/Sunday/);
    expect(dayOff(cal, d("2026-11-14"))).toMatch(/2nd Saturday/);
    expect(dayOff(cal, d("2026-11-07"))).toBeNull(); // 1st Saturday is a working day
    expect(dayOff(cal, d("2026-11-12"))).toBe("Test holiday");
    // Mon 9 – Sun 15 Nov: 9, 10, 11, 13 are working days
    expect(workingDays(cal, d("2026-11-09"), d("2026-11-15")).length).toBe(4);
  });
  it("marks a check-in late only after the start time plus grace (IST)", () => {
    expect(isLate(cal.rules, new Date("2026-11-09T03:05:00Z"))).toBe(false); // 08:35 IST
    expect(isLate(cal.rules, new Date("2026-11-09T03:11:00Z"))).toBe(true); // 08:41 IST
  });
});

describe("leave", () => {
  it("applies, blocks overlaps and over-balance, approves onto the register and cancels back", async () => {
    const [a, b, c] = await aheadWorking(3);
    expect(await leaveDays(ctx.branchId, a, b)).toBe(2);
    const req = await asUser(ctx.adminId, () => applyLeave(ctx.branchId, "Test", { staffId, leaveTypeId: typeId, fromDate: a, toDate: b, reason: "Test" }));
    expect(req.status).toBe("PENDING");
    await expect(applyLeave(ctx.branchId, "Test", { staffId, leaveTypeId: typeId, fromDate: b, toDate: c, reason: "Overlap" })).rejects.toThrow(/overlaps/);
    // 3 allowed, 2 pending: 2 more days is over the balance
    await expect(applyLeave(ctx.branchId, "Test", { staffId, leaveTypeId: typeId, fromDate: addDays(c, 7), toDate: addDays(c, 12), reason: "Too many" })).rejects.toThrow(/left/);
    const bal = (await leaveBalances(ctx.branchId, staffId)).find((x) => x.typeId === typeId)!;
    expect(bal).toMatchObject({ entitled: 3, used: 0, pending: 2, available: 1 });

    await expect(decideLeave(ctx.branchId, "Test", req.id, { approve: false })).rejects.toThrow(/reason/);
    await asUser(ctx.adminId, () => decideLeave(ctx.branchId, "Approver", req.id, { approve: true }));
    const rows = await db.staffAttendance.findMany({ where: { leaveRequestId: req.id } });
    expect(rows.map((r) => r.status)).toEqual(["ON_LEAVE", "ON_LEAVE"]);
    expect((await leaveBalances(ctx.branchId, staffId)).find((x) => x.typeId === typeId)).toMatchObject({ used: 2, pending: 0, available: 1 });
    await expect(decideLeave(ctx.branchId, "Test", req.id, { approve: true })).rejects.toThrow(/already/);

    await asUser(ctx.adminId, () => cancelLeave(ctx.branchId, "Approver", req.id, { userId: ctx.adminId, isApprover: true }));
    expect(await db.staffAttendance.count({ where: { staffId, date: { in: [a, b] } } })).toBe(0);
    expect((await db.leaveRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("CANCELLED");
  });

  it("does not let staff approve their own leave", async () => {
    const teacher = await db.staffProfile.findFirstOrThrow({ where: { branchId: ctx.branchId, user: { email: "anitha@school.test" } } });
    const [a] = await aheadWorking(1);
    const req = await asUser(ctx.adminId, () => applyLeave(ctx.branchId, "Test", { staffId: teacher.id, leaveTypeId: typeId, fromDate: a, toDate: a, halfDay: true, reason: "Test" }));
    expect(Number(req.days)).toBe(0.5);
    await expect(decideLeave(ctx.branchId, "Anitha", req.id, { approve: true }, teacher.userId!)).rejects.toThrow(/own leave/);
    // and a staff member cannot cancel someone else's leave
    await expect(cancelLeave(ctx.branchId, "Other", req.id, { userId: ctx.adminId, isApprover: false })).rejects.toThrow(/only your own/);
    await cancelLeave(ctx.branchId, "Anitha", req.id, { userId: teacher.userId!, isApprover: false });
  });
});

describe("attendance", () => {
  it("saves the register and refuses future dates", async () => {
    await expect(saveRegister(ctx.branchId, "Test", addDays(today(), 1), [{ staffId, status: "PRESENT" }])).rejects.toThrow(/future/);
    const day = addDays(today(), -1);
    const r = await saveRegister(ctx.branchId, "Test", day, [{ staffId, status: "ABSENT", note: "No call" }]);
    expect(r).toMatchObject({ marked: 1, absent: 1 });
    await saveRegister(ctx.branchId, "Test", day, [{ staffId, status: "LATE" }]);
    expect((await db.staffAttendance.findUniqueOrThrow({ where: { staffId_date: { staffId, date: day } } })).status).toBe("LATE");
    await db.staffAttendance.deleteMany({ where: { staffId } });
  });

  it("lets a staff member check in and out from their phone, marking late after the start time", async () => {
    const teacher = await db.staffProfile.findFirstOrThrow({ where: { branchId: ctx.branchId, user: { email: "joseph@school.test" } } });
    const before = await db.staffAttendance.findUnique({ where: { staffId_date: { staffId: teacher.id, date: today() } } });
    if (before) await db.staffAttendance.delete({ where: { id: before.id } });
    try {
      const rules = await getSetting("hr", ctx.branchId);
      const now = new Date();
      const row = await checkIn(teacher.userId!, now);
      expect(row.status).toBe(isLate(rules, now) ? "LATE" : "PRESENT");
      await expect(checkIn(teacher.userId!)).rejects.toThrow(/checked in/);
      expect((await checkOut(teacher.userId!)).checkOut).not.toBeNull();
    } finally {
      await db.staffAttendance.deleteMany({ where: { staffId: teacher.id, date: today() } });
      if (before) await db.staffAttendance.create({ data: before });
    }
  });
});

describe("HR alerts", () => {
  it("alerts once for a document about to expire", async () => {
    const doc = await addStaffDocument(ctx.branchId, staffId, { title: "Test licence", expiresOn: addDays(today(), 5) });
    expect(await hrExpiryAlerts({ daysBefore: 30 })).toMatch(/document/);
    expect((await db.staffDocument.findUniqueOrThrow({ where: { id: doc.id } })).alertedAt).not.toBeNull();
    const again = await hrExpiryAlerts({ daysBefore: 30 });
    expect(again.startsWith("0 document")).toBe(true);
  });
});

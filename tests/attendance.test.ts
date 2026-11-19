import { describe, expect, it, beforeAll, vi } from "vitest";

// A fixed school day (Wednesday 18 Nov 2026, 10:30 IST) so "today" is always a working day for these tests.
// Only Date is faked; timers stay real. Set before the data store loads, so the mock data lines up with it.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-18T05:00:00.000Z"));

const { db } = await import("@/lib/db");
const { today, addDays } = await import("@/lib/format");
const svc = await import("@/server/attendance/service");
const { studentReports } = await import("@/server/students/reports");
const { testCtx, asUser } = await import("./helpers");
const { syncRoles } = await import("@/lib/role-sync");

type U = { id: string; name: string; branchId: string; roleKey: string; permissions: string[] };
async function asAttendanceUser(email: string): Promise<U> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { role: true } });
  return { id: u.id, name: u.name, branchId: u.branchId, roleKey: u.role.key, permissions: u.role.permissions };
}
const alerts = () => Promise.all([db.messageLog.count({ where: { category: "ATTENDANCE" } }), db.notification.count({ where: { category: "ATTENDANCE" } })]).then(([a, b]) => a + b);

let ctx: Awaited<ReturnType<typeof testCtx>>;
let teacher: U, office: U;
let sec5A: string, sec8B: string;

beforeAll(async () => {
  await syncRoles(); // what the app does at start-up: grants the new attendance permissions to existing roles
  ctx = await testCtx();
  teacher = await asAttendanceUser("anitha@school.test");
  office = await asAttendanceUser("admin@school.test");
  sec5A = (await db.section.findFirstOrThrow({ where: { name: "A", schoolClass: { branchId: ctx.branchId, name: "Class 5" } } })).id;
  sec8B = (await db.section.findFirstOrThrow({ where: { name: "B", schoolClass: { branchId: ctx.branchId, name: "Class 8" } } })).id;
});

describe("attendance percentage", () => {
  it("counts late as present and a half day as half; unmarked days are left out", () => {
    expect(svc.attendancePercent({ present: 8, late: 1, half: 1, absent: 0 })).toBe(95);
    expect(svc.attendancePercent({ present: 3, late: 0, half: 0, absent: 1 })).toBe(75);
    expect(svc.attendancePercent({ present: 0, late: 0, half: 0, absent: 0 })).toBeNull();
  });
});

describe("class register", () => {
  it("lets the class teacher mark today, tells parents of absences once, and sends a correction when fixed", async () => {
    expect(teacher.permissions).toContain("attendance.mark"); // granted by role sync / defaults
    const roll = await svc.sectionRegister(ctx.branchId, sec5A, today());
    expect(roll.length).toBeGreaterThan(2);
    expect(roll.every((r) => r.mark === null)).toBe(true);
    const absentee = roll[1].student.id;
    const entries = roll.map((r, i) => ({ studentId: r.student.id, status: (i === 1 ? "ABSENT" : i === 2 ? "LATE" : "PRESENT") as "ABSENT" | "LATE" | "PRESENT" }));

    const before = await alerts();
    const r1 = await asUser(teacher.id, () => svc.saveStudentRegister(teacher, sec5A, today(), entries));
    expect(r1).toMatchObject({ marked: roll.length, absent: 1, late: 1, notified: 1, corrected: 0 });
    expect(await alerts()).toBeGreaterThan(before);
    const saved = await db.studentAttendance.findUniqueOrThrow({ where: { studentId_date: { studentId: absentee, date: today() } } });
    expect(saved.status).toBe("ABSENT");
    expect(saved.parentNotifiedAt).not.toBeNull();
    expect(saved.markedByName).toBe(teacher.name);

    // Saving again does not alert the parents twice.
    const r2 = await asUser(teacher.id, () => svc.saveStudentRegister(teacher, sec5A, today(), entries));
    expect(r2.notified).toBe(0);

    // Marked absent by mistake: parents get a correction and the flag is cleared.
    const fixed = entries.map((e) => (e.studentId === absentee ? { ...e, status: "PRESENT" as const } : e));
    const r3 = await asUser(teacher.id, () => svc.saveStudentRegister(teacher, sec5A, today(), fixed));
    expect(r3).toMatchObject({ absent: 0, corrected: 1 });
    const after = await db.studentAttendance.findUniqueOrThrow({ where: { studentId_date: { studentId: absentee, date: today() } } });
    expect(after.status).toBe("PRESENT");
    expect(after.parentNotifiedAt).toBeNull();
  });

  it("keeps teachers to their own class and to today; the office can correct any class and past day", async () => {
    const roll8B = await svc.sectionRegister(ctx.branchId, sec8B, today());
    const all = roll8B.map((r) => ({ studentId: r.student.id, status: "PRESENT" as const }));
    await expect(svc.saveStudentRegister(teacher, sec8B, today(), all)).rejects.toThrow(/class teacher or the office/);

    const yesterday = addDays(today(), -1);
    const roll5A = await svc.sectionRegister(ctx.branchId, sec5A, yesterday);
    const all5A = roll5A.map((r) => ({ studentId: r.student.id, status: "PRESENT" as const }));
    await expect(svc.saveStudentRegister(teacher, sec5A, yesterday, all5A)).rejects.toThrow(/correct an earlier day/);
    await expect(svc.saveStudentRegister(teacher, sec5A, addDays(today(), 1), all5A)).rejects.toThrow(/future/);

    // Office corrects yesterday for 8B with an absence: saved, but no parent alert for a past day.
    const roll8BY = await svc.sectionRegister(ctx.branchId, sec8B, yesterday);
    const r = await asUser(office.id, () => svc.saveStudentRegister(office, sec8B, yesterday, roll8BY.map((x, i) => ({ studentId: x.student.id, status: (i === 0 ? "ABSENT" : "PRESENT") as "ABSENT" | "PRESENT" }))));
    expect(r).toMatchObject({ absent: 1, notified: 0 });
  });

  it("refuses holidays and incomplete registers", async () => {
    const sunday = addDays(today(), -3); // Sunday 15 Nov 2026
    expect(sunday.getUTCDay()).toBe(0);
    const roll = await svc.sectionRegister(ctx.branchId, sec5A, sunday);
    await expect(svc.saveStudentRegister(office, sec5A, sunday, roll.map((r) => ({ studentId: r.student.id, status: "PRESENT" as const })))).rejects.toThrow(/not a school day/);
    const rollToday = await svc.sectionRegister(ctx.branchId, sec8B, today());
    await expect(svc.saveStudentRegister(office, sec8B, today(), rollToday.slice(1).map((r) => ({ studentId: r.student.id, status: "PRESENT" as const })))).rejects.toThrow(/every student/);
  });
});

describe("overview, reminder and report", () => {
  it("shows unmarked classes and reminds their class teachers", async () => {
    const ov = await svc.attendanceOverview(ctx.branchId, today());
    const a5 = ov.find((s) => s.sectionId === sec5A)!;
    expect(a5.marked).toBe(a5.students);
    const unmarked = ov.filter((s) => s.students > 0 && s.marked === 0);
    expect(unmarked.length).toBeGreaterThan(0);
    const dash = await svc.attendanceDashboard(ctx.branchId);
    expect(dash.unmarked.length).toBe(unmarked.length);

    const teacher2 = await db.user.findUniqueOrThrow({ where: { email: "prakash@school.test" } }); // class teacher of 8B, not marked today
    const before = await db.notification.count({ where: { userId: teacher2.id, category: "ATTENDANCE" } });
    const msg = await svc.attendanceReminder();
    expect(msg).toMatch(/unmarked class/);
    expect(await db.notification.count({ where: { userId: teacher2.id, category: "ATTENDANCE" } })).toBe(before + 1);
  });

  it("reports attendance by student and finds chronic absentees from the mock history", async () => {
    const report = studentReports.find((r) => r.key === "students-attendance")!;
    const user = { ...(await asAttendanceUser("admin@school.test")) } as never;
    const all = await report.run({}, { user, branchId: ctx.branchId });
    expect(all.rows.length).toBeGreaterThan(100);
    const low = await report.run({ status: "below75" }, { user, branchId: ctx.branchId });
    expect(low.rows.length).toBeGreaterThan(0);
    expect(low.rows.every((r) => Number(r.percent) < 75)).toBe(true);
    const byClass = await report.run({ groupBy: "class" }, { user, branchId: ctx.branchId });
    expect(byClass.rows.length).toBeGreaterThan(10);
  });
});

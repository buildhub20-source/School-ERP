import { describe, expect, it, beforeAll, vi } from "vitest";

// A fixed school day (Wednesday 18 Nov 2026, 10:30 IST) so "today" is a working day. Set before the data store loads.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-18T05:00:00.000Z"));

const { db } = await import("@/lib/db");
const { today } = await import("@/lib/format");
const svc = await import("@/server/attendance/service");
const { sendAttendanceReport, reportPreview } = await import("@/server/attendance/report");
const { testCtx, asUser } = await import("./helpers");
const { syncRoles } = await import("@/lib/role-sync");

let ctx: Awaited<ReturnType<typeof testCtx>>;
let office: { id: string; name: string; branchId: string; roleKey: string; permissions: string[] };
let sec: string;
let absentee = "";
const none = { admins: false, teachers: false, staff: false, absentParents: false, presentParents: false };
const notes = (title: string) => db.notification.count({ where: { category: "ATTENDANCE", title: { contains: title } } });

beforeAll(async () => {
  await syncRoles();
  ctx = await testCtx();
  const u = await db.user.findUniqueOrThrow({ where: { email: "admin@school.test" }, include: { role: true } });
  office = { id: u.id, name: u.name, branchId: u.branchId, roleKey: u.role.key, permissions: u.role.permissions };
  sec = (await db.section.findFirstOrThrow({ where: { name: "A", schoolClass: { branchId: ctx.branchId, name: "Class 3" } } })).id;
  const roll = await svc.sectionRegister(ctx.branchId, sec, today());
  absentee = roll[0].student.id;
  await asUser(office.id, () => svc.saveStudentRegister(office, sec, today(), roll.map((r, i) => ({ studentId: r.student.id, status: i === 0 ? "ABSENT" as const : "PRESENT" as const }))));
});

describe("send attendance report", () => {
  it("previews counts per class and who can be reached", async () => {
    const p = await reportPreview(ctx.branchId, today());
    const row = p.sections.find((s) => s.sectionId === sec)!;
    expect(row.marked).toBeGreaterThan(1);
    expect(row.counts.absent).toBe(1);
    expect(p.admins).toBeGreaterThan(0);
  });

  it("needs a group and a marked class", async () => {
    await expect(sendAttendanceReport(ctx.branchId, { date: today(), sectionIds: [sec], recipients: none, skipAlerted: true, channels: [] })).rejects.toThrow(/at least one group/);
    const unmarked = (await reportPreview(ctx.branchId, today())).sections.find((s) => s.marked === 0)!;
    await expect(sendAttendanceReport(ctx.branchId, { date: today(), sectionIds: [unmarked.sectionId], recipients: { ...none, admins: true }, skipAlerted: true, channels: [] })).rejects.toThrow(/No attendance has been marked/);
  });

  it("sends the summary to admins and the class report to the class teacher", async () => {
    const before = await notes("Attendance report");
    const r = await asUser(office.id, () => sendAttendanceReport(ctx.branchId, { date: today(), sectionIds: [sec], recipients: { ...none, admins: true, teachers: true }, skipAlerted: true, channels: [] }));
    expect(r.admins).toBeGreaterThan(0);
    expect(r.staff).toBe(0);
    expect(await notes("Attendance report")).toBe(before + r.admins);
    const s = await db.section.findUniqueOrThrow({ where: { id: sec } });
    expect(r.teachers).toBe(s.classTeacherId ? 1 : 0);
  });

  it("skips parents already alerted about an absence unless asked, and tells parents of present children", async () => {
    const r1 = await asUser(office.id, () => sendAttendanceReport(ctx.branchId, { date: today(), sectionIds: [sec], recipients: { ...none, absentParents: true }, skipAlerted: true, channels: [] }));
    expect(r1).toMatchObject({ absentParents: 0, skipped: 1 });
    const r2 = await asUser(office.id, () => sendAttendanceReport(ctx.branchId, { date: today(), sectionIds: [sec], recipients: { ...none, absentParents: true }, skipAlerted: false, channels: [] }));
    expect(r2.absentParents).toBe(1);
    const r3 = await asUser(office.id, () => sendAttendanceReport(ctx.branchId, { date: today(), sectionIds: [sec], recipients: { ...none, presentParents: true }, skipAlerted: true, channels: ["SMS"] }));
    const present = await db.studentAttendance.count({ where: { sectionId: sec, date: today(), status: { not: "ABSENT" } } });
    expect(r3.presentParents).toBe(present);
    expect(absentee).toBeTruthy();
  });
});

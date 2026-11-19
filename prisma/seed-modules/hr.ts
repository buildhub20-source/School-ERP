import type { SeedCtx } from "../seed";
import type { StaffAttendanceStatus } from "@prisma/client";
import { db } from "../../src/lib/db";
import { addDays, today } from "../../src/lib/format";
import { applyLeave, decideLeave, dayOff, profilesFromLogins, saveLeaveType, saveRegister, saveStaff, workCalendar, addStaffDocument } from "../../src/server/hr/service";

const d = (s: string) => new Date(s + "T00:00:00.000Z");

/** Demo HR data (idempotent: runs only when the branch has no leave types). */
export async function seed_hr(ctx: SeedCtx) {
  const b = ctx.branchId;
  if ((await db.leaveType.count({ where: { branchId: b } })) > 0) return;
  const types = {
    CL: await saveLeaveType(b, { name: "Casual leave", code: "CL", daysPerYear: 12, isPaid: true, allowHalfDay: true, carryForwardMax: 0, sortOrder: 1 }),
    SL: await saveLeaveType(b, { name: "Sick leave", code: "SL", daysPerYear: 10, isPaid: true, allowHalfDay: true, carryForwardMax: 0, sortOrder: 2 }),
    EL: await saveLeaveType(b, { name: "Earned leave", code: "EL", daysPerYear: 15, isPaid: true, allowHalfDay: false, carryForwardMax: 30, sortOrder: 3 }),
    LOP: await saveLeaveType(b, { name: "Loss of pay", code: "LOP", daysPerYear: 0, isPaid: false, allowHalfDay: true, carryForwardMax: 0, sortOrder: 4 }),
  };

  // Profiles for every staff login, then the details the office would fill in.
  await profilesFromLogins(b);
  const byUser = async (key: string) => db.staffProfile.findUniqueOrThrow({ where: { userId: ctx.users[key] } });
  const details: Record<string, { designation: string; joined: string; q?: string; subjects?: string; prior?: number; category?: "TEACHING" | "NON_TEACHING" }> = {
    admin: { designation: "Administrative Officer", joined: "2015-06-01", q: "MBA", prior: 4, category: "NON_TEACHING" },
    accountant: { designation: "Accountant", joined: "2017-04-10", q: "B.Com., CA Inter", prior: 3, category: "NON_TEACHING" },
    store: { designation: "Store Keeper", joined: "2019-07-01", q: "B.A.", category: "NON_TEACHING" },
    transport: { designation: "Transport In-charge", joined: "2018-06-15", q: "Diploma in Automobile Engg.", prior: 6, category: "NON_TEACHING" },
    librarian: { designation: "Librarian", joined: "2016-06-01", q: "M.L.I.Sc.", prior: 2, category: "NON_TEACHING" },
    hr: { designation: "Office Manager (HR)", joined: "2018-01-08", q: "M.A. Human Resource Management", prior: 3, category: "NON_TEACHING" },
    warden: { designation: "Hostel Warden", joined: "2020-06-01", q: "B.A., B.Ed.", category: "NON_TEACHING" },
    teacher1: { designation: "BT Assistant – Science", joined: "2014-06-02", q: "M.Sc. Chemistry, B.Ed.", subjects: "Science", prior: 3 },
    teacher2: { designation: "PG Assistant – Mathematics", joined: "2012-06-04", q: "M.Sc. Mathematics, B.Ed.", subjects: "Mathematics", prior: 5 },
    teacher3: { designation: "BT Assistant – Tamil", joined: "2016-06-01", q: "M.A. Tamil, B.Ed.", subjects: "Tamil", prior: 1 },
    teacher4: { designation: "Computer Instructor", joined: "2021-06-01", q: "MCA", subjects: "Computer Science", prior: 2 },
  };
  for (const [key, x] of Object.entries(details)) {
    if (!ctx.users[key]) continue;
    const p = await byUser(key);
    await db.staffProfile.update({ where: { id: p.id }, data: { designation: x.designation, joiningDate: d(x.joined), qualifications: x.q, subjects: x.subjects, priorExperienceYears: x.prior, category: x.category ?? "TEACHING" } });
  }

  // Staff without a login.
  const depts = Object.fromEntries((await db.department.findMany({ where: { branchId: b } })).map((x) => [x.name, x.id]));
  const t = today();
  const extra = [
    { name: "Meena Sundaram", designation: "PG Assistant – Chemistry", category: "TEACHING" as const, employmentType: "PROBATION" as const, joiningDate: addDays(t, -160), probationEndsOn: addDays(t, 20), departmentId: depts.Science, qualifications: "M.Sc. Chemistry, B.Ed.", subjects: "Chemistry", gender: "FEMALE" as const, phone: "9000000021" },
    { name: "Dinesh Babu", designation: "Lab Assistant", category: "NON_TEACHING" as const, employmentType: "CONTRACT" as const, joiningDate: d("2023-06-12"), departmentId: depts.Science, qualifications: "B.Sc.", gender: "MALE" as const, phone: "9000000022" },
    { name: "Kumaravel S", designation: "Office Assistant", category: "NON_TEACHING" as const, employmentType: "PERMANENT" as const, joiningDate: d("2018-01-08"), departmentId: depts.Office, gender: "MALE" as const, phone: "9000000023" },
    { name: "Ramesh Kumar", designation: "Security Guard", category: "SUPPORT" as const, employmentType: "CONTRACT" as const, joiningDate: d("2022-03-01"), gender: "MALE" as const, phone: "9000000024" },
    { name: "Saroja Mani", designation: "Housekeeping", category: "SUPPORT" as const, employmentType: "PERMANENT" as const, joiningDate: d("2019-09-02"), gender: "FEMALE" as const, phone: "9000000025" },
  ];
  const made: Record<string, string> = {};
  for (const x of extra) made[x.name] = (await saveStaff(b, x)).id;
  const t1 = await byUser("teacher1"), t2 = await byUser("teacher2"), t3 = await byUser("teacher3"), t4 = await byUser("teacher4"), acc = await byUser("accountant"), store = await byUser("store");
  await addStaffDocument(b, t1.id, { title: "B.Ed. degree certificate", number: "TNTEU/2013/44721" });
  await addStaffDocument(b, made["Ramesh Kumar"], { title: "Police verification", number: "CHN/PV/2025/1187", expiresOn: addDays(t, 15) });
  await addStaffDocument(b, made["Meena Sundaram"], { title: "Offer letter (probation)", expiresOn: addDays(t, 20) });

  // Registers for the last two weeks (up to yesterday): mostly present, a few late, the odd absence.
  const staff = await db.staffProfile.findMany({ where: { branchId: b, isActive: true }, orderBy: { name: "asc" } });
  const cal = await workCalendar(b, addDays(t, -14), t);
  for (let back = 14; back >= 1; back--) {
    const day = addDays(t, -back);
    if (dayOff(cal, day)) continue;
    const entries = staff.filter((s) => s.joiningDate <= day).map((s, i) => {
      const k = (i * 7 + back * 3) % 23;
      const status: StaffAttendanceStatus = k === 0 ? "ABSENT" : k === 5 || k === 11 ? "LATE" : "PRESENT";
      return { staffId: s.id, status };
    });
    await saveRegister(b, "Lakshmi Devi", day, entries);
  }
  // Today: the office has marked part of the register so far.
  if (!dayOff(cal, t)) await saveRegister(b, "Lakshmi Devi", t, staff.slice(0, 6).map((s) => ({ staffId: s.id, status: "PRESENT" as const })));

  // Leave: approved in the past (shows on the register), on leave today, pending, rejected and upcoming with a substitute.
  const approver = { name: "Rekha Srinivasan", userId: ctx.users.admin };
  const ahead = await workCalendar(b, t, addDays(t, 45));
  const nextWorking = (from: Date) => { let x = from; while (dayOff(ahead, x)) x = addDays(x, 1); return x; };
  const past: Date[] = [];
  for (let x = addDays(t, -6); past.length < 2 && x < t; x = addDays(x, 1)) if (!dayOff(cal, x)) past.push(x);
  if (past.length === 2) await applyLeave(b, t2.name, { staffId: t2.id, leaveTypeId: types.CL.id, fromDate: past[0], toDate: past[1], reason: "Family function in Madurai" }, { approveAs: approver });
  await applyLeave(b, "Lakshmi Devi", { staffId: made["Saroja Mani"], leaveTypeId: types.SL.id, fromDate: addDays(t, -1), toDate: addDays(t, 1), reason: "Fever" }, { approveAs: approver });
  await applyLeave(b, t1.name, { staffId: t1.id, leaveTypeId: types.SL.id, fromDate: nextWorking(addDays(t, 1)), toDate: nextWorking(addDays(t, 1)), halfDay: true, reason: "Doctor's appointment in the afternoon" });
  await applyLeave(b, acc.name, { staffId: acc.id, leaveTypeId: types.CL.id, fromDate: nextWorking(addDays(t, 7)), toDate: addDays(nextWorking(addDays(t, 7)), 1), reason: "Personal work at the bank and registrar office" });
  const rej = await applyLeave(b, store.name, { staffId: store.id, leaveTypeId: types.CL.id, fromDate: nextWorking(addDays(t, 3)), toDate: nextWorking(addDays(t, 3)), reason: "Personal" });
  await decideLeave(b, approver.name, rej.id, { approve: false, note: "Uniform distribution that day; please pick another date." }, approver.userId);
  const el = await applyLeave(b, t3.name, { staffId: t3.id, leaveTypeId: types.EL.id, fromDate: nextWorking(addDays(t, 20)), toDate: addDays(nextWorking(addDays(t, 20)), 2), reason: "Sister's wedding" });
  await decideLeave(b, approver.name, el.id, { approve: true, substituteId: t4.id }, approver.userId);
}

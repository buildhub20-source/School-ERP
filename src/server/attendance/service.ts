import "server-only";
import type { StudentAttendanceStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { hasPerm } from "@/lib/permissions";
import { automation } from "@/lib/automations/config";
import { notifyGuardians, notifyPermission, notifyUsers } from "@/lib/messaging/notify";
import { addDays, fmtDate, fullName, isoDate, today } from "@/lib/format";
import { dayOff, workCalendar } from "@/server/hr/service";

/**
 * STUDENT ATTENDANCE — the daily register per section.
 * Class teachers mark their own class for today; users with attendance.manage mark or correct any class on any past day.
 * Absences marked for today are sent to the parents straight away (automation "attendance.absentAlert"); if an absence is
 * corrected later, the parents are told it was a mistake. Working days follow the school calendar (HR rules + holidays).
 */

export type AttendanceUser = { id: string; name: string; branchId: string; roleKey: string; permissions: string[] };
export type Counts = { present: number; late: number; half: number; absent: number };
export const STATUS_LABEL: Record<StudentAttendanceStatus, string> = { PRESENT: "Present", LATE: "Late", HALF_DAY: "Half day", ABSENT: "Absent" };

/**
 * Attendance percentage for a set of marked days.
 * Late counts as present (the child was in school), a half day counts as half, absent counts as zero.
 * Days that were never marked are left out, so an unmarked day does not pull a child's percentage down.
 */
export function attendancePercent(c: Counts): number | null {
  const marked = c.present + c.late + c.half + c.absent;
  if (marked === 0) return null;
  return Math.round(((c.present + c.late + c.half * 0.5) / marked) * 1000) / 10;
}

export function countStatuses(rows: { status: StudentAttendanceStatus }[]): Counts {
  const c: Counts = { present: 0, late: 0, half: 0, absent: 0 };
  for (const r of rows) {
    if (r.status === "PRESENT") c.present++;
    else if (r.status === "LATE") c.late++;
    else if (r.status === "HALF_DAY") c.half++;
    else c.absent++;
  }
  return c;
}

/** Why the school is closed on this day (holiday, weekly off), or null on a school day. */
export async function schoolClosedReason(branchId: string, date: Date): Promise<string | null> {
  return dayOff(await workCalendar(branchId, date, date), date);
}

/** Sections the user may mark today as class teacher. */
export function myTeacherSections(userId: string) {
  return db.section.findMany({ where: { classTeacherId: userId }, include: { schoolClass: true }, orderBy: [{ schoolClass: { grade: "asc" } }, { name: "asc" }] });
}

/** Can this user mark this section on this date? Returns the reason when not. */
export function markPermission(user: AttendanceUser, section: { classTeacherId: string | null }, date: Date): { ok: true } | { ok: false; reason: string } {
  const t = today();
  if (date > t) return { ok: false, reason: "Attendance cannot be marked for a future date." };
  if (hasPerm(user, "attendance.manage")) return { ok: true };
  if (!hasPerm(user, "attendance.mark") || section.classTeacherId !== user.id) return { ok: false, reason: "Only the class teacher or the office can mark this class." };
  if (date.getTime() !== t.getTime()) return { ok: false, reason: "Class teachers mark today's register. Ask the office to correct an earlier day." };
  return { ok: true };
}

export async function loadSection(branchId: string, sectionId: string) {
  const section = await db.section.findFirst({ where: { id: sectionId, schoolClass: { branchId } }, include: { schoolClass: true, classTeacher: { select: { id: true, name: true } } } });
  if (!section) throw new AppError("Class not found.");
  return section;
}

/** Students on the section's roll that day (active, admitted on or before the date), with any saved marks. */
export async function sectionRegister(branchId: string, sectionId: string, date: Date) {
  const [students, marks] = await Promise.all([
    db.student.findMany({
      where: { branchId, sectionId, status: "ACTIVE", admissionDate: { lte: date } },
      select: { id: true, firstName: true, lastName: true, rollNo: true, admissionNo: true, photoUrl: true },
      orderBy: [{ rollNo: "asc" }, { firstName: "asc" }],
    }),
    db.studentAttendance.findMany({ where: { sectionId, date } }),
  ]);
  const byStudent = new Map(marks.map((m) => [m.studentId, m]));
  // Roll numbers are text: sort "2" before "10".
  students.sort((a, b) => (Number(a.rollNo) || 9999) - (Number(b.rollNo) || 9999) || a.firstName.localeCompare(b.firstName));
  return students.map((s) => ({ student: s, mark: byStudent.get(s.id) ?? null }));
}

type Entry = { studentId: string; status: StudentAttendanceStatus; note?: string };

/** Save a section's register for a day. Notifies parents of today's absences and of corrections. */
export async function saveStudentRegister(user: AttendanceUser, sectionId: string, date: Date, entries: Entry[]) {
  const section = await loadSection(user.branchId, sectionId);
  const can = markPermission(user, section, date);
  if (!can.ok) throw new AppError(can.reason, "FORBIDDEN");
  const closed = await schoolClosedReason(user.branchId, date);
  if (closed) throw new AppError(`${fmtDate(date)} is not a school day (${closed}). No attendance is taken.`);
  const roll = await sectionRegister(user.branchId, sectionId, date);
  const onRoll = new Set(roll.map((r) => r.student.id));
  if (entries.some((e) => !onRoll.has(e.studentId))) throw new AppError("The list has a student who is not in this class. Reload the page and try again.");
  if (entries.length !== onRoll.size) throw new AppError("Mark every student in the class before saving.");

  const before = new Map(roll.filter((r) => r.mark).map((r) => [r.student.id, r.mark!]));
  await db.$transaction(async (tx) => {
    for (const e of entries) {
      const ex = before.get(e.studentId);
      if (ex && ex.status === e.status && (ex.note ?? null) === (e.note ?? null)) continue;
      await tx.studentAttendance.upsert({
        where: { studentId_date: { studentId: e.studentId, date } },
        create: { branchId: user.branchId, studentId: e.studentId, sectionId, date, status: e.status, note: e.note ?? null, markedById: user.id, markedByName: user.name },
        update: { status: e.status, note: e.note ?? null, markedById: user.id, markedByName: user.name, sectionId },
      });
    }
  });

  // Parent alerts: only for today's register (an old day corrected by the office is not news to parents).
  let notified = 0, corrected = 0;
  if (date.getTime() === today().getTime()) {
    const a = await automation("attendance.absentAlert");
    if (a.enabled) {
      const tellLate = a.config.notifyLate === true;
      const names = new Map(roll.map((r) => [r.student.id, r.student]));
      for (const e of entries) {
        const ex = before.get(e.studentId);
        const s = names.get(e.studentId)!;
        const alertable = e.status === "ABSENT" || (tellLate && e.status === "LATE");
        if (alertable && !ex?.parentNotifiedAt) {
          await notifyGuardians(e.studentId, e.status === "ABSENT" ? {
            title: `${s.firstName} is absent today`,
            body: `${fullName(s)} was marked absent in class today (${fmtDate(date)}). If this is a mistake or your child is unwell, please inform the class teacher.`,
            link: "/parent/attendance", category: "ATTENDANCE", template: "STUDENT_ABSENT",
            ta: { title: `${s.firstName} இன்று வரவில்லை`, body: `${fullName(s)} இன்று (${fmtDate(date)}) வகுப்பில் வரவில்லை எனக் குறிக்கப்பட்டுள்ளது. இது தவறு என்றால் அல்லது உங்கள் குழந்தைக்கு உடல்நலம் சரியில்லை என்றால், வகுப்பு ஆசிரியருக்குத் தெரிவிக்கவும்.` },
          } : {
            title: `${s.firstName} came late today`,
            body: `${fullName(s)} reached class late today (${fmtDate(date)}).`,
            link: "/parent/attendance", category: "ATTENDANCE", template: "STUDENT_ABSENT",
            ta: { title: `${s.firstName} இன்று தாமதமாக வந்தார்`, body: `${fullName(s)} இன்று (${fmtDate(date)}) வகுப்புக்குத் தாமதமாக வந்தார்.` },
          });
          await db.studentAttendance.update({ where: { studentId_date: { studentId: e.studentId, date } }, data: { parentNotifiedAt: new Date() } });
          notified++;
        } else if (!alertable && ex?.parentNotifiedAt) {
          await notifyGuardians(e.studentId, {
            title: `Correction: ${s.firstName} is in school today`,
            body: `Sorry — ${fullName(s)} was marked by mistake earlier. Your child is in school today (${fmtDate(date)}).`,
            link: "/parent/attendance", category: "ATTENDANCE", template: "STUDENT_ABSENT",
            ta: { title: `திருத்தம்: ${s.firstName} இன்று பள்ளியில் உள்ளார்`, body: `மன்னிக்கவும் — ${fullName(s)} முன்பு தவறாகக் குறிக்கப்பட்டார். உங்கள் குழந்தை இன்று (${fmtDate(date)}) பள்ளியில் உள்ளார்.` },
          });
          await db.studentAttendance.update({ where: { studentId_date: { studentId: e.studentId, date } }, data: { parentNotifiedAt: null } });
          corrected++;
        }
      }
    }
  }
  const c = countStatuses(entries);
  return { marked: entries.length, ...c, notified, corrected };
}

/** One row per section for a day: who is the class teacher, whether the register is marked, and the counts. */
export async function attendanceOverview(branchId: string, date: Date) {
  const [sections, strength, marks] = await Promise.all([
    db.section.findMany({ where: { schoolClass: { branchId } }, include: { schoolClass: true, classTeacher: { select: { name: true } } }, orderBy: [{ schoolClass: { grade: "asc" } }, { name: "asc" }] }),
    db.student.groupBy({ by: ["sectionId"], where: { branchId, status: "ACTIVE", sectionId: { not: null } }, _count: true }),
    db.studentAttendance.findMany({ where: { branchId, date }, select: { sectionId: true, status: true, markedByName: true, updatedAt: true } }),
  ]);
  return sections.map((s) => {
    const mine = marks.filter((m) => m.sectionId === s.id);
    const last = mine.reduce<(typeof mine)[number] | null>((a, m) => (!a || m.updatedAt > a.updatedAt ? m : a), null);
    const counts = countStatuses(mine);
    return {
      sectionId: s.id, classId: s.classId, label: `${s.schoolClass.name}-${s.name}`, grade: s.schoolClass.grade, teacher: s.classTeacher?.name ?? null,
      students: strength.find((x) => x.sectionId === s.id)?._count ?? 0, marked: mine.length, counts, percent: attendancePercent(counts),
      markedBy: last?.markedByName ?? null, markedAt: last?.updatedAt ?? null,
    };
  }).filter((s) => s.students > 0 || s.marked > 0);
}

/** Students absent (or late / half day) on a day, with parent contact and whether the parents were told. */
export function absenteesOn(branchId: string, date: Date) {
  return db.studentAttendance.findMany({
    where: { branchId, date, status: { in: ["ABSENT", "LATE", "HALF_DAY"] } },
    include: { student: { include: { schoolClass: true, section: true, guardians: { where: { isPrimary: true }, include: { guardian: true } } } } },
    orderBy: [{ status: "asc" }, { student: { firstName: "asc" } }],
  });
}

/** Month view for one section: every student × every day, with each student's percentage for the month. */
export async function monthGrid(branchId: string, sectionId: string, month: string /* YYYY-MM */) {
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = addDays(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1)), -1);
  const [cal, students, marks] = await Promise.all([
    workCalendar(branchId, from, to),
    db.student.findMany({ where: { branchId, sectionId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true, rollNo: true } }),
    db.studentAttendance.findMany({ where: { sectionId, date: { gte: from, lte: to } }, select: { studentId: true, date: true, status: true } }),
  ]);
  students.sort((a, b) => (Number(a.rollNo) || 9999) - (Number(b.rollNo) || 9999) || a.firstName.localeCompare(b.firstName));
  const days: { date: Date; off: string | null }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push({ date: d, off: dayOff(cal, d) });
  const key = (sid: string, d: Date) => `${sid}|${isoDate(d)}`;
  const byKey = new Map(marks.map((m) => [key(m.studentId, m.date), m.status]));
  return {
    from, to, days,
    rows: students.map((s) => {
      const mine = marks.filter((m) => m.studentId === s.id);
      const counts = countStatuses(mine);
      return { student: s, cells: days.map((d) => byKey.get(key(s.id, d.date)) ?? null), counts, percent: attendancePercent(counts) };
    }),
  };
}

/** A student's attendance between two dates: counts, percentage and the days they were not fully present. */
export async function studentAttendanceSummary(studentId: string, from: Date, to: Date) {
  const rows = await db.studentAttendance.findMany({ where: { studentId, date: { gte: from, lte: to } }, orderBy: { date: "desc" } });
  const counts = countStatuses(rows);
  return { counts, percent: attendancePercent(counts), marked: rows.length, notPresent: rows.filter((r) => r.status !== "PRESENT").map((r) => ({ date: r.date, status: r.status, note: r.note })) };
}

export type TrendDay = { date: string; marked: number; absent: number; late: number; half: number; sections: number; percent: number | null };

/**
 * Attendance over the last `days` school days up to `upTo`: one row per day a register was marked, with each status as a
 * share of the students marked that day (so a day where only some classes are marked is still comparable), plus the
 * students whose attendance over the same period is below `watchBelow` percent.
 */
export async function attendanceTrend(branchId: string, upTo: Date, days = 30, watchBelow = 90) {
  // Look back far enough to cover `days` school days through holidays and weekly offs.
  const rows = await db.studentAttendance.findMany({
    where: { branchId, date: { gte: addDays(upTo, -Math.ceil(days * 2)), lte: upTo } },
    select: { date: true, sectionId: true, studentId: true, status: true },
  });
  const byDay = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = isoDate(r.date);
    const list = byDay.get(k);
    if (list) list.push(r); else byDay.set(k, [r]);
  }
  const keep = [...byDay.keys()].sort().slice(-days);
  const trend: TrendDay[] = keep.map((k) => {
    const list = byDay.get(k)!;
    const c = countStatuses(list);
    return { date: k, marked: list.length, absent: c.absent, late: c.late, half: c.half, sections: new Set(list.map((r) => r.sectionId)).size, percent: attendancePercent(c) };
  });

  const inWindow = new Set(keep);

  // Per class (section) over the same days, for comparing classes.
  const perSection = new Map<string, (typeof rows)>();
  for (const r of rows) {
    if (!r.sectionId || !inWindow.has(isoDate(r.date))) continue;
    const list = perSection.get(r.sectionId);
    if (list) list.push(r); else perSection.set(r.sectionId, [r]);
  }
  const bySection = [...perSection].map(([sectionId, list]) => {
    const c = countStatuses(list);
    return { sectionId, marked: list.length, absent: c.absent, half: c.half, late: c.late, percent: attendancePercent(c) };
  });

  // Students to watch: enough marked days in the window to be meaningful, and below the threshold.
  const perStudent = new Map<string, (typeof rows)>();
  for (const r of rows) {
    if (!inWindow.has(isoDate(r.date))) continue;
    const list = perStudent.get(r.studentId);
    if (list) list.push(r); else perStudent.set(r.studentId, [r]);
  }
  const minDays = Math.min(5, keep.length);
  const low = [...perStudent].map(([studentId, list]) => {
    const c = countStatuses(list);
    return { studentId, counts: c, marked: list.length, percent: attendancePercent(c) ?? 100 };
  }).filter((s) => s.marked >= minDays && s.percent < watchBelow).sort((a, b) => a.percent - b.percent);
  const students = low.length ? await db.student.findMany({ where: { id: { in: low.map((s) => s.studentId) } }, include: { schoolClass: true, section: true } }) : [];
  const watch = low.map((s) => ({ ...s, student: students.find((x) => x.id === s.studentId)! })).filter((s) => s.student && s.student.status === "ACTIVE");
  return { trend, watch, watchBelow, bySection };
}

/** Dashboard figures for today. */
export async function attendanceDashboard(branchId: string) {
  const t = today();
  const closed = await schoolClosedReason(branchId, t);
  if (closed) return { closed, sections: 0, unmarked: [] as string[], percent: null, absent: 0, students: 0 };
  const ov = await attendanceOverview(branchId, t);
  const withStudents = ov.filter((s) => s.students > 0);
  const total = withStudents.reduce<Counts>((a, s) => ({ present: a.present + s.counts.present, late: a.late + s.counts.late, half: a.half + s.counts.half, absent: a.absent + s.counts.absent }), { present: 0, late: 0, half: 0, absent: 0 });
  return {
    closed: null, sections: withStudents.length, unmarked: withStudents.filter((s) => s.marked === 0).map((s) => s.label),
    percent: attendancePercent(total), absent: total.absent, students: withStudents.reduce((a, s) => a + s.students, 0),
  };
}

/** Daily (mid-morning): remind class teachers whose register is not marked, and send the office the list. */
export async function attendanceReminder(): Promise<string> {
  const t = today();
  const branches = await db.branch.findMany({ where: { isActive: true }, select: { id: true } });
  let teachers = 0, sections = 0;
  for (const b of branches) {
    if (await schoolClosedReason(b.id, t)) continue;
    const ov = (await attendanceOverview(b.id, t)).filter((s) => s.students > 0 && s.marked === 0);
    if (!ov.length) continue;
    sections += ov.length;
    const secs = await db.section.findMany({ where: { id: { in: ov.map((s) => s.sectionId) } }, select: { id: true, classTeacherId: true } });
    for (const s of ov) {
      const teacherId = secs.find((x) => x.id === s.sectionId)?.classTeacherId;
      if (!teacherId) continue;
      await notifyUsers([teacherId], { title: `Mark today's attendance for ${s.label}`, body: `The register for ${s.label} is not marked yet. Parents of absent children are told as soon as it is saved.`, link: `/attendance/mark?sectionId=${s.sectionId}`, category: "ATTENDANCE", inAppOnly: true });
      teachers++;
    }
    await notifyPermission("attendance.manage", { title: `${ov.length} class${ov.length === 1 ? "" : "es"} not marked yet`, body: ov.map((s) => `${s.label}${s.teacher ? ` (${s.teacher})` : " (no class teacher)"}`).join(", "), link: "/attendance", category: "ATTENDANCE", inAppOnly: true }, b.id);
  }
  return `${sections} unmarked class(es), ${teachers} teacher reminder(s)`;
}

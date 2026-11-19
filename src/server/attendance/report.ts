import "server-only";
import type { Channel } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { fmtDate, fullName, isoDate } from "@/lib/format";
import { notifyGuardians, notifyUsers } from "@/lib/messaging/notify";
import { attendanceOverview, attendancePercent, countStatuses, schoolClosedReason, type Counts } from "./service";

/**
 * SEND ATTENDANCE REPORT — Attendance → Send report.
 * For one day and the chosen classes, sends the attendance to any mix of:
 *   admins (school summary), class teachers (their own class), all other staff (school summary),
 *   parents of absent students, and parents of present / late / half-day students.
 * Everyone gets it in the app plus their usual channel; SMS / WhatsApp / email can be added on top.
 * Parents of absent children are already alerted when the register is saved, so they are skipped by default.
 */

export type ReportRecipients = { admins: boolean; teachers: boolean; staff: boolean; absentParents: boolean; presentParents: boolean };
export type ReportInput = { date: Date; sectionIds: string[]; recipients: ReportRecipients; skipAlerted: boolean; channels: Channel[] };

const ADMIN_ROLES = ["SUPER_ADMIN", "SCHOOL_ADMIN"];
const NOT_STAFF = ["PARENT", "DRIVER"];
const sum = (rows: Counts[]) => rows.reduce<Counts>((a, c) => ({ present: a.present + c.present, late: a.late + c.late, half: a.half + c.half, absent: a.absent + c.absent }), { present: 0, late: 0, half: 0, absent: 0 });
const line = (c: Counts) => {
  const parts = [`${c.present + c.late + c.half} present`, `${c.absent} absent`];
  if (c.late) parts.push(`${c.late} late`);
  if (c.half) parts.push(`${c.half} half day`);
  const p = attendancePercent(c);
  return `${parts.join(", ")}${p === null ? "" : ` (${p}%)`}`;
};

/** Everything the Send report page shows before sending: per-class counts, who is marked, and how many people each choice reaches. */
export async function reportPreview(branchId: string, date: Date) {
  const [closed, sections, staff] = await Promise.all([
    schoolClosedReason(branchId, date),
    attendanceOverview(branchId, date),
    db.user.findMany({ where: { branchId, isActive: true, role: { key: { notIn: NOT_STAFF } } }, select: { id: true, role: { select: { key: true } } } }),
  ]);
  const teacherIds = await db.section.findMany({ where: { id: { in: sections.map((s) => s.sectionId) } }, select: { id: true, classTeacherId: true } });
  const teacherOf = new Map(teacherIds.map((s) => [s.id, s.classTeacherId]));
  return {
    closed,
    sections: sections.map((s) => ({ ...s, hasTeacher: !!teacherOf.get(s.sectionId) })),
    admins: staff.filter((u) => ADMIN_ROLES.includes(u.role.key)).length,
    staff: staff.filter((u) => !ADMIN_ROLES.includes(u.role.key)).length,
  };
}

export async function sendAttendanceReport(branchId: string, input: ReportInput) {
  const r = input.recipients;
  if (!r.admins && !r.teachers && !r.staff && !r.absentParents && !r.presentParents) throw new AppError("Tick at least one group to send the report to.");
  if (!input.sectionIds.length) throw new AppError("Choose at least one class.");
  const closed = await schoolClosedReason(branchId, input.date);
  if (closed) throw new AppError(`${fmtDate(input.date)} is not a school day (${closed}).`);

  const sections = (await attendanceOverview(branchId, input.date)).filter((s) => input.sectionIds.includes(s.sectionId));
  const marked = sections.filter((s) => s.marked > 0);
  if (!marked.length) throw new AppError(`No attendance has been marked on ${fmtDate(input.date)} for the chosen classes yet.`);
  const unmarked = sections.filter((s) => s.marked === 0 && s.students > 0).map((s) => s.label);

  const marks = await db.studentAttendance.findMany({
    where: { branchId, date: input.date, sectionId: { in: marked.map((s) => s.sectionId) } },
    include: { student: { select: { id: true, firstName: true, lastName: true, status: true } } },
    orderBy: { student: { firstName: "asc" } },
  });
  const day = fmtDate(input.date);
  const link = `/attendance?date=${isoDate(input.date)}`;
  const msgBase = { category: "ATTENDANCE", link, channels: input.channels };
  const label = new Map(sections.map((s) => [s.sectionId, s.label]));
  const absentBySection = new Map<string, string[]>();
  for (const m of marks) if (m.status === "ABSENT") absentBySection.set(m.sectionId, [...(absentBySection.get(m.sectionId) ?? []), fullName(m.student)]);

  const sent = { admins: 0, teachers: 0, staff: 0, absentParents: 0, presentParents: 0, skipped: 0 };

  // School summary for admins and / or other staff
  if (r.admins || r.staff) {
    const total = sum(marked.map((s) => s.counts));
    const absentLines = marked.filter((s) => absentBySection.get(s.sectionId)?.length)
      .map((s) => `${s.label}: ${absentBySection.get(s.sectionId)!.join(", ")}`);
    const body = [
      `Overall: ${line(total)} — ${marked.length} class${marked.length === 1 ? "" : "es"}.`,
      ...marked.map((s) => `${s.label}: ${line(s.counts)}`),
      absentLines.length ? `Absent — ${absentLines.join("; ")}` : "No absentees.",
      unmarked.length ? `Not marked yet: ${unmarked.join(", ")}.` : "",
    ].filter(Boolean).join("\n");
    const users = await db.user.findMany({ where: { branchId, isActive: true, role: { key: { notIn: NOT_STAFF } } }, select: { id: true, role: { select: { key: true } } } });
    const ids = users.filter((u) => (ADMIN_ROLES.includes(u.role.key) ? r.admins : r.staff)).map((u) => u.id);
    await notifyUsers(ids, { ...msgBase, title: `Attendance report — ${day}`, body });
    sent.admins = r.admins ? users.filter((u) => ADMIN_ROLES.includes(u.role.key)).length : 0;
    sent.staff = r.staff ? users.filter((u) => !ADMIN_ROLES.includes(u.role.key)).length : 0;
  }

  // Each class teacher gets their own class
  if (r.teachers) {
    const secs = await db.section.findMany({ where: { id: { in: marked.map((s) => s.sectionId) }, classTeacherId: { not: null } }, select: { id: true, classTeacherId: true } });
    for (const s of secs) {
      const counts = countStatuses(marks.filter((m) => m.sectionId === s.id));
      const absent = absentBySection.get(s.id) ?? [];
      await notifyUsers([s.classTeacherId!], { ...msgBase, title: `${label.get(s.id)} attendance — ${day}`, body: `${line(counts)}.${absent.length ? `\nAbsent: ${absent.join(", ")}` : "\nEveryone was present."}` });
      sent.teachers++;
    }
  }

  // Parents
  for (const m of marks) {
    if (m.student.status !== "ACTIVE") continue;
    const name = fullName(m.student);
    if (m.status === "ABSENT") {
      if (!r.absentParents) continue;
      if (input.skipAlerted && m.parentNotifiedAt) { sent.skipped++; continue; }
      await notifyGuardians(m.student.id, { ...msgBase, link: "/parent/attendance", title: `${name} was absent on ${day}`, body: `${name} was marked absent from school on ${day}${m.note ? ` (${m.note})` : ""}. Please contact the class teacher if this is not right.` });
      if (!m.parentNotifiedAt) await db.studentAttendance.update({ where: { id: m.id }, data: { parentNotifiedAt: new Date() } });
      sent.absentParents++;
    } else if (r.presentParents) {
      const how = m.status === "LATE" ? "came to school late" : m.status === "HALF_DAY" ? "attended school for half the day" : "was present at school";
      await notifyGuardians(m.student.id, { ...msgBase, link: "/parent/attendance", title: `${name} — attendance ${day}`, body: `${name} ${how} on ${day}.` });
      sent.presentParents++;
    }
  }

  return { ...sent, unmarked };
}

"use server";
import { z } from "zod";
import { defineAction, zs } from "@/lib/action";
import { dateOnly } from "@/lib/format";
import { saveStudentRegister } from "@/server/attendance/service";
import { sendAttendanceReport } from "@/server/attendance/report";

const R = ["/attendance", "/teacher/class", "/dashboard", "/students", "/parent"];
// A helper (not an inline arrow): inline functions in a "use server" file are compiled as server actions.
const day = () => z.coerce.date().transform((d) => dateOnly(d));

export const saveStudentRegisterAction = defineAction({
  perm: ["attendance.mark", "attendance.manage"], revalidate: R,
  schema: z.object({
    sectionId: zs.id,
    date: day(),
    entries: zs.json(z.array(z.object({ studentId: z.string(), status: z.enum(["PRESENT", "LATE", "HALF_DAY", "ABSENT"]), note: z.string().max(200).optional() }))),
  }),
}, async ({ sectionId, date, entries }, { user }) => {
  const r = await saveStudentRegister(user, sectionId, date, entries.map((e) => ({ ...e, note: e.note?.trim() || undefined })));
  const parts = [`${r.present + r.late + r.half} present`, `${r.absent} absent`];
  if (r.late) parts.push(`${r.late} late`);
  const told = r.notified ? ` · ${r.notified} parent alert${r.notified === 1 ? "" : "s"} sent` : "";
  const fixed = r.corrected ? ` · ${r.corrected} correction${r.corrected === 1 ? "" : "s"} sent` : "";
  return { message: `Attendance saved: ${parts.join(", ")}${told}${fixed}` };
});

const channel = z.enum(["SMS", "WHATSAPP", "EMAIL"]);

export const sendAttendanceReportAction = defineAction({
  perm: "attendance.manage",
  schema: z.object({
    date: day(), sectionIds: z.array(z.string()).optional().default([]), skipAlerted: zs.bool(), channels: z.array(channel).optional().default([]),
    admins: zs.bool(), teachers: zs.bool(), staff: zs.bool(), absentParents: zs.bool(), presentParents: zs.bool(),
  }),
}, async (i, { branchId }) => {
  const r = await sendAttendanceReport(branchId, {
    date: i.date, sectionIds: i.sectionIds, skipAlerted: i.skipAlerted, channels: i.channels,
    recipients: { admins: i.admins, teachers: i.teachers, staff: i.staff, absentParents: i.absentParents, presentParents: i.presentParents },
  });
  const parts = [
    r.admins && `${r.admins} admin${r.admins === 1 ? "" : "s"}`, r.teachers && `${r.teachers} class teacher${r.teachers === 1 ? "" : "s"}`,
    r.staff && `${r.staff} staff`, r.absentParents && `parents of ${r.absentParents} absent student${r.absentParents === 1 ? "" : "s"}`,
    r.presentParents && `parents of ${r.presentParents} present student${r.presentParents === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const extra = [r.skipped && `${r.skipped} already alerted skipped`, r.unmarked.length && `not marked: ${r.unmarked.join(", ")}`].filter(Boolean);
  return { ...r, message: parts.length ? `Report sent to ${parts.join(", ")}${extra.length ? ` (${extra.join("; ")})` : ""}` : `Nothing to send${extra.length ? ` (${extra.join("; ")})` : ""}` };
});

import { requireUserOrThrow } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildWorkbook, xlsxResponse } from "@/lib/excel";
import { studentWhere } from "@/server/students/service";
import { isoDate } from "@/lib/format";

export async function GET(req: Request) {
  let user;
  try { user = await requireUserOrThrow("students.view"); } catch { return new Response("Forbidden", { status: 403 }); }
  const p = new URL(req.url).searchParams;
  const where = studentWhere(user.branchId, { q: p.get("q") ?? undefined, classId: p.get("classId") ?? undefined, sectionId: p.get("sectionId") ?? undefined, status: p.get("status") ?? undefined, gender: p.get("gender") ?? undefined });
  const students = await db.student.findMany({ where, include: { schoolClass: true, section: true, guardians: { include: { guardian: true } } }, orderBy: [{ schoolClass: { grade: "asc" } }, { firstName: "asc" }] });
  const rows = students.map((s) => {
    const f = s.guardians.find((g) => g.relation === "Father")?.guardian;
    const m = s.guardians.find((g) => g.relation === "Mother")?.guardian;
    return {
      admissionNo: s.admissionNo, firstName: s.firstName, lastName: s.lastName, gender: s.gender, dob: s.dob ? isoDate(s.dob) : "", bloodGroup: s.bloodGroup,
      class: s.schoolClass.name, section: s.section?.name, rollNo: s.rollNo, admissionDate: isoDate(s.admissionDate), address: s.address,
      fatherName: f?.name, fatherPhone: f?.phone, motherName: m?.name, motherPhone: m?.phone, status: s.status,
    };
  });
  const cols = Object.keys(rows[0] ?? { admissionNo: 1 }).map((k) => ({ key: k, header: k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()) }));
  return xlsxResponse(await buildWorkbook([{ name: "Students", columns: cols, rows }]), `students-${isoDate()}.xlsx`);
}

import { db } from "@/lib/db";
import type { ReportDef } from "@/lib/reports/types";
import { dateWhere } from "@/lib/reports/parse";
import { fullName, isoDate, fmtDate } from "@/lib/format";
import { attendancePercent, countStatuses } from "@/server/attendance/service";

export const studentReports: ReportDef[] = [
  {
    key: "students-strength", title: "Class strength", description: "Active students by class and section, boys and girls, new admissions.", module: "Students", perm: "reports.students", filters: ["class"],
    async run(f, { branchId }) {
      const sections = await db.section.findMany({ where: { schoolClass: { branchId, ...(f.classId ? { id: f.classId } : {}) } }, include: { schoolClass: true, classTeacher: true }, orderBy: [{ schoolClass: { grade: "asc" } }, { name: "asc" }] });
      const counts = await db.student.groupBy({ by: ["sectionId", "gender"], where: { branchId, status: "ACTIVE" }, _count: true });
      // First day of the current month in school time (admissionDate is a date column, stored as UTC midnight).
      const monthStart = new Date(isoDate().slice(0, 7) + "-01T00:00:00.000Z");
      const fresh = await db.student.groupBy({ by: ["sectionId"], where: { branchId, status: "ACTIVE", admissionDate: { gte: monthStart } }, _count: true });
      const rows = sections.map((s) => {
        const c = (g: string) => counts.find((x) => x.sectionId === s.id && x.gender === g)?._count ?? 0;
        const boys = c("MALE"), girls = c("FEMALE"), other = c("OTHER");
        return { cls: s.schoolClass.name, section: s.name, teacher: s.classTeacher?.name ?? "", boys, girls, total: boys + girls + other, newThisMonth: fresh.find((x) => x.sectionId === s.id)?._count ?? 0 };
      });
      const sum = (k: "boys" | "girls" | "total" | "newThisMonth") => rows.reduce((a, r) => a + r[k], 0);
      return {
        columns: [{ key: "cls", label: "Class" }, { key: "section", label: "Section" }, { key: "teacher", label: "Class teacher" }, { key: "boys", label: "Boys", format: "number" }, { key: "girls", label: "Girls", format: "number" }, { key: "total", label: "Total", format: "number" }, { key: "newThisMonth", label: "New this month", format: "number" }],
        rows, totals: { cls: "Total", boys: sum("boys"), girls: sum("girls"), total: sum("total"), newThisMonth: sum("newThisMonth") },
        chart: { type: "bar", x: "cls", y: ["boys", "girls"] },
      };
    },
  },
  {
    key: "students-admissions", title: "Admissions and leavers", description: "Students admitted or who left in a period.", module: "Students", perm: "reports.students", filters: ["dateRange", "class"],
    groupBy: [{ value: "", label: "Admissions" }, { value: "left", label: "Leavers (left or graduated)" }],
    async run(f, { branchId }) {
      const left = f.groupBy === "left";
      const range = dateWhere(f, true);
      const students = await db.student.findMany({
        where: { branchId, ...(f.classId ? { classId: f.classId } : {}), ...(left ? { status: { in: ["LEFT", "GRADUATED"] }, ...(range ? { leftOn: range } : {}) } : range ? { admissionDate: range } : {}) },
        include: { schoolClass: true, section: true, guardians: { where: { isPrimary: true }, include: { guardian: true } } },
        orderBy: left ? { leftOn: "desc" } : { admissionDate: "desc" },
      });
      return {
        columns: [{ key: "date", label: left ? "Left on" : "Admitted", format: "date" }, { key: "adm", label: "Admission no" }, { key: "name", label: "Student" }, { key: "cls", label: "Class" }, { key: "parent", label: "Parent" }, { key: "phone", label: "Mobile" }, ...(left ? [{ key: "reason", label: "Reason" }] : [])],
        rows: students.map((s) => ({ date: left ? s.leftOn : s.admissionDate, adm: s.admissionNo, name: fullName(s), cls: `${s.schoolClass.name}${s.section ? "-" + s.section.name : ""}`, parent: s.guardians[0]?.guardian.name ?? "", phone: s.guardians[0]?.guardian.phone ?? "", reason: s.leftReason ?? "" })),
        note: `${students.length} student(s)`,
      };
    },
  },
  {
    key: "students-contacts", title: "Class list with parent contacts", description: "Printable class list with parents' mobile numbers, blood group and medical notes.", module: "Students", perm: "reports.students", filters: ["class", "section"],
    async run(f, { branchId }) {
      const students = await db.student.findMany({
        where: { branchId, status: "ACTIVE", ...(f.classId ? { classId: f.classId } : {}), ...(f.sectionId ? { sectionId: f.sectionId } : {}) },
        include: { schoolClass: true, section: true, guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" } } },
        orderBy: [{ schoolClass: { grade: "asc" } }, { section: { name: "asc" } }, { rollNo: "asc" }, { firstName: "asc" }],
      });
      return {
        columns: [{ key: "roll", label: "Roll" }, { key: "name", label: "Student" }, { key: "cls", label: "Class" }, { key: "blood", label: "Blood" }, { key: "parents", label: "Parents" }, { key: "medical", label: "Medical notes" }],
        rows: students.map((s) => ({ roll: s.rollNo ?? "", name: fullName(s), cls: `${s.schoolClass.name}${s.section ? "-" + s.section.name : ""}`, blood: s.bloodGroup ?? "", parents: s.guardians.map((g) => `${g.guardian.name} (${g.relation}) ${g.guardian.phone}`).join("; "), medical: s.medicalNotes ?? "" })),
      };
    },
  },
  {
    key: "students-attendance", title: "Student attendance", description: "Days present, late, half day and absent with the attendance percentage, by student, class or day. Filter “Below 75%” finds chronic absentees.", module: "Students", perm: "reports.students", filters: ["dateRange", "class", "section"],
    groupBy: [{ value: "", label: "By student" }, { value: "class", label: "By class" }, { value: "day", label: "By day" }],
    statusFilter: { label: "Every student", options: [{ value: "below75", label: "Below 75%" }, { value: "absent", label: "Absent at least once" }] },
    async run(f, { branchId }) {
      const range = dateWhere(f, true);
      const rows = await db.studentAttendance.findMany({
        where: { branchId, ...(range ? { date: range } : {}), ...(f.sectionId ? { sectionId: f.sectionId } : f.classId ? { section: { classId: f.classId } } : {}) },
        include: { student: { select: { firstName: true, lastName: true, admissionNo: true, rollNo: true, status: true } }, section: { include: { schoolClass: true } } },
      });
      const group = (key: (r: (typeof rows)[number]) => string) => {
        const m = new Map<string, typeof rows>();
        for (const r of rows) { const k = key(r); const g = m.get(k); if (g) g.push(r); else m.set(k, [r]); }
        return m;
      };
      const cols = [{ key: "marked", label: "Days marked", format: "number" as const }, { key: "present", label: "Present", format: "number" as const }, { key: "late", label: "Late", format: "number" as const }, { key: "half", label: "Half day", format: "number" as const }, { key: "absent", label: "Absent", format: "number" as const }, { key: "percent", label: "Attendance %", format: "number" as const }];
      const stats = (list: typeof rows) => { const c = countStatuses(list); return { marked: list.length, ...c, percent: attendancePercent(c) ?? 0 }; };
      if (f.groupBy === "day") {
        const out = [...group((r) => isoDate(r.date))].sort(([a], [b]) => a.localeCompare(b)).map(([d, list]) => ({ day: fmtDate(new Date(d + "T00:00:00.000Z")), ...stats(list) }));
        return { columns: [{ key: "day", label: "Date" }, ...cols], rows: out, chart: { type: "line", x: "day", y: ["percent"] }, note: `${out.length} school day(s)` };
      }
      if (f.groupBy === "class") {
        const out = [...group((r) => r.sectionId)].map(([, list]) => ({ cls: `${list[0].section.schoolClass.name}-${list[0].section.name}`, grade: list[0].section.schoolClass.grade, ...stats(list) }))
          .sort((a, b) => a.grade - b.grade || a.cls.localeCompare(b.cls)).map(({ grade: _g, ...r }) => r);
        return { columns: [{ key: "cls", label: "Class" }, ...cols], rows: out, chart: { type: "bar", x: "cls", y: ["percent"] } };
      }
      let out = [...group((r) => r.studentId)].map(([, list]) => ({
        adm: list[0].student.admissionNo, roll: list[0].student.rollNo ?? "", name: fullName(list[0].student),
        cls: `${list[0].section.schoolClass.name}-${list[0].section.name}`, grade: list[0].section.schoolClass.grade, ...stats(list),
      }));
      if (f.status === "below75") out = out.filter((r) => r.percent < 75);
      if (f.status === "absent") out = out.filter((r) => r.absent > 0);
      out.sort((a, b) => (f.status ? a.percent - b.percent : 0) || a.grade - b.grade || a.cls.localeCompare(b.cls) || (Number(a.roll) || 0) - (Number(b.roll) || 0));
      return {
        columns: [{ key: "adm", label: "Admission no" }, { key: "name", label: "Student" }, { key: "cls", label: "Class" }, ...cols],
        rows: out.map(({ grade: _g, roll: _r, ...r }) => r), note: `${out.length} student(s) · late counts as present, a half day counts as half`,
      };
    },
  },
];

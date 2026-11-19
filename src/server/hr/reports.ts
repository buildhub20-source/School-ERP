import "server-only";
import type { StaffAttendanceStatus, StaffCategory } from "@prisma/client";
import type { ReportDef } from "@/lib/reports/types";
import { db } from "@/lib/db";
import { addDays, round2, today, toNum } from "@/lib/format";
import { CATEGORY_LABEL, EMPLOYMENT_LABEL, dayKey, leaveBalances, workCalendar, workingDays } from "./service";

const categoryFilter = { label: "All staff", options: (Object.keys(CATEGORY_LABEL) as StaffCategory[]).map((k) => ({ value: k, label: CATEGORY_LABEL[k] })) };
const asCategory = (v?: string) => (v && v in CATEGORY_LABEL ? (v as StaffCategory) : undefined);
const yearsSince = (d: Date, t: Date) => Math.max(0, Math.floor((t.getTime() - d.getTime()) / (365.25 * 86400000)));

const directory: ReportDef = {
  key: "hr-directory", title: "Staff directory", module: "HR", perm: "reports.hr",
  description: "Active staff with designation, department, joining date, service and experience.",
  filters: ["status"], statusFilter: categoryFilter,
  async run(f, { branchId }) {
    const t = today();
    const staff = await db.staffProfile.findMany({ where: { branchId, isActive: true, ...(asCategory(f.status) ? { category: asCategory(f.status) } : {}) }, include: { department: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
    const rows = staff.map((s) => ({
      code: s.employeeCode, name: s.name, designation: s.designation, department: s.department?.name ?? "", category: CATEGORY_LABEL[s.category], type: EMPLOYMENT_LABEL[s.employmentType],
      joined: s.joiningDate, service: yearsSince(s.joiningDate, t), experience: yearsSince(s.joiningDate, t) + (s.priorExperienceYears ?? 0), qualifications: s.qualifications ?? "", phone: s.phone ?? "",
    }));
    return {
      columns: [
        { key: "code", label: "Emp. code" }, { key: "name", label: "Name" }, { key: "designation", label: "Designation" }, { key: "department", label: "Department" }, { key: "category", label: "Category" },
        { key: "type", label: "Employment" }, { key: "joined", label: "Joined", format: "date" }, { key: "service", label: "Years here", format: "number" }, { key: "experience", label: "Total experience (yrs)", format: "number" },
        { key: "qualifications", label: "Qualifications" }, { key: "phone", label: "Mobile" },
      ],
      rows, totals: { code: `${rows.length} staff` },
    };
  },
};

const attendance: ReportDef = {
  key: "hr-attendance", title: "Staff attendance summary", module: "HR", perm: "reports.hr",
  description: "Working days, present, late, half days, absent, on leave and not marked for each staff member over a period, with attendance %.",
  filters: ["dateRange", "status"], statusFilter: categoryFilter,
  async run(f, { branchId }) {
    const t = today();
    const to = f.to && f.to < t ? f.to : t;
    const from = f.from ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    const cal = await workCalendar(branchId, from, to);
    const days = workingDays(cal, from, to);
    const staff = await db.staffProfile.findMany({
      where: { branchId, joiningDate: { lte: to }, OR: [{ isActive: true }, { leftOn: { gte: from } }], ...(asCategory(f.status) ? { category: asCategory(f.status) } : {}) },
      include: { department: true }, orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    const marks = await db.staffAttendance.findMany({ where: { branchId, date: { gte: from, lte: to }, staffId: { in: staff.map((s) => s.id) } }, select: { staffId: true, date: true, status: true } });
    const workKeys = new Set(days.map(dayKey));
    const rows = staff.map((s) => {
      const mine = marks.filter((m) => m.staffId === s.id && workKeys.has(dayKey(m.date)));
      const due = days.filter((d) => d >= s.joiningDate && (!s.leftOn || d < s.leftOn)).length;
      const c = (st: StaffAttendanceStatus) => mine.filter((m) => m.status === st).length;
      const present = c("PRESENT") + c("LATE") + c("HALF_DAY") * 0.5;
      return {
        code: s.employeeCode, name: s.name, department: s.department?.name ?? "", working: due, present: c("PRESENT"), late: c("LATE"), half: c("HALF_DAY"), absent: c("ABSENT"), leave: c("ON_LEAVE") + c("HALF_DAY") * 0.5,
        notMarked: Math.max(0, due - mine.length), pct: due ? round2((present / due) * 100) : 0,
      };
    });
    const sum = (k: "present" | "late" | "half" | "absent" | "leave" | "notMarked") => round2(rows.reduce((a, r) => a + r[k], 0));
    return {
      columns: [
        { key: "code", label: "Emp. code" }, { key: "name", label: "Name" }, { key: "department", label: "Department" }, { key: "working", label: "Working days", format: "number" },
        { key: "present", label: "Present", format: "number" }, { key: "late", label: "Late", format: "number" }, { key: "half", label: "Half days", format: "number" }, { key: "absent", label: "Absent", format: "number" },
        { key: "leave", label: "Leave days", format: "number" }, { key: "notMarked", label: "Not marked", format: "number" }, { key: "pct", label: "Attendance %", format: "number" },
      ],
      rows, totals: { code: `${rows.length} staff`, present: sum("present"), late: sum("late"), half: sum("half"), absent: sum("absent"), leave: sum("leave"), notMarked: sum("notMarked") },
      note: `${days.length} working day${days.length === 1 ? "" : "s"} from ${dayKey(from)} to ${dayKey(to)} (holidays and weekly offs excluded). Half days count as half present, half leave.`,
      chart: rows.length ? { type: "bar", x: "name", y: ["pct"] } : undefined,
    };
  },
};

const leave: ReportDef = {
  key: "hr-leave", title: "Leave taken & balance", module: "HR", perm: "reports.hr",
  description: "Approved leave days per staff member and leave type in a period, with each person's balance for the current academic year.",
  filters: ["dateRange", "status"], statusFilter: categoryFilter,
  async run(f, { branchId }) {
    const to = f.to ?? addDays(today(), 365);
    const from = f.from ?? new Date(0);
    const [types, staff, reqs] = await Promise.all([
      db.leaveType.findMany({ where: { branchId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      db.staffProfile.findMany({ where: { branchId, isActive: true, ...(asCategory(f.status) ? { category: asCategory(f.status) } : {}) }, orderBy: { name: "asc" } }),
      db.leaveRequest.findMany({ where: { branchId, status: "APPROVED", fromDate: { gte: from, lte: to } }, select: { staffId: true, leaveTypeId: true, days: true } }),
    ]);
    const rows = [];
    for (const s of staff) {
      const bal = await leaveBalances(branchId, s.id);
      const row: Record<string, unknown> = { code: s.employeeCode, name: s.name };
      let total = 0;
      for (const t of types) {
        const taken = round2(reqs.filter((r) => r.staffId === s.id && r.leaveTypeId === t.id).reduce((a, r) => a + toNum(r.days), 0));
        row[`t_${t.id}`] = taken;
        total += taken;
        if (t.isPaid) row[`b_${t.id}`] = bal.find((b) => b.typeId === t.id)?.available ?? t.daysPerYear;
      }
      row.total = round2(total);
      rows.push(row);
    }
    const totals: Record<string, unknown> = { code: `${rows.length} staff`, total: round2(rows.reduce((a, r) => a + (r.total as number), 0)) };
    for (const t of types) totals[`t_${t.id}`] = round2(rows.reduce((a, r) => a + (r[`t_${t.id}`] as number), 0));
    return {
      columns: [
        { key: "code", label: "Emp. code" }, { key: "name", label: "Name" },
        ...types.map((t) => ({ key: `t_${t.id}`, label: `${t.code} taken`, format: "number" as const })),
        { key: "total", label: "Total taken", format: "number" },
        ...types.filter((t) => t.isPaid).map((t) => ({ key: `b_${t.id}`, label: `${t.code} left`, format: "number" as const })),
      ],
      rows, totals,
      note: "Balances are for the current academic year. Days waiting for approval are already taken off the balance.",
    };
  },
};

export const hrReports: ReportDef[] = [directory, attendance, leave];

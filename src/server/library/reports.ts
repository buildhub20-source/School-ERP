import "server-only";
import type { Prisma } from "@prisma/client";
import type { ReportDef } from "@/lib/reports/types";
import { dateWhere } from "@/lib/reports/parse";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { daysBetween, fullName, round2, today, toNum } from "@/lib/format";
import { fineFor } from "./service";

const monthKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
const monthLabel = (k: string) => new Date(k + "-01T00:00:00Z").toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

const overdue: ReportDef = {
  key: "library-overdue", title: "Overdue books", module: "Library", perm: "reports.library",
  description: "Books not returned by their due date, with days late and the fine so far (students).",
  filters: ["class"],
  async run(f, { branchId }) {
    const t = today();
    const rules = await getSetting("library", branchId);
    const loans = await db.libraryLoan.findMany({
      where: { branchId, returnedAt: null, dueDate: { lt: t }, ...(f.classId ? { student: { classId: f.classId } } : {}) },
      include: { copy: { include: { book: true } }, student: { include: { schoolClass: true, section: true, guardians: { where: { isPrimary: true }, include: { guardian: true } } } }, user: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
    });
    const rows = loans.map((l) => ({
      accession: l.copy.accessionNo, title: l.copy.book.title,
      borrower: l.student ? fullName(l.student) : l.user?.name ?? "", cls: l.student ? `${l.student.schoolClass.name}${l.student.section ? "-" + l.student.section.name : ""}` : "Staff",
      phone: l.student?.guardians[0]?.guardian.phone ?? "", due: l.dueDate, days: daysBetween(l.dueDate, t), fine: l.studentId ? fineFor(l.dueDate, t, rules).fine : 0,
    }));
    return {
      columns: [
        { key: "accession", label: "Accession no" }, { key: "title", label: "Title" }, { key: "borrower", label: "Borrower" }, { key: "cls", label: "Class" },
        { key: "phone", label: "Parent mobile" }, { key: "due", label: "Due", format: "date" }, { key: "days", label: "Days late", format: "number" }, { key: "fine", label: "Fine so far", format: "money" },
      ],
      rows, totals: { accession: `${rows.length} books`, fine: round2(rows.reduce((s, r) => s + r.fine, 0)) },
    };
  },
};

const circulation: ReportDef = {
  key: "library-circulation", title: "Library circulation", module: "Library", perm: "reports.library",
  description: "Books issued and returned, and fines charged, by month, category, class or borrower type.",
  filters: ["dateRange", "class"],
  groupBy: [{ value: "month", label: "Month" }, { value: "category", label: "Category" }, { value: "class", label: "Class" }, { value: "borrower", label: "Borrower type" }],
  async run(f, { branchId }) {
    const where: Prisma.LibraryLoanWhereInput = { branchId, issuedAt: dateWhere(f), ...(f.classId ? { student: { classId: f.classId } } : {}) };
    const loans = await db.libraryLoan.findMany({ where, include: { copy: { include: { book: true } }, student: { include: { schoolClass: true } } }, orderBy: { issuedAt: "asc" } });
    const g = f.groupBy ?? "month";
    const map = new Map<string, { label: string; sort: string; issued: number; returned: number; late: number; fines: number; borrowers: Set<string> }>();
    for (const l of loans) {
      const key = g === "category" ? l.copy.book.category : g === "class" ? (l.student?.schoolClass.id ?? "staff") : g === "borrower" ? (l.studentId ? "s" : "t") : monthKey(l.issuedAt);
      const label = g === "category" ? l.copy.book.category : g === "class" ? (l.student?.schoolClass.name ?? "Staff") : g === "borrower" ? (l.studentId ? "Students" : "Staff") : monthLabel(key);
      const sort = g === "class" ? String(l.student?.schoolClass.grade ?? 99).padStart(3, "0") : g === "month" ? key : label;
      const e = map.get(key) ?? { label, sort, issued: 0, returned: 0, late: 0, fines: 0, borrowers: new Set<string>() };
      e.issued++;
      if (l.returnedAt) { e.returned++; if (daysBetween(l.dueDate, l.returnedAt) > 0) e.late++; }
      if (!l.fineWaived) e.fines = round2(e.fines + toNum(l.fineAmount));
      e.borrowers.add(l.studentId ?? l.userId ?? "");
      map.set(key, e);
    }
    const rows = [...map.values()].sort((a, b) => a.sort.localeCompare(b.sort)).map((e) => ({ group: e.label, issued: e.issued, returned: e.returned, late: e.late, borrowers: e.borrowers.size, fines: e.fines }));
    const label = circulation.groupBy!.find((x) => x.value === g)?.label ?? "Group";
    return {
      columns: [{ key: "group", label }, { key: "issued", label: "Issued", format: "number" }, { key: "returned", label: "Returned", format: "number" }, { key: "late", label: "Returned late", format: "number" }, { key: "borrowers", label: "Borrowers", format: "number" }, { key: "fines", label: "Fines charged", format: "money" }],
      rows, totals: { group: "Total", issued: rows.reduce((s, r) => s + r.issued, 0), returned: rows.reduce((s, r) => s + r.returned, 0), late: rows.reduce((s, r) => s + r.late, 0), fines: round2(rows.reduce((s, r) => s + r.fines, 0)) },
      chart: rows.length ? { type: g === "month" ? "line" : "bar", x: "group", y: ["issued"] } : undefined,
    };
  },
};

const stock: ReportDef = {
  key: "library-stock", title: "Library stock", module: "Library", perm: "reports.library",
  description: "Titles and copies by category: available, issued, damaged and lost, with the value of copies in stock.",
  filters: [],
  async run(_f, { branchId }) {
    const copies = await db.libraryCopy.findMany({ where: { branchId }, include: { book: { select: { category: true, id: true } } } });
    const map = new Map<string, { titles: Set<string>; copies: number; available: number; issued: number; damaged: number; lost: number; value: number }>();
    for (const c of copies) {
      const e = map.get(c.book.category) ?? { titles: new Set<string>(), copies: 0, available: 0, issued: 0, damaged: 0, lost: 0, value: 0 };
      e.titles.add(c.book.id);
      if (c.status !== "WITHDRAWN") e.copies++;
      if (c.status === "AVAILABLE") e.available++;
      if (c.status === "ISSUED") e.issued++;
      if (c.status === "DAMAGED") e.damaged++;
      if (c.status === "LOST") e.lost++;
      if (c.status === "AVAILABLE" || c.status === "ISSUED") e.value = round2(e.value + toNum(c.price));
      map.set(c.book.category, e);
    }
    const rows = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, e]) => ({ category, titles: e.titles.size, copies: e.copies, available: e.available, issued: e.issued, damaged: e.damaged, lost: e.lost, value: e.value }));
    const sum = (k: "titles" | "copies" | "available" | "issued" | "damaged" | "lost" | "value") => round2(rows.reduce((s, r) => s + r[k], 0));
    return {
      columns: [{ key: "category", label: "Category" }, { key: "titles", label: "Titles", format: "number" }, { key: "copies", label: "Copies", format: "number" }, { key: "available", label: "Available", format: "number" }, { key: "issued", label: "Issued", format: "number" }, { key: "damaged", label: "Damaged", format: "number" }, { key: "lost", label: "Lost", format: "number" }, { key: "value", label: "Value in stock", format: "money" }],
      rows, totals: { category: "Total", titles: sum("titles"), copies: sum("copies"), available: sum("available"), issued: sum("issued"), damaged: sum("damaged"), lost: sum("lost"), value: sum("value") },
      chart: rows.length ? { type: "bar", x: "category", y: ["available", "issued"] } : undefined,
    };
  },
};

export const libraryReports: ReportDef[] = [overdue, circulation, stock];

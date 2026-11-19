import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { addDays, today, toNum } from "@/lib/format";
import { saveSetting, getSetting } from "@/lib/settings";
import { fineFor, issueBook, markLost, renewLoan, returnBook, saveBook, libraryOverdueReminders } from "@/server/library/service";
import { syncRoles } from "@/lib/role-sync";
import { asUser, testCtx, uniq } from "./helpers";

let ctx: Awaited<ReturnType<typeof testCtx>>;
let bookId: string;
let accs: string[];
let students: { id: string }[];
const saved: { rules?: Awaited<ReturnType<typeof getSetting<"library">>> } = {};

beforeAll(async () => {
  ctx = await testCtx();
  saved.rules = await getSetting("library", ctx.branchId);
  await saveSetting("library", { studentLoanDays: 14, staffLoanDays: 30, maxBooksStudent: 2, maxBooksStaff: 5, maxRenewals: 1, finePerDay: 2, graceDays: 1, maxFine: 20 }, ctx.branchId);
  const book = await asUser(ctx.adminId, () => saveBook(ctx.branchId, { title: uniq("Test book "), category: "General", language: "English" }, 4, 300));
  bookId = book.id;
  accs = (await db.libraryCopy.findMany({ where: { bookId }, orderBy: { accessionNo: "asc" } })).map((c) => c.accessionNo);
  students = await db.student.findMany({ where: { branchId: ctx.branchId, status: "ACTIVE", libraryLoans: { none: { returnedAt: null } } }, take: 2 });
});

afterAll(async () => {
  const loans = await db.libraryLoan.findMany({ where: { copy: { bookId } } });
  const feeIds = loans.map((l) => l.studentFeeId).filter(Boolean) as string[];
  await db.libraryLoan.deleteMany({ where: { copy: { bookId } } });
  await db.studentFee.deleteMany({ where: { id: { in: feeIds } } });
  await db.libraryBook.delete({ where: { id: bookId } });
  if (saved.rules) await saveSetting("library", saved.rules, ctx.branchId);
});

describe("library fines", () => {
  it("charges per late day after the grace period, capped", () => {
    const rules = { studentLoanDays: 14, staffLoanDays: 30, maxBooksStudent: 2, maxBooksStaff: 5, maxRenewals: 1, finePerDay: 2, graceDays: 1, maxFine: 20 };
    const due = new Date("2026-11-01T00:00:00Z");
    expect(fineFor(due, new Date("2026-11-01T00:00:00Z"), rules)).toEqual({ daysLate: 0, fine: 0 });
    expect(fineFor(due, new Date("2026-11-02T00:00:00Z"), rules)).toEqual({ daysLate: 1, fine: 0 });
    expect(fineFor(due, new Date("2026-11-05T00:00:00Z"), rules)).toEqual({ daysLate: 4, fine: 6 });
    expect(fineFor(due, new Date("2026-12-31T00:00:00Z"), rules).fine).toBe(20);
  });
});

describe("library circulation", () => {
  it("issues, enforces the limit and blocks borrowers with an overdue book", async () => {
    const s = students[0].id;
    const a = await asUser(ctx.adminId, () => issueBook(ctx.branchId, ctx.adminId, { accessionNo: accs[0].toLowerCase(), studentId: s }));
    expect(a.dueDate.getTime()).toBe(addDays(today(), 14).getTime());
    expect((await db.libraryCopy.findFirstOrThrow({ where: { accessionNo: accs[0], branchId: ctx.branchId } })).status).toBe("ISSUED");
    await expect(issueBook(ctx.branchId, ctx.adminId, { accessionNo: accs[0], studentId: students[1].id })).rejects.toThrow(/issued/);
    await asUser(ctx.adminId, () => issueBook(ctx.branchId, ctx.adminId, { accessionNo: accs[1], studentId: s }));
    await expect(issueBook(ctx.branchId, ctx.adminId, { accessionNo: accs[2], studentId: s })).rejects.toThrow(/limit 2/);
    // make one overdue: the student cannot borrow again until it is back
    await db.libraryLoan.updateMany({ where: { copy: { accessionNo: accs[1], branchId: ctx.branchId }, returnedAt: null }, data: { dueDate: addDays(today(), -5) } });
    await asUser(ctx.adminId, () => returnBook(ctx.branchId, ctx.adminId, { accessionNo: accs[0] }));
    await expect(issueBook(ctx.branchId, ctx.adminId, { accessionNo: accs[2], studentId: s })).rejects.toThrow(/overdue/);
  });

  it("puts a late fine on the student's fee account, and a waived fine needs a reason", async () => {
    await expect(returnBook(ctx.branchId, ctx.adminId, { accessionNo: accs[1], waiveFine: true })).rejects.toThrow(/reason/);
    const r = await asUser(ctx.adminId, () => returnBook(ctx.branchId, ctx.adminId, { accessionNo: accs[1] }));
    expect(r).toMatchObject({ daysLate: 5, fine: 8, charged: true }); // (5 - 1 grace) × ₹2
    const loan = await db.libraryLoan.findFirstOrThrow({ where: { copy: { accessionNo: accs[1], branchId: ctx.branchId } }, orderBy: { issuedAt: "desc" } });
    const fee = await db.studentFee.findUniqueOrThrow({ where: { id: loan.studentFeeId! } });
    expect(fee.source).toBe("LIBRARY");
    expect(toNum(fee.balance)).toBe(8);
    expect((await db.libraryCopy.findFirstOrThrow({ where: { accessionNo: accs[1], branchId: ctx.branchId } })).status).toBe("AVAILABLE");
  });

  it("renews within the limit, and a lost book charges its price", async () => {
    const s = students[1].id;
    const { loan } = await asUser(ctx.adminId, () => issueBook(ctx.branchId, ctx.adminId, { accessionNo: accs[2], studentId: s }));
    await asUser(ctx.adminId, () => renewLoan(ctx.branchId, loan.id));
    await expect(renewLoan(ctx.branchId, loan.id)).rejects.toThrow(/limit 1/);
    const lost = await asUser(ctx.adminId, () => markLost(ctx.branchId, ctx.adminId, loan.id));
    expect(lost.amount).toBe(300);
    expect((await db.libraryCopy.findFirstOrThrow({ where: { accessionNo: accs[2], branchId: ctx.branchId } })).status).toBe("LOST");
  });

  it("does not fine staff, and reminds overdue borrowers once", async () => {
    const teacher = await db.user.findFirstOrThrow({ where: { email: "anitha@school.test" } });
    const { loan } = await asUser(ctx.adminId, () => issueBook(ctx.branchId, ctx.adminId, { accessionNo: accs[3], staffUserId: teacher.id }));
    await db.libraryLoan.update({ where: { id: loan.id }, data: { dueDate: addDays(today(), -3) } });
    const first = await libraryOverdueReminders({ everyDays: 3 });
    expect(first).toMatch(/reminder/);
    expect((await db.libraryLoan.findUniqueOrThrow({ where: { id: loan.id } })).lastReminderAt).not.toBeNull();
    const r = await asUser(ctx.adminId, () => returnBook(ctx.branchId, ctx.adminId, { loanId: loan.id }));
    expect(r.fine).toBe(0);
  });
});

describe("role sync", () => {
  it("grants new module permissions to existing roles without re-adding removed ones", async () => {
    const admin = await db.role.findUniqueOrThrow({ where: { key: "SCHOOL_ADMIN" } });
    const original = admin.permissions;
    const catalog = await db.setting.findFirst({ where: { key: "permissionCatalog", branchId: null } });
    try {
      // Simulate an install from before the library existed.
      await db.role.update({ where: { id: admin.id }, data: { permissions: original.filter((p) => !p.startsWith("library.") && p !== "reports.library") } });
      if (catalog) await db.setting.delete({ where: { id: catalog.id } });
      await syncRoles();
      expect((await db.role.findUniqueOrThrow({ where: { id: admin.id } })).permissions).toContain("library.view");
      // The Super Admin removes it again: a later sync keeps it removed.
      await db.role.update({ where: { id: admin.id }, data: { permissions: original.filter((p) => p !== "library.view") } });
      await syncRoles();
      expect((await db.role.findUniqueOrThrow({ where: { id: admin.id } })).permissions).not.toContain("library.view");
      expect(await db.role.findUnique({ where: { key: "LIBRARIAN" } })).not.toBeNull();
    } finally {
      await db.role.update({ where: { id: admin.id }, data: { permissions: original } });
    }
  });
});

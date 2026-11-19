import "server-only";
import type { LibraryCopyStatus } from "@prisma/client";
import { db, type DbOrTx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getSetting, currentAcademicYear, type LibraryRules } from "@/lib/settings";
import { nextNumber } from "@/lib/counters";
import { addDays, daysBetween, fullName, money, round2, today, toNum } from "@/lib/format";
import { createFeeLine } from "@/server/fees/core";
import { notifyGuardians, notifyUsers } from "@/lib/messaging/notify";

/* ───────────── catalogue ───────────── */

export type BookInput = {
  id?: string; title: string; author?: string; isbn?: string; publisher?: string; edition?: string;
  category: string; language: string; shelf?: string; notes?: string;
};

export async function saveBook(branchId: string, input: BookInput, copies = 0, price?: number, acquiredOn?: Date) {
  const data = {
    title: input.title, author: input.author ?? null, isbn: input.isbn ?? null, publisher: input.publisher ?? null, edition: input.edition ?? null,
    category: input.category, language: input.language, shelf: input.shelf ?? null, notes: input.notes ?? null,
  };
  return db.$transaction(async (tx) => {
    let book;
    if (input.id) {
      const existing = await tx.libraryBook.findFirst({ where: { id: input.id, branchId } });
      if (!existing) throw new AppError("Book not found.");
      book = await tx.libraryBook.update({ where: { id: input.id }, data });
    } else {
      book = await tx.libraryBook.create({ data: { ...data, branchId } });
    }
    if (copies > 0) await addCopies(tx, branchId, book.id, copies, price, acquiredOn);
    return book;
  });
}

/** Accession numbers are a running number per branch: L00001, L00002 … */
export async function addCopies(client: DbOrTx, branchId: string, bookId: string, count: number, price?: number, acquiredOn?: Date) {
  if (count < 1 || count > 200) throw new AppError("Add between 1 and 200 copies at a time.");
  const book = await client.libraryBook.findFirst({ where: { id: bookId, branchId } });
  if (!book) throw new AppError("Book not found.");
  const made: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = await nextNumber(`LIB-ACC-${branchId}`, client);
    const accessionNo = `L${String(n).padStart(5, "0")}`;
    await client.libraryCopy.create({ data: { branchId, bookId, accessionNo, price: price ?? null, acquiredOn: acquiredOn ?? null } });
    made.push(accessionNo);
  }
  return made;
}

export async function deleteBook(branchId: string, bookId: string) {
  const book = await db.libraryBook.findFirst({ where: { id: bookId, branchId }, include: { copies: { include: { _count: { select: { loans: true } } } } } });
  if (!book) throw new AppError("Book not found.");
  if (book.copies.some((c) => c._count.loans > 0)) throw new AppError("This book has loan history and cannot be deleted. Withdraw its copies instead.");
  await db.libraryBook.delete({ where: { id: bookId } });
}

/** Mark a copy damaged, withdrawn (removed from stock) or available again. Issued copies change status through return. */
export async function setCopyStatus(branchId: string, copyId: string, status: Extract<LibraryCopyStatus, "AVAILABLE" | "DAMAGED" | "WITHDRAWN">) {
  const copy = await db.libraryCopy.findFirst({ where: { id: copyId, branchId } });
  if (!copy) throw new AppError("Copy not found.");
  if (copy.status === "ISSUED") throw new AppError("This copy is issued. Return it first.");
  return db.libraryCopy.update({ where: { id: copyId }, data: { status } });
}

export async function findCopy(client: DbOrTx, branchId: string, accessionNo: string) {
  const code = accessionNo.trim().toUpperCase();
  const copy = await client.libraryCopy.findFirst({ where: { branchId, accessionNo: code }, include: { book: true } });
  if (!copy) throw new AppError(`No copy with accession number ${code}.`);
  return copy;
}

/* ───────────── circulation ───────────── */

export function fineFor(dueDate: Date, returnedOn: Date, rules: LibraryRules): { daysLate: number; fine: number } {
  const daysLate = Math.max(0, daysBetween(dueDate, returnedOn));
  const chargeable = Math.max(0, daysLate - rules.graceDays);
  return { daysLate, fine: round2(Math.min(chargeable * rules.finePerDay, rules.maxFine || Infinity)) };
}

async function libraryFeeHead(client: DbOrTx, branchId: string) {
  return client.feeHead.upsert({
    where: { branchId_name: { branchId, name: "Library fine" } },
    create: { branchId, name: "Library fine", type: "OTHER", lateFeeApplies: false },
    update: {},
  });
}

/** Put a library charge on the student's fee account so it is paid at the counter or online like any other due. */
async function chargeStudent(client: DbOrTx, branchId: string, studentId: string, amount: number, description: string) {
  const year = await currentAcademicYear();
  if (!year) throw new AppError("Set the current academic year first (Settings → Years & classes).");
  const head = await libraryFeeHead(client, branchId);
  const line = await createFeeLine(client, { studentId, academicYearId: year.id, feeHeadId: head.id, description, amount, dueDate: today(), source: "LIBRARY" });
  return line.id;
}

export async function issueBook(branchId: string, actorId: string, input: { accessionNo: string; studentId?: string; staffUserId?: string; dueDate?: Date }) {
  if (!input.studentId === !input.staffUserId) throw new AppError("Choose one borrower: a student or a staff member.");
  const rules = await getSetting("library", branchId);
  return db.$transaction(async (tx) => {
    const copy = await findCopy(tx, branchId, input.accessionNo);
    await tx.$queryRaw`SELECT id FROM "LibraryCopy" WHERE id = ${copy.id} FOR UPDATE`;
    const fresh = await tx.libraryCopy.findUniqueOrThrow({ where: { id: copy.id } });
    if (fresh.status !== "AVAILABLE") throw new AppError(`${copy.accessionNo} is ${fresh.status.toLowerCase()} and cannot be issued.`);

    let who: string, limit: number, days: number;
    if (input.studentId) {
      const s = await tx.student.findFirst({ where: { id: input.studentId, branchId } });
      if (!s) throw new AppError("Student not found.");
      if (s.status !== "ACTIVE") throw new AppError(`${fullName(s)} is not an active student.`);
      who = fullName(s); limit = rules.maxBooksStudent; days = rules.studentLoanDays;
    } else {
      const u = await tx.user.findFirst({ where: { id: input.staffUserId, branchId, isActive: true }, include: { role: true } });
      if (!u || u.role.permissions.includes("parent.portal") || u.role.permissions.includes("driver.portal")) throw new AppError("Staff member not found.");
      who = u.name; limit = rules.maxBooksStaff; days = rules.staffLoanDays;
    }
    const borrower = input.studentId ? { studentId: input.studentId } : { userId: input.staffUserId };
    const open = await tx.libraryLoan.findMany({ where: { ...borrower, returnedAt: null } });
    if (open.some((l) => l.dueDate < today())) throw new AppError(`${who} has an overdue book. Return it before borrowing another.`);
    if (open.length >= limit) throw new AppError(`${who} already has ${open.length} book${open.length === 1 ? "" : "s"} (limit ${limit}).`);

    const dueDate = input.dueDate ?? addDays(today(), days);
    if (dueDate < today()) throw new AppError("The due date is in the past.");
    const loan = await tx.libraryLoan.create({ data: { branchId, copyId: copy.id, ...borrower, dueDate, issuedById: actorId } });
    await tx.libraryCopy.update({ where: { id: copy.id }, data: { status: "ISSUED" } });
    return { loan, title: copy.book.title, accessionNo: copy.accessionNo, who, dueDate };
  });
}

async function openLoan(client: DbOrTx, branchId: string, ref: { loanId?: string; accessionNo?: string }) {
  const loan = ref.loanId
    ? await client.libraryLoan.findFirst({ where: { id: ref.loanId, branchId }, include: { copy: { include: { book: true } } } })
    : await client.libraryLoan.findFirst({ where: { branchId, returnedAt: null, copy: { accessionNo: (ref.accessionNo ?? "").trim().toUpperCase() } }, include: { copy: { include: { book: true } } } });
  if (!loan) throw new AppError(ref.accessionNo ? `${ref.accessionNo.trim().toUpperCase()} is not issued to anyone.` : "Loan not found.");
  if (loan.returnedAt) throw new AppError("This book was already returned.");
  return loan;
}

/** Return a book. A late return by a student adds the fine to their fee account unless it is waived (reason required). */
export async function returnBook(branchId: string, actorId: string, input: { loanId?: string; accessionNo?: string; damaged?: boolean; waiveFine?: boolean; reason?: string }) {
  const rules = await getSetting("library", branchId);
  return db.$transaction(async (tx) => {
    const loan = await openLoan(tx, branchId, input);
    const { daysLate, fine } = loan.studentId ? fineFor(loan.dueDate, today(), rules) : { daysLate: Math.max(0, daysBetween(loan.dueDate, today())), fine: 0 };
    if (input.waiveFine && fine > 0 && !input.reason?.trim()) throw new AppError("Give a reason for waiving the fine.");
    const charge = fine > 0 && !input.waiveFine;
    const studentFeeId = charge && loan.studentId
      ? await chargeStudent(tx, branchId, loan.studentId, fine, `Library fine — ${loan.copy.book.title} (${loan.copy.accessionNo}), ${daysLate} day${daysLate === 1 ? "" : "s"} late`)
      : null;
    await tx.libraryLoan.update({
      where: { id: loan.id },
      data: { returnedAt: new Date(), returnedById: actorId, fineAmount: fine, fineWaived: fine > 0 && !!input.waiveFine, studentFeeId, notes: input.waiveFine && input.reason ? `Fine waived: ${input.reason}` : loan.notes },
    });
    await tx.libraryCopy.update({ where: { id: loan.copyId }, data: { status: input.damaged ? "DAMAGED" : "AVAILABLE" } });
    return { title: loan.copy.book.title, accessionNo: loan.copy.accessionNo, daysLate, fine, charged: charge };
  });
}

export async function renewLoan(branchId: string, loanId: string) {
  const rules = await getSetting("library", branchId);
  return db.$transaction(async (tx) => {
    const loan = await openLoan(tx, branchId, { loanId });
    if (loan.renewals >= rules.maxRenewals) throw new AppError(`This book has already been renewed ${loan.renewals} time${loan.renewals === 1 ? "" : "s"} (limit ${rules.maxRenewals}).`);
    if (loan.dueDate < today()) throw new AppError("Overdue books cannot be renewed. Return the book (the fine applies) and issue it again.");
    const dueDate = addDays(today(), loan.studentId ? rules.studentLoanDays : rules.staffLoanDays);
    await tx.libraryLoan.update({ where: { id: loan.id }, data: { dueDate, renewals: { increment: 1 }, lastReminderAt: null } });
    return { dueDate };
  });
}

/** The borrower lost the book: the copy leaves stock and a student is charged its replacement cost (editable). */
export async function markLost(branchId: string, actorId: string, loanId: string, charge?: number) {
  return db.$transaction(async (tx) => {
    const loan = await openLoan(tx, branchId, { loanId });
    const amount = round2(charge ?? toNum(loan.copy.price));
    const studentFeeId = loan.studentId && amount > 0
      ? await chargeStudent(tx, branchId, loan.studentId, amount, `Library — lost book: ${loan.copy.book.title} (${loan.copy.accessionNo})`)
      : null;
    await tx.libraryLoan.update({ where: { id: loan.id }, data: { returnedAt: new Date(), returnedById: actorId, lost: true, fineAmount: amount, studentFeeId } });
    await tx.libraryCopy.update({ where: { id: loan.copyId }, data: { status: "LOST" } });
    return { amount };
  });
}

/* ───────────── dashboard & automation ───────────── */

export async function libraryDashboard(branchId: string) {
  const t = today();
  const [titles, copies, issued, overdue, overdueList] = await Promise.all([
    db.libraryBook.count({ where: { branchId } }),
    db.libraryCopy.count({ where: { branchId, status: { notIn: ["LOST", "WITHDRAWN"] } } }),
    db.libraryLoan.count({ where: { branchId, returnedAt: null } }),
    db.libraryLoan.count({ where: { branchId, returnedAt: null, dueDate: { lt: t } } }),
    db.libraryLoan.findMany({
      where: { branchId, returnedAt: null, dueDate: { lt: t } }, orderBy: { dueDate: "asc" }, take: 8,
      include: { copy: { include: { book: true } }, student: { include: { schoolClass: true, section: true } }, user: { select: { name: true } } },
    }),
  ]);
  return { titles, copies, issued, overdue, overdueList };
}

/** Daily: remind parents (and staff borrowers) about overdue books, at most once every `everyDays` days per loan. */
export async function libraryOverdueReminders(config: Record<string, unknown>): Promise<string> {
  const every = Math.max(1, Number(config.everyDays ?? 3) || 3);
  const t = today();
  const loans = await db.libraryLoan.findMany({
    where: { returnedAt: null, dueDate: { lt: t }, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: addDays(t, -every + 1) } }] },
    include: { copy: { include: { book: true } }, student: true },
  });
  const rulesByBranch = new Map<string, LibraryRules>();
  let sent = 0;
  for (const l of loans) {
    const rules = rulesByBranch.get(l.branchId) ?? (await getSetting("library", l.branchId));
    rulesByBranch.set(l.branchId, rules);
    const days = daysBetween(l.dueDate, t);
    const { fine } = l.studentId ? fineFor(l.dueDate, t, rules) : { fine: 0 };
    const fineEn = fine > 0 ? ` A fine of ${money(fine)} applies so far.` : "";
    const fineTa = fine > 0 ? ` இதுவரை ${money(fine)} அபராதம்.` : "";
    if (l.studentId && l.student) {
      await notifyGuardians(l.studentId, {
        title: "Library book overdue",
        body: `${fullName(l.student)} has not returned "${l.copy.book.title}" (due ${l.dueDate.toISOString().slice(0, 10)}, ${days} day${days === 1 ? "" : "s"} late). Please return it to the school library.${fineEn}`,
        ta: { title: "நூலக புத்தகம் தாமதம்", body: `${fullName(l.student)} "${l.copy.book.title}" புத்தகத்தை இன்னும் திருப்பித் தரவில்லை (${days} நாள் தாமதம்). பள்ளி நூலகத்தில் திருப்பித் தரவும்.${fineTa}` },
        category: "LIBRARY", channels: ["SMS"], template: "GENERAL",
      });
    } else if (l.userId) {
      await notifyUsers([l.userId], { title: "Library book overdue", body: `Please return "${l.copy.book.title}" (${l.copy.accessionNo}), ${days} day${days === 1 ? "" : "s"} late.`, category: "LIBRARY", inAppOnly: true });
    }
    await db.libraryLoan.update({ where: { id: l.id }, data: { lastReminderAt: new Date() } });
    sent++;
  }
  return `${sent} overdue reminder(s) sent`;
}

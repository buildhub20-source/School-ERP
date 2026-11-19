import type { SeedCtx } from "../seed";
import { db } from "../../src/lib/db";
import { addDays, today } from "../../src/lib/format";
import { addCopies, issueBook, returnBook } from "../../src/server/library/service";

/** Demo data for the library (idempotent: runs only when the branch has no books yet). */
const BOOKS: [title: string, author: string, category: string, language: string, copies: number, price: number, shelf: string][] = [
  ["The Wings of Fire", "A. P. J. Abdul Kalam", "Biography", "English", 3, 299, "R1-A"],
  ["Ponniyin Selvan (Part 1)", "Kalki Krishnamurthy", "Literature", "Tamil", 2, 350, "R4-B"],
  ["Thirukkural with Meaning", "Thiruvalluvar", "Tamil", "Tamil", 4, 120, "R4-A"],
  ["Malgudi Days", "R. K. Narayan", "Fiction", "English", 2, 199, "R2-A"],
  ["Swami and Friends", "R. K. Narayan", "Fiction", "English", 2, 175, "R2-A"],
  ["Panchatantra Stories", "Vishnu Sharma", "Children", "English", 3, 150, "R5-A"],
  ["Tenali Raman Stories", "Traditional", "Children", "Tamil", 3, 110, "R5-A"],
  ["Oxford Student Atlas for India", "Oxford", "Reference", "English", 2, 450, "R6-A"],
  ["Concise Oxford English Dictionary", "Oxford", "Reference", "English", 2, 650, "R6-A"],
  ["The Story of My Experiments with Truth", "M. K. Gandhi", "Biography", "English", 2, 250, "R1-A"],
  ["A Brief History of Time", "Stephen Hawking", "Science", "English", 1, 399, "R3-A"],
  ["Mathematics Olympiad Workbook Class 6", "MTG Editorial", "Competitive exams", "English", 2, 285, "R7-B"],
  ["Children's Encyclopedia of Science", "Om Kidz", "Science", "English", 2, 520, "R3-B"],
  ["Discovery of India", "Jawaharlal Nehru", "History", "English", 1, 499, "R3-C"],
  ["Harry Potter and the Philosopher's Stone", "J. K. Rowling", "Fiction", "English", 3, 399, "R2-B"],
  ["Amar Chitra Katha: Tales of Shivaji", "Anant Pai", "Comics", "English", 2, 99, "R5-B"],
  ["Ignited Minds", "A. P. J. Abdul Kalam", "Non-fiction", "English", 2, 225, "R1-B"],
  ["Bharathiyar Kavithaigal", "Subramania Bharati", "Tamil", "Tamil", 2, 180, "R4-A"],
];

export async function seed_library(ctx: SeedCtx) {
  if ((await db.libraryBook.count({ where: { branchId: ctx.branchId } })) > 0) return;
  for (const [title, author, category, language, copies, price, shelf] of BOOKS) {
    const book = await db.libraryBook.create({ data: { branchId: ctx.branchId, title, author, category, language, shelf } });
    await addCopies(db, ctx.branchId, book.id, copies, price, addDays(today(), -400));
  }
  // A few loans: some out now, two overdue, one returned late (fine on the fee account).
  const students = await db.student.findMany({ where: { branchId: ctx.branchId, status: "ACTIVE", schoolClass: { grade: { gte: 5 } } }, take: 8, orderBy: { admissionNo: "asc" } });
  const librarian = ctx.users.librarian ?? ctx.adminId;
  const plan: [accession: string, studentIdx: number, issuedDaysAgo: number][] = [
    ["L00001", 0, 3], ["L00004", 1, 5], ["L00010", 2, 20], ["L00016", 3, 25], ["L00020", 4, 1], ["L00030", 5, 9],
  ];
  for (const [acc, i, ago] of plan) {
    if (!students[i]) continue;
    // Issue normally, then move the dates back so some loans are overdue.
    const r = await issueBook(ctx.branchId, librarian, { accessionNo: acc, studentId: students[i].id });
    await db.libraryLoan.update({ where: { id: r.loan.id }, data: { issuedAt: addDays(today(), -ago), dueDate: addDays(today(), 14 - ago) } });
  }
  if (students[6]) {
    const r = await issueBook(ctx.branchId, librarian, { accessionNo: "L00025", studentId: students[6].id });
    await db.libraryLoan.update({ where: { id: r.loan.id }, data: { issuedAt: addDays(today(), -18), dueDate: addDays(today(), -4) } });
    await returnBook(ctx.branchId, librarian, { loanId: r.loan.id });
  }
  const staff = ctx.users.teacher1;
  if (staff) await issueBook(ctx.branchId, librarian, { accessionNo: "L00012", staffUserId: staff, dueDate: addDays(today(), 20) });
}

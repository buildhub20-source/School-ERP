"use server";
import { z } from "zod";
import { db } from "@/lib/db";
import { defineAction, zs } from "@/lib/action";
import { saveSetting } from "@/lib/settings";
import { addCopies, deleteBook, issueBook, markLost, renewLoan, returnBook, saveBook, setCopyStatus } from "@/server/library/service";
import { fmtDate, money } from "@/lib/format";

const L = "/library";
const optId = () => z.string().optional().transform((v) => (v ? v : undefined));

const book = {
  id: optId(), title: zs.str(250), author: zs.optStr(200), isbn: zs.optStr(20), publisher: zs.optStr(150), edition: zs.optStr(60),
  category: zs.str(80), language: zs.str(40), shelf: zs.optStr(40), notes: zs.optStr(1000),
};

export const saveBookAction = defineAction({
  perm: "library.manage", revalidate: L,
  schema: z.object({ ...book, copies: zs.optInt(), price: zs.optMoney(), acquiredOn: zs.optDate() }),
}, async ({ copies, price, acquiredOn, ...input }, { branchId }) => {
  const b = await saveBook(branchId, input, input.id ? 0 : Math.max(0, copies ?? 1), price, acquiredOn);
  return { id: b.id };
});

export const addCopiesAction = defineAction({
  perm: "library.manage", revalidate: L,
  schema: z.object({ bookId: zs.id, count: zs.int(1), price: zs.optMoney(), acquiredOn: zs.optDate() }),
}, async ({ bookId, count, price, acquiredOn }, { branchId }) => {
  const made = await db.$transaction((tx) => addCopies(tx, branchId, bookId, count, price, acquiredOn));
  return { message: `Added ${made.length} cop${made.length === 1 ? "y" : "ies"}: ${made[0]}${made.length > 1 ? ` – ${made[made.length - 1]}` : ""}` };
});

export const setCopyStatusAction = defineAction({
  perm: "library.manage", revalidate: L,
  schema: z.object({ copyId: zs.id, status: z.enum(["AVAILABLE", "DAMAGED", "WITHDRAWN"]) }),
}, async ({ copyId, status }, { branchId }) => {
  await setCopyStatus(branchId, copyId, status);
  return true;
});

export const deleteBookAction = defineAction({ perm: "library.manage", revalidate: L, schema: z.object({ id: zs.id }) }, async ({ id }, { branchId }) => {
  await deleteBook(branchId, id);
  return true;
});

export const issueBookAction = defineAction({
  perm: "library.circulate", revalidate: L,
  schema: z.object({ accessionNo: zs.str(20), borrower: zs.str(80), dueDate: zs.optDate() }),
}, async ({ accessionNo, borrower, dueDate }, { branchId, user }) => {
  // borrower is "student:<id>" or "staff:<userId>" (from the borrower picker)
  const [kind, id] = borrower.split(":");
  const r = await issueBook(branchId, user.id, { accessionNo, dueDate, ...(kind === "staff" ? { staffUserId: id } : { studentId: id }) });
  return { message: `${r.accessionNo} "${r.title}" issued to ${r.who}, due ${fmtDate(r.dueDate)}` };
});

export const returnBookAction = defineAction({
  perm: "library.circulate", revalidate: L,
  schema: z.object({ loanId: optId(), accessionNo: zs.optStr(20), damaged: zs.bool().optional(), waiveFine: zs.bool().optional(), reason: zs.optStr(300) }),
}, async (input, { branchId, user }) => {
  const r = await returnBook(branchId, user.id, input);
  const fine = r.fine > 0 ? (r.charged ? ` · fine ${money(r.fine)} added to the fee account` : ` · fine ${money(r.fine)} waived`) : r.daysLate > 0 ? ` · ${r.daysLate} day(s) late` : "";
  return { message: `${r.accessionNo} "${r.title}" returned${fine}` };
});

export const renewLoanAction = defineAction({ perm: "library.circulate", revalidate: L, schema: z.object({ loanId: zs.id }) }, async ({ loanId }, { branchId }) => {
  const r = await renewLoan(branchId, loanId);
  return { message: `Renewed — now due ${fmtDate(r.dueDate)}` };
});

export const markLostAction = defineAction({
  perm: "library.circulate", revalidate: L,
  schema: z.object({ loanId: zs.id, charge: zs.optMoney() }),
}, async ({ loanId, charge }, { branchId, user }) => {
  const r = await markLost(branchId, user.id, loanId, charge);
  return { message: r.amount > 0 ? `Marked lost · ${money(r.amount)} charged` : "Marked lost" };
});

export const saveLibraryRulesAction = defineAction({
  perm: "library.manage", revalidate: L,
  schema: z.object({
    studentLoanDays: zs.int(1), staffLoanDays: zs.int(1), maxBooksStudent: zs.int(1), maxBooksStaff: zs.int(1), maxRenewals: zs.int(0),
    finePerDay: zs.money(), graceDays: zs.int(0), maxFine: zs.money(),
  }),
}, async (rules, { branchId }) => {
  await saveSetting("library", rules, branchId);
  return true;
});

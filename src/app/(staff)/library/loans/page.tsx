import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { daysBetween, fmtDate, fullName, money, today, toNum } from "@/lib/format";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge, Tabs } from "@/components/ui";
import { FilterBar, SearchField, ActionButton } from "@/components/ui/client";
import { markLostAction, renewLoanAction, returnBookAction } from "../actions";

export const metadata = { title: "Library loans" };

export default async function LoansPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("library.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const tab = sp(s, "tab") ?? "out";
  const q = sp(s, "q");
  const t = today();
  const where: Prisma.LibraryLoanWhereInput = {
    branchId: user.branchId,
    ...(tab === "overdue" ? { returnedAt: null, dueDate: { lt: t } } : tab === "returned" ? { returnedAt: { not: null } } : tab === "all" ? {} : { returnedAt: null }),
    ...(q ? { OR: [
      { copy: { accessionNo: { equals: q.trim().toUpperCase() } } }, { copy: { book: { title: { contains: q, mode: "insensitive" } } } },
      { student: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { admissionNo: { contains: q, mode: "insensitive" } }] } },
      { user: { name: { contains: q, mode: "insensitive" } } },
    ] } : {}),
  };
  const [total, loans, counts] = await Promise.all([
    db.libraryLoan.count({ where }),
    db.libraryLoan.findMany({
      where, include: { copy: { include: { book: true } }, student: { include: { schoolClass: true, section: true } }, user: { select: { name: true } } },
      orderBy: tab === "returned" ? { returnedAt: "desc" } : { dueDate: "asc" }, skip, take,
    }),
    Promise.all([
      db.libraryLoan.count({ where: { branchId: user.branchId, returnedAt: null } }),
      db.libraryLoan.count({ where: { branchId: user.branchId, returnedAt: null, dueDate: { lt: t } } }),
    ]),
  ]);
  const canCirculate = hasPerm(user, "library.circulate");
  const qs = (tabKey: string) => `/library/loans?tab=${tabKey}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  return (
    <>
      <PageHeader title="Loans" description="Books currently out, overdue and returned." breadcrumbs={[{ label: "Library", href: "/library" }, { label: "Loans" }]} />
      <Tabs active={qs(tab)} tabs={[
        { href: qs("out"), label: "Out now", count: counts[0] },
        { href: qs("overdue"), label: "Overdue", count: counts[1] },
        { href: qs("returned"), label: "Returned" },
        { href: qs("all"), label: "All" },
      ]} />
      <Card>
        <div className="border-b border-line p-3">
          <FilterBar>
            <input type="hidden" name="tab" value={tab} />
            <SearchField placeholder="Accession no, title, student or staff name" />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Book</TH><TH>Borrower</TH><TH>Issued</TH><TH>Due</TH><TH>Status</TH><TH align="right">Fine</TH>{canCirculate && <TH />}</tr></THead>
          <TBody>
            {loans.length === 0 && <EmptyRow colSpan={7} message={tab === "overdue" ? "No overdue books." : "No loans match."} />}
            {loans.map((l) => {
              const late = !l.returnedAt && l.dueDate < t ? daysBetween(l.dueDate, t) : 0;
              return (
                <TR key={l.id}>
                  <TD><Link href={`/library/books/${l.copy.bookId}`} className="font-medium text-ink hover:text-brand-700">{l.copy.book.title}</Link><span className="block font-mono text-xs text-muted">{l.copy.accessionNo}{l.renewals > 0 ? ` · renewed ${l.renewals}×` : ""}</span></TD>
                  <TD className="whitespace-nowrap">{l.student ? <Link href={`/students/${l.studentId}`} className="hover:text-brand-700">{fullName(l.student)}</Link> : l.user?.name}<span className="block text-xs text-muted">{l.student ? `${l.student.admissionNo} · ${l.student.schoolClass.name}${l.student.section ? "-" + l.student.section.name : ""}` : "Staff"}</span></TD>
                  <TD>{fmtDate(l.issuedAt)}</TD>
                  <TD>{fmtDate(l.dueDate)}</TD>
                  <TD>{l.lost ? <StatusBadge status="EXPIRED" label="Lost" /> : l.returnedAt ? <StatusBadge status="DONE" label={`Returned ${fmtDate(l.returnedAt)}`} /> : late ? <StatusBadge status="OVERDUE" label={`Overdue ${late} day${late === 1 ? "" : "s"}`} /> : <StatusBadge status="PENDING" label="Out" />}</TD>
                  <TD align="right">{toNum(l.fineAmount) > 0 ? <>{money(toNum(l.fineAmount))}{l.fineWaived && <span className="block text-xs text-muted">waived</span>}</> : "—"}</TD>
                  {canCirculate && (
                    <TD align="right">
                      {!l.returnedAt && (
                        <div className="flex justify-end gap-1.5">
                          <ActionButton action={returnBookAction} args={{ loanId: l.id }} successMessage="@result">Return</ActionButton>
                          {!late && <ActionButton action={renewLoanAction} args={{ loanId: l.id }} successMessage="@result">Renew</ActionButton>}
                          <ActionButton action={markLostAction} args={{ loanId: l.id }} variant="danger" confirm={`Mark ${l.copy.accessionNo} as lost?${l.student && l.copy.price ? ` ${money(toNum(l.copy.price))} will be added to the student's fee account.` : ""}`} successMessage="@result">Lost</ActionButton>
                        </div>
                      )}
                    </TD>
                  )}
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/library/loans" />
      </Card>
    </>
  );
}

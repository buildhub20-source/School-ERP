import Link from "next/link";
import { db } from "@/lib/db";
import { fmtDate, fmtDateTime, fullName, money, toNum } from "@/lib/format";
import { Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow } from "@/components/ui";

/** Today's desk log: the books issued (kind="issue") or returned (kind="return") in the last 24 hours. */
export async function RecentLoans({ branchId, kind }: { branchId: string; kind: "issue" | "return" }) {
  const since = new Date(Date.now() - 24 * 3600000);
  const rows = await db.libraryLoan.findMany({
    where: { branchId, ...(kind === "issue" ? { issuedAt: { gte: since } } : { returnedAt: { gte: since } }) },
    include: { copy: { include: { book: true } }, student: { include: { schoolClass: true } }, user: { select: { name: true } } },
    orderBy: kind === "issue" ? { issuedAt: "desc" } : { returnedAt: "desc" }, take: 30,
  });
  const issue = kind === "issue";
  return (
    <Card className="mt-5">
      <CardHeader title={issue ? "Issued in the last 24 hours" : "Returned in the last 24 hours"} />
      <Table>
        <THead><tr><TH>Book</TH><TH>Borrower</TH>{issue ? <><TH>Issued</TH><TH>Due back</TH></> : <><TH>Returned</TH><TH align="right">Late fine</TH></>}</tr></THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={4} message={issue ? "No books issued in the last 24 hours." : "No books returned in the last 24 hours."} />}
          {rows.map((l) => (
            <TR key={l.id}>
              <TD><Link href={`/library/books/${l.copy.bookId}`} className="font-medium text-ink hover:text-brand-700">{l.copy.book.title}</Link><span className="block font-mono text-xs text-muted">{l.copy.accessionNo}</span></TD>
              <TD>{l.student ? <>{fullName(l.student)}<span className="block text-xs text-muted">{l.student.schoolClass.name}</span></> : <>{l.user?.name}<span className="block text-xs text-muted">Staff</span></>}</TD>
              {issue
                ? <><TD>{fmtDateTime(l.issuedAt)}</TD><TD>{fmtDate(l.dueDate)}</TD></>
                : <><TD>{l.returnedAt ? fmtDateTime(l.returnedAt) : "—"}</TD><TD align="right">{toNum(l.fineAmount) > 0 ? money(toNum(l.fineAmount)) : "—"}</TD></>}
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

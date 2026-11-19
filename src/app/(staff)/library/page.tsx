import Link from "next/link";
import { BookOpen, BookUp, BookDown, Library, AlarmClock } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { daysBetween, fmtDate, fullName, number, today } from "@/lib/format";
import { libraryDashboard } from "@/server/library/service";
import { PageHeader, Card, CardHeader, StatCard, Table, THead, TBody, TR, TH, TD, EmptyRow, LinkButton } from "@/components/ui";

export const metadata = { title: "Library" };

export default async function LibraryOverview() {
  const user = await requireUser("library.view");
  const d = await libraryDashboard(user.branchId);
  const t = today();
  return (
    <>
      <PageHeader title="Library" description="Catalogue, copies, loans and fines."
        actions={hasPerm(user, "library.circulate") && <><LinkButton href="/library/issue" variant="primary"><BookUp className="size-4" />Issue a book</LinkButton><LinkButton href="/library/return" variant="secondary"><BookDown className="size-4" />Return a book</LinkButton></>} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Titles" value={number(d.titles)} href="/library/books" icon={<Library />} />
        <StatCard label="Copies in stock" value={number(d.copies)} href="/library/books" icon={<BookOpen />} />
        <StatCard label="Books out" value={number(d.issued)} href="/library/loans" icon={<BookUp />} />
        <StatCard label="Overdue" value={number(d.overdue)} hint={d.overdue ? "Parents are reminded automatically" : "Nothing overdue"} href="/library/loans?tab=overdue" icon={<AlarmClock />} />
      </div>
      <Card className="mt-6">
        <CardHeader title="Overdue books" actions={<Link href="/library/loans?tab=overdue" className="text-xs font-medium text-brand-700">All overdue →</Link>} />
        <Table>
          <THead><tr><TH>Book</TH><TH>Borrower</TH><TH>Due</TH><TH align="right">Days late</TH></tr></THead>
          <TBody>
            {d.overdueList.length === 0 && <EmptyRow colSpan={4} message="No overdue books." />}
            {d.overdueList.map((l) => (
              <TR key={l.id}>
                <TD><Link href={`/library/books/${l.copy.bookId}`} className="font-medium text-ink hover:text-brand-700">{l.copy.book.title}</Link><span className="block font-mono text-xs text-muted">{l.copy.accessionNo}</span></TD>
                <TD className="whitespace-nowrap">{l.student ? fullName(l.student) : l.user?.name}<span className="block text-xs text-muted">{l.student ? `${l.student.schoolClass.name}${l.student.section ? "-" + l.student.section.name : ""}` : "Staff"}</span></TD>
                <TD>{fmtDate(l.dueDate)}</TD>
                <TD align="right" className="font-medium text-rose-700">{daysBetween(l.dueDate, t)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

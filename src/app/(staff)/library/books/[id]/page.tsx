import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus, QrCode } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fmtDate, fullName, money, today, toNum } from "@/lib/format";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, EmptyRow, StatusBadge, LinkButton, Field, Input, FormGrid } from "@/components/ui";
import { ModalForm, ActionButton } from "@/components/ui/client";
import { addCopiesAction, saveBookAction, setCopyStatusAction } from "../../actions";
import { DeleteBookButton } from "../../_components/delete-book";
import { BookFields } from "../../_components/book-fields";

export const metadata = { title: "Book" };

const COPY_LABEL: Record<string, string> = { AVAILABLE: "Available", ISSUED: "Issued", LOST: "Lost", DAMAGED: "Damaged", WITHDRAWN: "Withdrawn" };
const COPY_STATUS: Record<string, string> = { AVAILABLE: "OK", ISSUED: "PENDING", LOST: "EXPIRED", DAMAGED: "LOW", WITHDRAWN: "ENDED" };

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("library.view");
  const { id } = await params;
  const book = await db.libraryBook.findFirst({
    where: { id, branchId: user.branchId },
    include: {
      copies: {
        orderBy: { accessionNo: "asc" },
        include: { loans: { where: { returnedAt: null }, include: { student: { include: { schoolClass: true } }, user: { select: { name: true } } } } },
      },
    },
  });
  if (!book) notFound();
  const history = await db.libraryLoan.findMany({
    where: { copy: { bookId: book.id } }, orderBy: { issuedAt: "desc" }, take: 20,
    include: { copy: true, student: true, user: { select: { name: true } } },
  });
  const canManage = hasPerm(user, "library.manage");
  const t = today();
  const available = book.copies.filter((c) => c.status === "AVAILABLE").length;
  return (
    <>
      <PageHeader title={book.title} description={[book.author, book.publisher, book.edition].filter(Boolean).join(" · ") || undefined}
        breadcrumbs={[{ label: "Library", href: "/library" }, { label: "Catalogue", href: "/library/books" }, { label: book.title }]}
        actions={<>
          <LinkButton href={`/api/library/labels?bookId=${book.id}`} target="_blank"><QrCode className="size-4" />Print labels</LinkButton>
          {canManage && <ModalForm trigger="Edit" triggerVariant="secondary" icon={<Pencil className="size-4" />} title="Edit book" size="lg" action={saveBookAction} extra={{ id: book.id }} successMessage="Book updated"><BookFields book={book} /></ModalForm>}
          {canManage && (
            <ModalForm trigger="Add copies" icon={<Plus className="size-4" />} title="Add copies" action={addCopiesAction} extra={{ bookId: book.id }} successMessage="@result">
              <FormGrid cols={2}>
                <Field label="Number of copies" required><Input name="count" type="number" min={1} max={200} defaultValue={1} required /></Field>
                <Field label="Price per copy (₹)"><Input name="price" type="number" min={0} step="0.01" /></Field>
                <Field label="Acquired on"><Input name="acquiredOn" type="date" /></Field>
              </FormGrid>
            </ModalForm>
          )}
        </>} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescList cols={1} items={[
              { label: "Category", value: book.category },
              { label: "Language", value: book.language },
              { label: "ISBN", value: book.isbn },
              { label: "Shelf / rack", value: book.shelf },
              { label: "Copies", value: `${book.copies.length} (${available} available)` },
              { label: "Notes", value: book.notes },
            ]} />
            {canManage && book.copies.every((c) => c.loans.length === 0) && history.length === 0 && (
              <div className="mt-5"><DeleteBookButton id={book.id} title={book.title} copies={book.copies.length} /></div>
            )}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Copies" description="Each copy has its own accession number, printed on its label." />
          <Table>
            <THead><tr><TH>Accession no</TH><TH>Status</TH><TH>With</TH><TH>Due</TH><TH align="right">Price</TH>{canManage && <TH />}</tr></THead>
            <TBody>
              {book.copies.length === 0 && <EmptyRow colSpan={6} message="No copies yet. Use “Add copies”." />}
              {book.copies.map((c) => {
                const loan = c.loans[0];
                const overdue = loan && loan.dueDate < t;
                return (
                  <TR key={c.id}>
                    <TD className="font-mono text-xs font-medium text-ink">{c.accessionNo}</TD>
                    <TD><StatusBadge status={overdue ? "OVERDUE" : COPY_STATUS[c.status]} label={overdue ? "Overdue" : COPY_LABEL[c.status]} /></TD>
                    <TD>{loan ? (loan.student ? <Link href={`/students/${loan.studentId}`} className="hover:text-brand-700">{fullName(loan.student)}<span className="block text-xs text-muted">{loan.student.schoolClass.name}</span></Link> : <>{loan.user?.name}<span className="block text-xs text-muted">Staff</span></>) : "—"}</TD>
                    <TD>{loan ? fmtDate(loan.dueDate) : "—"}</TD>
                    <TD align="right">{c.price ? money(toNum(c.price)) : "—"}</TD>
                    {canManage && (
                      <TD align="right">
                        <div className="flex justify-end gap-1.5">
                          {c.status === "AVAILABLE" && <ActionButton action={setCopyStatusAction} args={{ copyId: c.id, status: "DAMAGED" }} successMessage="Marked damaged">Damaged</ActionButton>}
                          {(c.status === "AVAILABLE" || c.status === "DAMAGED") && <ActionButton action={setCopyStatusAction} args={{ copyId: c.id, status: "WITHDRAWN" }} confirm={`Withdraw ${c.accessionNo} from the library?`} successMessage="Withdrawn">Withdraw</ActionButton>}
                          {(c.status === "DAMAGED" || c.status === "WITHDRAWN" || c.status === "LOST") && <ActionButton action={setCopyStatusAction} args={{ copyId: c.id, status: "AVAILABLE" }} successMessage="Back in stock">Back in stock</ActionButton>}
                        </div>
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Loan history" description="Last 20 loans of any copy" />
        <Table>
          <THead><tr><TH>Copy</TH><TH>Borrower</TH><TH>Issued</TH><TH>Due</TH><TH>Returned</TH><TH align="right">Fine</TH></tr></THead>
          <TBody>
            {history.length === 0 && <EmptyRow colSpan={6} message="Not borrowed yet." />}
            {history.map((l) => (
              <TR key={l.id}>
                <TD className="font-mono text-xs">{l.copy.accessionNo}</TD>
                <TD>{l.student ? fullName(l.student) : l.user?.name}</TD>
                <TD>{fmtDate(l.issuedAt)}</TD>
                <TD>{fmtDate(l.dueDate)}</TD>
                <TD>{l.lost ? <StatusBadge status="EXPIRED" label="Lost" /> : l.returnedAt ? fmtDate(l.returnedAt) : <StatusBadge status={l.dueDate < t ? "OVERDUE" : "PENDING"} label={l.dueDate < t ? "Overdue" : "Out"} />}</TD>
                <TD align="right">{toNum(l.fineAmount) > 0 ? <>{money(toNum(l.fineAmount))}{l.fineWaived && <span className="block text-xs text-muted">waived</span>}</> : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

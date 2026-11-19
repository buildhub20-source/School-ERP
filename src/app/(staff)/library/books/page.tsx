import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, Badge } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect, ModalForm } from "@/components/ui/client";
import { saveBookAction } from "../actions";
import { BookFields, BOOK_CATEGORIES } from "../_components/book-fields";

export const metadata = { title: "Library catalogue" };

export default async function BooksPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("library.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const q = sp(s, "q");
  const category = sp(s, "category");
  const availability = sp(s, "availability");
  const where: Prisma.LibraryBookWhereInput = {
    branchId: user.branchId,
    ...(category ? { category } : {}),
    ...(availability === "available" ? { copies: { some: { status: "AVAILABLE" } } } : availability === "none" ? { copies: { none: { status: "AVAILABLE" } } } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { author: { contains: q, mode: "insensitive" } }, { isbn: { contains: q } }, { copies: { some: { accessionNo: { equals: q.trim().toUpperCase() } } } }] } : {}),
  };
  const [total, books] = await Promise.all([
    db.libraryBook.count({ where }),
    db.libraryBook.findMany({ where, include: { copies: { select: { status: true } } }, orderBy: { title: "asc" }, skip, take }),
  ]);
  const canManage = hasPerm(user, "library.manage");
  return (
    <>
      <PageHeader title="Catalogue" description={`${total} title${total === 1 ? "" : "s"}`} breadcrumbs={[{ label: "Library", href: "/library" }, { label: "Catalogue" }]}
        actions={canManage && <ModalForm trigger="Add book" icon={<Plus className="size-4" />} title="Add book" size="lg" action={saveBookAction} successMessage="Book added" redirectTo="/library/books/[id]"><BookFields /></ModalForm>} />
      <Card>
        <div className="border-b border-line p-3">
          <FilterBar>
            <SearchField placeholder="Title, author, ISBN or accession no" />
            <FilterSelect name="category" label="All categories" options={BOOK_CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <FilterSelect name="availability" label="Any availability" options={[{ value: "available", label: "Available to borrow" }, { value: "none", label: "No copy available" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Title</TH><TH>Category</TH><TH>Shelf</TH><TH align="right">Copies</TH><TH align="right">Available</TH><TH align="right">Issued</TH></tr></THead>
          <TBody>
            {books.length === 0 && <EmptyRow colSpan={6} message={q || category || availability ? "No books match these filters." : "No books yet. Use “Add book” to start the catalogue."} />}
            {books.map((b) => {
              const count = (st: string) => b.copies.filter((c) => c.status === st).length;
              const inStock = b.copies.filter((c) => c.status !== "LOST" && c.status !== "WITHDRAWN").length;
              return (
                <TR key={b.id}>
                  <TD><Link href={`/library/books/${b.id}`} className="font-medium text-ink hover:text-brand-700">{b.title}</Link>{b.author && <span className="block text-xs text-muted">{b.author}</span>}</TD>
                  <TD><Badge>{b.category}</Badge>{b.language !== "English" && <span className="ml-1.5 text-xs text-muted">{b.language}</span>}</TD>
                  <TD>{b.shelf ?? "—"}</TD>
                  <TD align="right">{inStock}</TD>
                  <TD align="right">{count("AVAILABLE") > 0 ? <span className="font-medium text-emerald-700">{count("AVAILABLE")}</span> : <span className="text-muted">0</span>}</TD>
                  <TD align="right">{count("ISSUED")}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/library/books" />
      </Card>
    </>
  );
}

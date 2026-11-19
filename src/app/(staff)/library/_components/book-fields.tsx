import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui";

export const BOOK_CATEGORIES = ["General", "Fiction", "Non-fiction", "Reference", "Textbook", "Science", "Mathematics", "History", "Geography", "Literature", "Tamil", "Biography", "Children", "Comics", "Magazines", "Competitive exams"];
const LANGUAGES = ["English", "Tamil", "Hindi", "Other"];

type Book = { title: string; author: string | null; isbn: string | null; publisher: string | null; edition: string | null; category: string; language: string; shelf: string | null; notes: string | null };

/** Fields for adding or editing a book. New books also ask how many copies to add (each gets its own accession number). */
export function BookFields({ book }: { book?: Book }) {
  const categories = book && !BOOK_CATEGORIES.includes(book.category) ? [book.category, ...BOOK_CATEGORIES] : BOOK_CATEGORIES;
  return (
    <FormGrid cols={2}>
      <Field label="Title" required className="sm:col-span-2"><Input name="title" defaultValue={book?.title} required maxLength={250} /></Field>
      <Field label="Author"><Input name="author" defaultValue={book?.author ?? ""} /></Field>
      <Field label="ISBN"><Input name="isbn" defaultValue={book?.isbn ?? ""} inputMode="numeric" /></Field>
      <Field label="Publisher"><Input name="publisher" defaultValue={book?.publisher ?? ""} /></Field>
      <Field label="Edition"><Input name="edition" defaultValue={book?.edition ?? ""} /></Field>
      <Field label="Category" required><Select name="category" defaultValue={book?.category ?? "General"}>{categories.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label="Language" required><Select name="language" defaultValue={book?.language ?? "English"}>{LANGUAGES.map((l) => <option key={l}>{l}</option>)}</Select></Field>
      <Field label="Shelf / rack" hint="Where the book is kept, e.g. R3-B"><Input name="shelf" defaultValue={book?.shelf ?? ""} /></Field>
      {!book && (
        <>
          <Field label="Number of copies" required hint="Each copy gets an accession number"><Input name="copies" type="number" min={1} max={200} defaultValue={1} required /></Field>
          <Field label="Price per copy (₹)" hint="Used when a lost book is charged"><Input name="price" type="number" min={0} step="0.01" /></Field>
          <Field label="Acquired on"><Input name="acquiredOn" type="date" /></Field>
        </>
      )}
      <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={book?.notes ?? ""} rows={2} /></Field>
    </FormGrid>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { BookUp, CalendarDays } from "lucide-react";
import { Button, Card, CardBody, Field, Input } from "@/components/ui";
import { useAction } from "@/components/ui/client";
import { issueBookAction } from "../actions";
import { BorrowerPicker, type Borrower } from "../_components/borrower-picker";

/** Issue desk: 1) who is borrowing, 2) which book. The borrower stays selected so several books can be issued in a row. */
export function IssueForm() {
  const [borrower, setBorrower] = useState<Borrower | null>(null);
  const [acc, setAcc] = useState("");
  const [due, setDue] = useState("");
  const [showDue, setShowDue] = useState(false);
  const accRef = useRef<HTMLInputElement>(null);
  const issue = useAction(issueBookAction, { successMessage: "@result", onSuccess: () => { setAcc(""); setDue(""); setShowDue(false); accRef.current?.focus(); } });
  useEffect(() => { if (borrower) accRef.current?.focus(); }, [borrower]);
  return (
    <Card>
      <CardBody>
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (borrower && acc.trim()) issue.run({ borrower: borrower.value, accessionNo: acc, dueDate: due }); }}>
          <Field label="1. Who is borrowing?" required><BorrowerPicker value={borrower} onChange={setBorrower} autoFocus /></Field>
          <Field label="2. Book accession no" required hint={borrower ? "Scan the label on the book, or type the number." : "Choose the borrower first."}>
            <Input ref={accRef} value={acc} onChange={(e) => setAcc(e.target.value.toUpperCase())} placeholder="e.g. L00012" autoComplete="off" className="font-mono" disabled={!borrower} />
          </Field>
          {showDue ? (
            <Field label="Due date" hint="Leave empty to use the library rules.">
              <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          ) : (
            <p className="text-sm text-muted">
              Due date follows the library rules.{" "}
              <button type="button" onClick={() => setShowDue(true)} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><CalendarDays className="size-3.5" />Change due date</button>
            </p>
          )}
          <Button type="submit" size="lg" className="w-full sm:w-auto" loading={issue.pending} disabled={!borrower || !acc.trim()}><BookUp className="size-4" />Issue book</Button>
        </form>
      </CardBody>
    </Card>
  );
}

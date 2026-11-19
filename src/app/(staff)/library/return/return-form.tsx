"use client";
import { useRef, useState } from "react";
import { BookDown } from "lucide-react";
import { Button, Card, CardBody, Checkbox, Field, Input } from "@/components/ui";
import { useAction } from "@/components/ui/client";
import { returnBookAction } from "../actions";

/** Return desk: scan or type the accession number. The borrower is found from the book, so nothing else is needed. */
export function ReturnForm({ canWaive }: { canWaive: boolean }) {
  const [acc, setAcc] = useState("");
  const [damaged, setDamaged] = useState(false);
  const [waive, setWaive] = useState(false);
  const [reason, setReason] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const back = useAction(returnBookAction, { successMessage: "@result", onSuccess: () => { setAcc(""); setDamaged(false); setWaive(false); setReason(""); ref.current?.focus(); } });
  return (
    <Card>
      <CardBody>
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (acc.trim()) back.run({ accessionNo: acc, damaged, waiveFine: waive, reason }); }}>
          <Field label="Book accession no" required hint="Scan the label on the book, or type the number. A late return by a student adds the fine to their fee account.">
            <Input ref={ref} value={acc} onChange={(e) => setAcc(e.target.value.toUpperCase())} placeholder="e.g. L00012" autoComplete="off" className="font-mono" autoFocus />
          </Field>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox label="Book is damaged" checked={damaged} onChange={(e) => setDamaged(e.target.checked)} />
            {canWaive && <Checkbox label="Do not charge the late fine" checked={waive} onChange={(e) => setWaive(e.target.checked)} />}
          </div>
          {waive && <Field label="Why is the fine not charged?" required><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>}
          <Button type="submit" size="lg" className="w-full sm:w-auto" loading={back.pending} disabled={!acc.trim() || (waive && !reason.trim())}><BookDown className="size-4" />Return book</Button>
        </form>
      </CardBody>
    </Card>
  );
}

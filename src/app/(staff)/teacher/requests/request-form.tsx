"use client";
import { ModalForm, ActionButton } from "@/components/ui/client";
import { Field, FormGrid, Select, Textarea } from "@/components/ui";
import { Plus } from "lucide-react";
import { newRequest, cancelMyRequest } from "./actions";
import { LinesEditor, type ItemOpt } from "../../stationery/_components/lines-editor";

type Opt = { id: string; name: string };

export function NewRequestButton({ items, classes, departments, defaultTarget }: { items: ItemOpt[]; classes: Opt[]; departments: Opt[]; defaultTarget?: string }) {
  return (
    <ModalForm trigger="New request" icon={<Plus className="size-4" />} title="Request stationery" description="The store manager approves the request and issues the items." action={newRequest} size="lg"
      submitLabel="Send request" successMessage={(d: { requestNo: string }) => `Request ${d.requestNo} sent for approval`} redirectTo={(d: { id: string }) => `/teacher/requests/${d.id}`}>
      <FormGrid>
        <Field label="For class or department" hint="The items are charged to this budget.">
          <Select name="target" defaultValue={defaultTarget ?? ""}>
            <option value="">— Personal use —</option>
            <optgroup label="Classes">{classes.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.name}</option>)}</optgroup>
            <optgroup label="Departments">{departments.map((d) => <option key={d.id} value={`d:${d.id}`}>{d.name}</option>)}</optgroup>
          </Select>
        </Field>
        <Field label="Purpose" required><Textarea name="purpose" rows={1} required maxLength={300} placeholder="e.g. Class 5A notebooks for term 2" /></Field>
      </FormGrid>
      <Field label="Items" required><LinesEditor items={items} showStock={false} /></Field>
    </ModalForm>
  );
}

export function CancelRequestButton({ id }: { id: string }) {
  return <ActionButton action={cancelMyRequest} args={{ id }} confirm="Cancel this request?" variant="danger" size="md" successMessage="Request cancelled">Cancel request</ActionButton>;
}

"use client";
import { ModalForm } from "@/components/ui/client";
import { Checkbox, Field, FormGrid, Input } from "@/components/ui";
import { saveBranch } from "../actions";

export function BranchForm({ initial }: { initial?: { id: string; code: string; name: string; address: string; phone: string; email: string; isActive: boolean } }) {
  return (
    <ModalForm trigger={initial ? "Edit" : "Add branch"} triggerVariant={initial ? "ghost" : "primary"} triggerSize="sm" title={initial ? `Edit ${initial.name}` : "Add branch"} action={saveBranch} extra={{ id: initial?.id }} successMessage="Branch saved">
      <FormGrid cols={2}>
        <Field label="Code" hint="Used in receipt numbers" required><Input name="code" defaultValue={initial?.code} required /></Field>
        <Field label="Name" required><Input name="name" defaultValue={initial?.name} required /></Field>
        <Field label="Address" className="sm:col-span-2"><Input name="address" defaultValue={initial?.address} /></Field>
        <Field label="Phone"><Input name="phone" defaultValue={initial?.phone} /></Field>
        <Field label="Email"><Input type="email" name="email" defaultValue={initial?.email} /></Field>
        <Checkbox name="isActive" label="Active" defaultChecked={initial?.isActive ?? true} />
      </FormGrid>
    </ModalForm>
  );
}

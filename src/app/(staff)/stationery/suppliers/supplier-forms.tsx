"use client";
import { ModalForm } from "@/components/ui/client";
import { Field, FormGrid, Input, Select, Textarea, Checkbox } from "@/components/ui";
import { Plus, Pencil, Tag } from "lucide-react";
import { saveSupplierAction, addQuoteAction } from "../actions";

export type SupplierValue = { id: string; name: string; contactPerson: string | null; phone: string | null; email: string | null; address: string | null; gstin: string | null; notes: string | null; isActive: boolean };

export function SupplierFormButton({ supplier }: { supplier?: SupplierValue }) {
  return (
    <ModalForm trigger={supplier ? "Edit" : "Add supplier"} icon={supplier ? <Pencil className="size-4" /> : <Plus className="size-4" />} triggerVariant={supplier ? "secondary" : "primary"}
      title={supplier ? `Edit ${supplier.name}` : "Add supplier"} action={saveSupplierAction} extra={{ id: supplier?.id }} size="lg" successMessage="Supplier saved"
      redirectTo={supplier ? undefined : (d: { id: string }) => `/stationery/suppliers/${d.id}`}>
      <FormGrid>
        <Field label="Name" required className="sm:col-span-2"><Input name="name" defaultValue={supplier?.name} required maxLength={120} /></Field>
        <Field label="Contact person"><Input name="contactPerson" defaultValue={supplier?.contactPerson ?? ""} maxLength={120} /></Field>
        <Field label="Mobile"><Input name="phone" type="tel" inputMode="tel" defaultValue={supplier?.phone ?? ""} /></Field>
        <Field label="Email"><Input name="email" type="email" defaultValue={supplier?.email ?? ""} /></Field>
        <Field label="GSTIN"><Input name="gstin" defaultValue={supplier?.gstin ?? ""} maxLength={20} className="uppercase" /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea name="address" rows={2} defaultValue={supplier?.address ?? ""} maxLength={500} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} defaultValue={supplier?.notes ?? ""} maxLength={1000} /></Field>
        {supplier && <Checkbox name="isActive" value="true" defaultChecked={supplier.isActive} label="Active" />}
      </FormGrid>
    </ModalForm>
  );
}

export function QuoteButton({ suppliers, items, supplierId, itemId, today }: { suppliers: { id: string; name: string }[]; items: { id: string; name: string }[]; supplierId?: string; itemId?: string; today: string }) {
  return (
    <ModalForm trigger="Record quote" icon={<Tag className="size-4" />} triggerVariant="secondary" title="Record a supplier price quote" description="Added to the price history and the price comparison." action={addQuoteAction} successMessage="Quote recorded">
      <Field label="Supplier" required><Select name="supplierId" defaultValue={supplierId ?? ""} required placeholder="Choose…">{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <Field label="Item" required><Select name="itemId" defaultValue={itemId ?? ""} required placeholder="Choose…">{items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <FormGrid>
        <Field label="Unit price (₹)" required><Input name="price" type="number" min={0.01} step="0.01" required /></Field>
        <Field label="Quote date"><Input name="effectiveDate" type="date" defaultValue={today} /></Field>
      </FormGrid>
    </ModalForm>
  );
}

"use client";
import { ModalForm, ActionButton } from "@/components/ui/client";
import { Field, FormGrid, Input, Select, Checkbox } from "@/components/ui";
import { Plus, Pencil } from "lucide-react";
import { saveItem, toggleItem } from "../actions";

export type ItemFormValue = { id: string; code: string; name: string; category: string; unit: string; reorderLevel: number; reorderQty: number; unitCost: number; preferredSupplierId: string | null; isActive: boolean };

export function ItemFormButton({ item, suppliers, categories, units }: { item?: ItemFormValue; suppliers: { id: string; name: string }[]; categories: string[]; units: string[] }) {
  const cats = item && !categories.includes(item.category) ? [...categories, item.category] : categories;
  return (
    <ModalForm trigger={item ? "Edit" : "Add item"} icon={item ? <Pencil className="size-4" /> : <Plus className="size-4" />} triggerVariant={item ? "secondary" : "primary"} triggerSize={item ? "sm" : "md"}
      title={item ? `Edit ${item.name}` : "Add stationery item"} action={saveItem} extra={{ id: item?.id }} size="lg"
      successMessage={item ? "Item updated" : "Item added"} redirectTo={item ? undefined : (d: { id: string }) => `/stationery/items/${d.id}`}>
      <FormGrid>
        <Field label="Name" required className="sm:col-span-2"><Input name="name" defaultValue={item?.name} required maxLength={120} placeholder="e.g. Long notebook 200 pages" /></Field>
        <Field label="Category" required>
          <Select name="category" defaultValue={item?.category ?? "Notebook"} required>{cats.map((c) => <option key={c}>{c}</option>)}</Select>
        </Field>
        <Field label="Unit" required>
          <Select name="unit" defaultValue={item?.unit ?? "pcs"} required>{(item && !units.includes(item.unit) ? [...units, item.unit] : units).map((u) => <option key={u}>{u}</option>)}</Select>
        </Field>
        <Field label="Code (barcode / QR)" hint={item ? undefined : "Leave blank to generate one, or scan the product's barcode."}><Input name="code" defaultValue={item?.code} maxLength={40} className="font-mono uppercase" /></Field>
        <Field label="Unit cost (₹)" required><Input name="unitCost" type="number" min={0} step="0.01" defaultValue={item?.unitCost ?? ""} required /></Field>
        <Field label="Reorder level" hint="Alert and draft a purchase order at or below this stock." required><Input name="reorderLevel" type="number" min={0} step={1} defaultValue={item?.reorderLevel ?? 0} required /></Field>
        <Field label="Reorder quantity" hint="Quantity put on the draft purchase order." required><Input name="reorderQty" type="number" min={0} step={1} defaultValue={item?.reorderQty ?? 0} required /></Field>
        <Field label="Usual supplier">
          <Select name="preferredSupplierId" defaultValue={item?.preferredSupplierId ?? ""} placeholder="— None —">{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
        {!item && <Field label="Opening stock" hint="Current quantity in the store."><Input name="openingStock" type="number" min={0} step={1} defaultValue={0} /></Field>}
        {item && <div className="flex items-end"><Checkbox name="isActive" value="true" defaultChecked={item.isActive} label="Active" /></div>}
      </FormGrid>
    </ModalForm>
  );
}

export function ToggleItemButton({ id, isActive }: { id: string; isActive: boolean }) {
  return (
    <ActionButton action={toggleItem} args={{ id, isActive: !isActive }} confirm={isActive ? "Deactivate this item? It will be hidden from requests and issue lists." : "Reactivate this item?"} variant={isActive ? "danger" : "secondary"} successMessage={isActive ? "Item deactivated" : "Item reactivated"}>
      {isActive ? "Deactivate" : "Reactivate"}
    </ActionButton>
  );
}

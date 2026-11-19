"use client";
import { useState } from "react";
import { ActionForm } from "@/components/ui/client";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import { savePo, recordPurchase } from "../actions";
import { LinesEditor, type ItemOpt } from "../_components/lines-editor";

export type PoFormValue = { id: string; supplierId: string; expectedDate: string; notes: string; lines: { itemId: string; qty: number; unitPrice: number }[] };

/** Create/edit a draft order, or (quick) record a purchase that is received immediately. */
export function PoForm({ items, suppliers, prices, po, quick, defaultSupplierId, initialLines }: {
  items: ItemOpt[]; suppliers: { id: string; name: string }[]; prices: Record<string, Record<string, number>>; po?: PoFormValue; quick?: boolean; defaultSupplierId?: string;
  initialLines?: { itemId: string; qty: number; unitPrice: number }[];
}) {
  const [supplierId, setSupplierId] = useState(po?.supplierId ?? defaultSupplierId ?? "");
  return (
    <ActionForm action={quick ? recordPurchase : savePo} extra={{ id: po?.id }} submitLabel={quick ? "Record purchase & add stock" : po ? "Save draft" : "Create draft order"}
      successMessage={quick ? "Purchase recorded. Stock added." : "Purchase order saved"} redirectTo={(d: { id: string }) => `/stationery/purchases/${d.id}`}>
      <FormGrid cols={3}>
        <Field label="Supplier" required>
          <Select name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required placeholder="Choose supplier…">
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        {quick
          ? <Field label="Supplier invoice no"><Input name="invoiceNo" maxLength={60} /></Field>
          : <Field label="Expected delivery"><Input type="date" name="expectedDate" defaultValue={po?.expectedDate} /></Field>}
        <Field label="Notes" className="sm:col-span-2 lg:col-span-1"><Textarea name="notes" rows={1} defaultValue={po?.notes} maxLength={1000} /></Field>
      </FormGrid>
      <Field label="Items" hint="Price defaults to this supplier's last price, else the item's unit cost." required>
        <LinesEditor key={supplierId} items={items} withPrice showStock={false} priceFor={prices[supplierId]} initial={po?.lines ?? initialLines} />
      </Field>
    </ActionForm>
  );
}

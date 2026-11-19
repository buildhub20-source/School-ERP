"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, Printer } from "lucide-react";
import { Button, Field, FormGrid, Input, Select, Textarea, Checkbox } from "@/components/ui";
import { ModalForm, ActionButton, useAction } from "@/components/ui/client";
import { ExcelImport } from "@/components/shared/excel-import";
import { CATEGORIES, CATEGORY_LABELS, GENDER_LABELS, UNIFORM_GENDERS } from "@/server/uniforms/labels";
import {
  adjustStockAction, deleteSetAction, importAction, preorderWindowAction, purchaseAction, saveItemAction, saveSetAction, saveVariantAction, supplierAction,
} from "../actions";

type ItemVals = { id: string; name: string; category: string; gender: string; description: string | null; isActive: boolean };

export function ItemModal({ item }: { item?: ItemVals }) {
  return (
    <ModalForm trigger={item ? "Edit item" : "Add item"} triggerVariant={item ? "secondary" : "primary"} triggerSize={item ? "sm" : "md"} icon={item ? <Pencil className="size-4" /> : <Plus className="size-4" />}
      title={item ? `Edit ${item.name}` : "Add uniform item"} action={saveItemAction} extra={{ id: item?.id }} successMessage={item ? "Item saved" : "Item added"}
      redirectTo={item ? undefined : (d: { id: string }) => `/uniforms/items/${d.id}`}>
      <FormGrid>
        <Field label="Name" required className="sm:col-span-2"><Input name="name" defaultValue={item?.name} required maxLength={120} placeholder="e.g. Shirt (white, half sleeve)" /></Field>
        <Field label="Category" required>
          <Select name="category" defaultValue={item?.category ?? "SHIRT"}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</Select>
        </Field>
        <Field label="For" required>
          <Select name="gender" defaultValue={item?.gender ?? "UNISEX"}>{UNIFORM_GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}</Select>
        </Field>
        {!item && <>
          <Field label="Sizes" required className="sm:col-span-2" hint="Comma separated, or a range: 28-40/2 (28, 30 … 40), 1-10, S, M, L, Free">
            <Input name="sizes" required placeholder="28-40/2" />
          </Field>
          <Field label="Price per piece (₹)" required><Input name="price" type="number" min={0} step="0.01" required /></Field>
          <Field label="Reorder level (per size)"><Input name="reorderLevel" type="number" min={0} defaultValue={0} /></Field>
          <Field label="Opening stock (per size)" hint="You can change each size afterwards."><Input name="openingStock" type="number" min={0} defaultValue={0} /></Field>
        </>}
        <Field label="Description" className="sm:col-span-2"><Textarea name="description" defaultValue={item?.description ?? ""} maxLength={500} /></Field>
        {item && <Checkbox name="isActive" label="Active (available for orders)" defaultChecked={item.isActive} />}
        {!item && <input type="hidden" name="isActive" value="true" />}
      </FormGrid>
    </ModalForm>
  );
}

type VariantVals = { id: string; size: string; sizeOrder: number; price: number; reorderLevel: number; sku: string | null; isActive: boolean };

export function VariantModal({ itemId, variant }: { itemId: string; variant?: VariantVals }) {
  return (
    <ModalForm trigger={variant ? "" : "Add size"} triggerVariant={variant ? "ghost" : "secondary"} triggerSize="sm" icon={variant ? <Pencil className="size-4" aria-label="Edit size" /> : <Plus className="size-4" />}
      title={variant ? `Edit size ${variant.size}` : "Add size"} action={saveVariantAction} extra={{ id: variant?.id, itemId }} successMessage="Size saved">
      <FormGrid>
        <Field label="Size" required><Input name="size" defaultValue={variant?.size} required maxLength={20} /></Field>
        <Field label="Size order" hint="Smaller first; used for size suggestions."><Input name="sizeOrder" type="number" defaultValue={variant?.sizeOrder} placeholder="Auto" /></Field>
        <Field label="Price (₹)" required><Input name="price" type="number" step="0.01" min={0} defaultValue={variant?.price} required /></Field>
        <Field label="Reorder level"><Input name="reorderLevel" type="number" min={0} defaultValue={variant?.reorderLevel ?? 0} /></Field>
        <Field label="SKU / barcode"><Input name="sku" defaultValue={variant?.sku ?? ""} maxLength={60} /></Field>
        {!variant && <Field label="Opening stock"><Input name="openingStock" type="number" min={0} defaultValue={0} /></Field>}
        {variant ? <Checkbox name="isActive" label="Active" defaultChecked={variant.isActive} /> : <input type="hidden" name="isActive" value="true" />}
      </FormGrid>
    </ModalForm>
  );
}

export function AdjustStockModal({ variantId, label, stock }: { variantId: string; label: string; stock: number }) {
  return (
    <ModalForm trigger="Adjust" triggerVariant="secondary" triggerSize="sm" title={`Adjust stock: ${label}`} description={`Current stock: ${stock}`} action={adjustStockAction} extra={{ variantId }} successMessage="Stock updated">
      <FormGrid>
        <Field label="Type" required>
          <Select name="type" defaultValue="ADJUSTMENT"><option value="ADJUSTMENT">Adjustment (+ add / − remove)</option><option value="DAMAGE">Damaged (removes stock)</option></Select>
        </Field>
        <Field label="Quantity" required hint="Use a minus sign to remove, e.g. -2"><Input name="qty" type="number" required /></Field>
        <Field label="Reason" required className="sm:col-span-2"><Input name="note" required maxLength={300} placeholder="e.g. Physical count correction" /></Field>
      </FormGrid>
    </ModalForm>
  );
}

// ───────────── Sets ─────────────

type SetVals = { id: string; name: string; classId: string | null; gender: string; items: { itemId: string; qty: number }[] };
export function SetModal({ set, classes, items }: { set?: SetVals; classes: { id: string; name: string }[]; items: { id: string; name: string; gender: string; category: string }[] }) {
  const [sel, setSel] = useState<Record<string, number>>(() => Object.fromEntries((set?.items ?? []).map((i) => [i.itemId, i.qty])));
  const [gender, setGender] = useState(set?.gender ?? "BOY");
  const visible = items.filter((i) => gender === "UNISEX" || i.gender === gender || i.gender === "UNISEX");
  const chosen = Object.entries(sel).filter(([id]) => visible.some((v) => v.id === id)).map(([itemId, qty]) => ({ itemId, qty }));
  return (
    <ModalForm trigger={set ? "Edit" : "Add set"} triggerVariant={set ? "secondary" : "primary"} triggerSize={set ? "sm" : "md"} icon={set ? <Pencil className="size-4" /> : <Plus className="size-4" />}
      title={set ? `Edit ${set.name}` : "Add uniform set"} size="lg" action={saveSetAction} extra={{ id: set?.id, items: JSON.stringify(chosen) }} successMessage="Set saved">
      <FormGrid cols={3}>
        <Field label="Name" required><Input name="name" defaultValue={set?.name} required maxLength={120} placeholder="Class 1–5 boys" /></Field>
        <Field label="Class"><Select name="classId" defaultValue={set?.classId ?? ""} placeholder="All classes">{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Gender" required>
          <Select name="gender" value={gender} onChange={(e) => setGender(e.target.value)}>{UNIFORM_GENDERS.map((g) => <option key={g} value={g}>{GENDER_LABELS[g]}</option>)}</Select>
        </Field>
      </FormGrid>
      <div className="mt-4 max-h-80 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
        {visible.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-slate-50">
            <Checkbox label={<>{i.name} <span className="text-xs text-slate-500">({CATEGORY_LABELS[i.category as keyof typeof CATEGORY_LABELS]})</span></>} checked={i.id in sel}
              onChange={(e) => setSel((s) => { const n = { ...s }; if (e.target.checked) n[i.id] = 1; else delete n[i.id]; return n; })} />
            {i.id in sel && <Input type="number" min={1} max={10} value={sel[i.id]} onChange={(e) => setSel((s) => ({ ...s, [i.id]: Math.max(1, Math.min(10, Number(e.target.value) || 1)) }))} className="w-16" aria-label={`Quantity of ${i.name}`} />}
          </div>
        ))}
        {!visible.length && <p className="p-3 text-sm text-slate-500">No items for this gender yet.</p>}
      </div>
      <p className="mt-2 text-xs text-slate-500">{chosen.length} item(s) selected. The most specific set (class + gender) is used for a student; “All classes” sets are the fallback.</p>
    </ModalForm>
  );
}

export function DeleteSetButton({ id }: { id: string }) {
  return <ActionButton action={deleteSetAction} args={{ id }} variant="danger" confirm="Delete this set?" successMessage="Set deleted"><Trash2 className="size-4" /></ActionButton>;
}

// ───────────── Suppliers & purchases ─────────────

export function SupplierModal() {
  return (
    <ModalForm trigger="New supplier" triggerVariant="secondary" icon={<Plus className="size-4" />} title="Add uniform supplier" action={supplierAction} successMessage="Supplier added">
      <FormGrid>
        <Field label="Name" required className="sm:col-span-2"><Input name="name" required maxLength={120} /></Field>
        <Field label="Contact person"><Input name="contactPerson" maxLength={120} /></Field>
        <Field label="Mobile"><Input name="phone" inputMode="numeric" /></Field>
        <Field label="Email"><Input name="email" type="email" /></Field>
        <Field label="GSTIN"><Input name="gstin" maxLength={20} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea name="address" maxLength={300} /></Field>
      </FormGrid>
    </ModalForm>
  );
}

type VOpt = { id: string; label: string; stock: number; price: number; lastCost: number };
type PLine = { key: number; variantId: string; qty: number; unitPrice: number };

export function PurchaseBuilder({ suppliers, variants, initial, defaultStatus = "ORDERED", onDone }: {
  suppliers: { id: string; name: string }[];
  variants: VOpt[];
  initial?: { variantId: string; qty: number }[];
  defaultStatus?: "DRAFT" | "ORDERED" | "RECEIVED";
  onDone?: () => void;
}) {
  const router = useRouter();
  const byId = new Map(variants.map((v) => [v.id, v]));
  const cost = (id: string) => { const v = byId.get(id); return v ? v.lastCost || v.price : 0; };
  const [lines, setLines] = useState<PLine[]>(() => (initial ?? []).map((l, i) => ({ key: i + 1, variantId: l.variantId, qty: l.qty, unitPrice: cost(l.variantId) })));
  const [seq, setSeq] = useState((initial?.length ?? 0) + 1);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [status, setStatus] = useState(defaultStatus);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [pick, setPick] = useState("");
  const { run, pending } = useAction(purchaseAction, {
    successMessage: (d) => `Purchase ${d.poNumber} ${status === "RECEIVED" ? "recorded — stock added" : "saved"}`,
    onSuccess: (d) => { onDone?.(); router.push(`/uniforms/purchases/${d.id}`); },
  });
  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const upd = (key: number, p: Partial<PLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  return (
    <div className="space-y-4">
      <FormGrid cols={3}>
        <Field label="Supplier" required>
          <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} placeholder="Choose supplier">{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
        <Field label="Save as" required>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="DRAFT">Draft (not sent)</option><option value="ORDERED">Ordered (awaiting delivery)</option><option value="RECEIVED">Received now (quick purchase)</option>
          </Select>
        </Field>
        {status === "RECEIVED"
          ? <Field label="Supplier invoice no"><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} maxLength={60} /></Field>
          : <Field label="Expected by"><Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></Field>}
      </FormGrid>
      <div className="flex flex-wrap gap-2">
        <Select value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Add item size…" className="min-w-0 flex-1 sm:max-w-sm">
          {variants.filter((v) => !lines.some((l) => l.variantId === v.id)).map((v) => <option key={v.id} value={v.id}>{v.label} · stock {v.stock}</option>)}
        </Select>
        <Button type="button" variant="secondary" disabled={!pick} onClick={() => { setLines((ls) => [...ls, { key: seq, variantId: pick, qty: 1, unitPrice: cost(pick) }]); setSeq(seq + 1); setPick(""); }}><Plus className="size-4" />Add</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Item / size</th><th className="px-3 py-2 text-left">Qty</th><th className="px-3 py-2 text-left">Unit cost (₹)</th><th className="px-3 py-2 text-right">Amount</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {!lines.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">No items yet.</td></tr>}
            {lines.map((l) => (
              <tr key={l.key}>
                <td className="px-3 py-2">{byId.get(l.variantId)?.label}</td>
                <td className="px-3 py-2"><Input type="number" min={1} value={l.qty} onChange={(e) => upd(l.key, { qty: Math.max(1, Number(e.target.value) || 1) })} className="w-24" aria-label="Quantity" /></td>
                <td className="px-3 py-2"><Input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => upd(l.key, { unitPrice: Math.max(0, Number(e.target.value) || 0) })} className="w-28" aria-label="Unit cost" /></td>
                <td className="px-3 py-2 text-right tabular-nums">₹{(l.qty * l.unitPrice).toLocaleString("en-IN")}</td>
                <td className="px-2 py-2 text-right"><button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded p-1 text-slate-400 hover:text-rose-600" aria-label="Remove"><Trash2 className="size-4" /></button></td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && <tfoot className="bg-slate-50"><tr><td colSpan={3} className="px-3 py-2 text-right font-semibold">Total</td><td className="px-3 py-2 text-right font-semibold tabular-nums">₹{total.toLocaleString("en-IN")}</td><td /></tr></tfoot>}
        </table>
      </div>
      {!suppliers.length && <p className="text-sm text-amber-700">Add a supplier first.</p>}
      <div className="flex justify-end">
        <Button type="button" loading={pending} disabled={!supplierId || !lines.length}
          onClick={() => run({ supplierId, status, invoiceNo, expectedDate, isAutoDraft: initial?.length ? "true" : "false", lines: JSON.stringify(lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitPrice: l.unitPrice }))) })}>
          {status === "RECEIVED" ? "Record purchase & add stock" : status === "DRAFT" ? "Save draft" : "Place order"}
        </Button>
      </div>
    </div>
  );
}

// ───────────── Pre-order window, import, ID cards ─────────────

export function PreorderToggle({ yearId, open }: { yearId: string; open: boolean }) {
  const [notify, setNotify] = useState(true);
  const { run, pending } = useAction(preorderWindowAction, { successMessage: (d) => (open ? "Pre-orders closed" : d.notified ? `Pre-orders opened; parents of ${d.notified} students notified` : "Pre-orders opened") });
  return (
    <div className="flex flex-wrap items-center gap-3">
      {!open && <Checkbox label="Notify parents with suggested sizes" checked={notify} onChange={(e) => setNotify(e.target.checked)} />}
      <Button variant={open ? "danger" : "success"} loading={pending} onClick={() => run({ yearId, open: open ? "false" : "true", notify: notify ? "true" : "false" })}>
        {open ? "Close pre-orders" : "Open pre-orders"}
      </Button>
    </div>
  );
}

export function UniformImportForm() {
  return <ExcelImport action={importAction} label="rows" />;
}

export function IdCardPicker({ students }: { students: { id: string; name: string; admissionNo: string; className: string; lastPrinted: string | null; hasPhoto: boolean }[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const all = students.length > 0 && sel.size === students.length;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const href = `/api/uniforms/id-cards?studentIds=${[...sel].join(",")}`;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <Checkbox label={`Select all (${students.length})`} checked={all} onChange={() => setSel(all ? new Set() : new Set(students.map((s) => s.id)))} />
        <a href={sel.size ? href : undefined} target="_blank" rel="noreferrer" aria-disabled={!sel.size}
          className={`inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-medium shadow-sm transition-colors ${sel.size ? "bg-brand-300 text-on-brand hover:bg-brand-400" : "pointer-events-none bg-brand-300 text-on-brand opacity-50"}`}>
          <Printer className="size-4" />Print {sel.size || ""} card{sel.size === 1 ? "" : "s"}
        </a>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500"><tr><th className="w-10 px-3 py-2" /><th className="px-3 py-2 text-left">Student</th><th className="px-3 py-2 text-left">Adm. no</th><th className="px-3 py-2 text-left">Class</th><th className="px-3 py-2 text-left">Photo</th><th className="px-3 py-2 text-left">Last printed</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {!students.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Choose a class to list students.</td></tr>}
            {students.map((s) => (
              <tr key={s.id} className="hover:bg-slate-50">
                <td className="px-3 py-2"><input type="checkbox" className="size-4 rounded border-slate-300" checked={sel.has(s.id)} onChange={() => toggle(s.id)} aria-label={`Select ${s.name}`} /></td>
                <td className="px-3 py-2 font-medium text-slate-900">{s.name}</td>
                <td className="px-3 py-2 font-mono text-xs">{s.admissionNo}</td>
                <td className="px-3 py-2">{s.className}</td>
                <td className="px-3 py-2">{s.hasPhoto ? "Yes" : <span className="text-amber-700">No photo</span>}</td>
                <td className="px-3 py-2 text-slate-500">{s.lastPrinted ?? "Never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


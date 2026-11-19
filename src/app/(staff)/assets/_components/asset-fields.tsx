import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import { isoDate } from "@/lib/format";
import { ASSET_CATEGORIES } from "@/server/assets/service";

type A = {
  name: string; category: string; location: string | null; assignedTo: string | null; brand: string | null; model: string | null; serialNo: string | null;
  supplierName: string | null; invoiceNo: string | null; purchaseDate: Date | null; cost: unknown; usefulLifeYears: number; salvageValue: unknown;
  warrantyUntil: Date | null; condition: string; notes: string | null;
};

export function AssetFields({ asset }: { asset?: A }) {
  const cats = asset && !ASSET_CATEGORIES.includes(asset.category) ? [asset.category, ...ASSET_CATEGORIES] : ASSET_CATEGORIES;
  return (
    <FormGrid cols={2}>
      <Field label="Name" required className="sm:col-span-2"><Input name="name" defaultValue={asset?.name} required placeholder="e.g. Dell OptiPlex desktop" /></Field>
      <Field label="Category" required><Select name="category" defaultValue={asset?.category ?? ASSET_CATEGORIES[0]}>{cats.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label="Condition" required><Select name="condition" defaultValue={asset?.condition ?? "NEW"}><option value="NEW">New</option><option value="GOOD">Good</option><option value="FAIR">Fair</option><option value="POOR">Poor</option></Select></Field>
      <Field label="Location" hint="Room or area, e.g. Computer Lab 1"><Input name="location" defaultValue={asset?.location ?? ""} /></Field>
      <Field label="Assigned to" hint="Person or department responsible"><Input name="assignedTo" defaultValue={asset?.assignedTo ?? ""} /></Field>
      <Field label="Brand"><Input name="brand" defaultValue={asset?.brand ?? ""} /></Field>
      <Field label="Model"><Input name="model" defaultValue={asset?.model ?? ""} /></Field>
      <Field label="Serial no"><Input name="serialNo" defaultValue={asset?.serialNo ?? ""} /></Field>
      <Field label="Supplier"><Input name="supplierName" defaultValue={asset?.supplierName ?? ""} /></Field>
      <Field label="Invoice no"><Input name="invoiceNo" defaultValue={asset?.invoiceNo ?? ""} /></Field>
      <Field label="Purchase date"><Input name="purchaseDate" type="date" defaultValue={asset?.purchaseDate ? isoDate(asset.purchaseDate) : ""} /></Field>
      <Field label="Cost (₹)" required><Input name="cost" type="number" min={0} step="0.01" defaultValue={asset ? String(asset.cost) : ""} required /></Field>
      <Field label="Useful life (years)" required hint="Used for straight-line depreciation"><Input name="usefulLifeYears" type="number" min={1} max={50} defaultValue={asset?.usefulLifeYears ?? 5} required /></Field>
      <Field label="Salvage value (₹)" required hint="Value at the end of its life"><Input name="salvageValue" type="number" min={0} step="0.01" defaultValue={asset ? String(asset.salvageValue) : 0} required /></Field>
      <Field label="Warranty until"><Input name="warrantyUntil" type="date" defaultValue={asset?.warrantyUntil ? isoDate(asset.warrantyUntil) : ""} /></Field>
      {!asset && <Field label="Quantity" hint="Identical items get consecutive codes"><Input name="quantity" type="number" min={1} max={100} defaultValue={1} /></Field>}
      <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={asset?.notes ?? ""} rows={2} /></Field>
    </FormGrid>
  );
}

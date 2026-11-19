"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";

export type ItemOpt = { id: string; name: string; code: string; unit: string; currentStock: number; unitCost: number; category?: string };
export type Line = { itemId: string; qty: string; unitPrice?: string };

/**
 * Editable list of item lines. Submits as a hidden JSON input `name` (default "lines"):
 * [{ itemId, qty, unitPrice? }]. Put it inside an ActionForm / ModalForm.
 */
export function LinesEditor({ items, name = "lines", withPrice, showStock = true, initial, priceFor, qtyLabel = "Qty" }: {
  items: ItemOpt[];
  name?: string;
  withPrice?: boolean;
  showStock?: boolean;
  initial?: { itemId: string; qty: number; unitPrice?: number }[];
  /** Default price when an item is picked (e.g. supplier's last price). */
  priceFor?: Record<string, number>;
  qtyLabel?: string;
}) {
  const [lines, setLines] = useState<Line[]>(initial?.length ? initial.map((l) => ({ itemId: l.itemId, qty: String(l.qty), unitPrice: l.unitPrice !== undefined ? String(l.unitPrice) : undefined })) : [{ itemId: "", qty: "" }]);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const byId = new Map(items.map((i) => [i.id, i]));
  const payload = lines.filter((l) => l.itemId).map((l) => ({ itemId: l.itemId, qty: Number(l.qty || 0), ...(withPrice ? { unitPrice: Number(l.unitPrice || 0) } : {}) }));
  const total = withPrice ? payload.reduce((s, l) => s + l.qty * (l.unitPrice ?? 0), 0) : 0;
  const groups = [...new Set(items.map((i) => i.category ?? ""))];
  const cols = withPrice ? "sm:grid-cols-[minmax(0,1fr)_9.5rem_9rem_7rem_2.5rem]" : "sm:grid-cols-[minmax(0,1fr)_9.5rem_2.5rem]";
  const step = (i: number, by: number) => set(i, { qty: String(Math.max(1, (Number(lines[i].qty) || 0) + by)) });
  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={JSON.stringify(payload)} />
      <div className={`hidden gap-3 px-1 text-xs font-medium uppercase tracking-wide text-muted sm:grid ${cols}`}>
        <span>Item</span><span className="text-center">{qtyLabel}</span>
        {withPrice && <><span className="text-right">Unit price</span><span className="text-right">Amount</span></>}
        <span />
      </div>
      {lines.map((l, i) => {
        const it = byId.get(l.itemId);
        const over = showStock && it && Number(l.qty) > it.currentStock;
        const amount = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
        return (
          <div key={i} className={`grid grid-cols-2 items-start gap-3 rounded-xl border border-line p-3 sm:border-0 sm:p-0 ${cols}`}>
            <div className="col-span-2 sm:col-span-1">
              <Select aria-label="Item" value={l.itemId} placeholder="Choose item…"
                onChange={(e) => {
                  const id = e.target.value;
                  const p = priceFor?.[id] ?? byId.get(id)?.unitCost;
                  set(i, { itemId: id, ...(withPrice && !l.unitPrice ? { unitPrice: p !== undefined ? String(p) : "" } : {}) });
                }}>
                {groups.map((g) => {
                  const opts = items.filter((x) => (x.category ?? "") === g).map((x) => (
                    <option key={x.id} value={x.id} disabled={lines.some((o, j) => j !== i && o.itemId === x.id)}>
                      {x.name} ({x.code}){showStock ? ` · ${x.currentStock} ${x.unit}` : ""}
                    </option>
                  ));
                  return g ? <optgroup key={g} label={g}>{opts}</optgroup> : opts;
                })}
              </Select>
              {over && <p className="mt-0.5 text-xs text-rose-600">Only {it!.currentStock} {it!.unit} in stock</p>}
            </div>
            {/* Quantity: − / + stepper around a centred number, unit shown underneath */}
            <div>
              <span className="mb-1 block text-xs text-muted sm:hidden">{qtyLabel}</span>
              <div className="flex h-10 items-stretch overflow-hidden rounded-xl border border-line bg-canvas focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-300/30">
                <button type="button" aria-label={`Less ${qtyLabel}`} onClick={() => step(i, -1)} disabled={(Number(l.qty) || 0) <= 1}
                  className="w-9 shrink-0 text-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40">−</button>
                <input type="number" min={1} step={1} inputMode="numeric" aria-label={qtyLabel} placeholder="0" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })}
                  className="w-full min-w-0 border-x border-line bg-transparent text-center text-ink placeholder:text-muted/70 focus:outline-none" />
                <button type="button" aria-label={`More ${qtyLabel}`} onClick={() => step(i, 1)}
                  className="w-9 shrink-0 text-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink">+</button>
              </div>
              {it && <span className="mt-0.5 block text-center text-xs text-muted">{it.unit}</span>}
            </div>
            {withPrice && (
              <div>
                <span className="mb-1 block text-xs text-muted sm:hidden">Unit price</span>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">₹</span>
                  <Input type="number" min={0} step="0.01" inputMode="decimal" aria-label="Unit price" placeholder="0.00" value={l.unitPrice ?? ""}
                    onChange={(e) => set(i, { unitPrice: e.target.value })} className="pl-7 text-right" />
                </div>
              </div>
            )}
            {withPrice && (
              <div className="flex h-10 items-center justify-end self-end text-right font-medium tabular-nums sm:self-start">
                <span className="mr-2 text-xs font-normal text-muted sm:hidden">Amount</span>₹{amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
            <div className={`flex justify-end sm:block ${withPrice ? "" : "self-end sm:self-start"}`}>
              <Button type="button" variant="ghost" size="sm" aria-label="Remove line" className="h-10" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ itemId: "", qty: "" }]))}><Trash2 className="size-4" /></Button>
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, { itemId: "", qty: "" }])}><Plus className="size-4" />Add item</Button>
        {withPrice && <span className="text-sm text-slate-600">Total: <b>₹{total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</b></span>}
      </div>
    </div>
  );
}

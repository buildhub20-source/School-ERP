"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Shirt, Trash2, Sparkles } from "lucide-react";
import { Button, Select, Input, Textarea, Field, Badge } from "@/components/ui";
import { useAction } from "@/components/ui/client";
import type { ActionResult } from "@/lib/action";
import type { OrderBuilderData } from "@/server/uniforms/queries";
import { CATEGORY_LABELS } from "@/server/uniforms/labels";
import { useT } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/dict";

type Line = { key: number; itemId: string; variantId: string; qty: number };
const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

export function OrderBuilder({ data, studentId, isPreOrder, showStock, action, redirectTo, submitLabel }: {
  data: OrderBuilderData;
  studentId: string;
  isPreOrder: boolean;
  showStock: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: (input: any) => Promise<ActionResult<{ id: string; orderNo: string }>>;
  /** Where to go after placing the order; "[id]" is replaced with the new order id. */
  redirectTo: string;
  submitLabel: string;
}) {
  const router = useRouter();
  const t = useT();
  const [lines, setLines] = useState<Line[]>([]);
  const [seq, setSeq] = useState(1);
  const [pickItem, setPickItem] = useState("");
  const [notes, setNotes] = useState("");
  const items = useMemo(() => new Map(data.catalog.map((i) => [i.id, i])), [data.catalog]);
  const { run, pending } = useAction(action, { successMessage: (d) => fill(t("uorder.placed"), { no: d.orderNo }), onSuccess: (d) => router.push(redirectTo.replace("[id]", d.id)) });

  const defaultVariant = (itemId: string) => {
    const it = items.get(itemId);
    if (!it) return "";
    const s = data.suggestions[itemId];
    if (s && it.variants.some((v) => v.id === s.variantId)) return s.variantId;
    return it.variants.length === 1 ? it.variants[0].id : "";
  };
  const addLines = (add: { itemId: string; qty: number }[]) => {
    let n = seq;
    const next = [...lines];
    for (const a of add) {
      if (!items.has(a.itemId)) continue;
      if (next.some((l) => l.itemId === a.itemId)) continue; // already in the order
      next.push({ key: n++, itemId: a.itemId, variantId: defaultVariant(a.itemId), qty: a.qty });
    }
    setSeq(n);
    setLines(next);
  };
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const priceOf = (l: Line) => items.get(l.itemId)?.variants.find((v) => v.id === l.variantId)?.price ?? 0;
  const total = lines.reduce((s, l) => s + priceOf(l) * l.qty, 0);
  const missing = lines.some((l) => !l.variantId);
  const setMissing = data.set ? data.set.items.filter((x) => !items.has(x.itemId)).length : 0;

  const submit = () => {
    if (!lines.length || missing) return;
    run({ studentId, isPreOrder: isPreOrder ? "true" : "false", notes, lines: JSON.stringify(lines.map((l) => ({ variantId: l.variantId, qty: l.qty }))) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        {data.set ? (
          <Button type="button" variant="primary" onClick={() => addLines(data.set!.items)}><Shirt className="size-4" />{fill(t("uorder.addSet"), { name: data.set.name })}</Button>
        ) : <p className="text-sm text-slate-500">{t("uorder.noSet")}</p>}
        <div className="flex min-w-0 flex-1 flex-wrap gap-2 sm:flex-none">
          <Select value={pickItem} onChange={(e) => setPickItem(e.target.value)} placeholder={t("uorder.addItem")} className="min-w-0 flex-1 sm:w-64">
            {data.catalog.map((i) => <option key={i.id} value={i.id}>{i.name} ({CATEGORY_LABELS[i.category as keyof typeof CATEGORY_LABELS]})</option>)}
          </Select>
          <Button type="button" variant="secondary" disabled={!pickItem} onClick={() => { addLines([{ itemId: pickItem, qty: 1 }]); setPickItem(""); }}><Plus className="size-4" />{t("uorder.add")}</Button>
        </div>
      </div>
      {setMissing > 0 && <p className="text-xs text-amber-700">{fill(t("uorder.setSkipped"), { n: setMissing })}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2 text-left">{t("uorder.item")}</th><th className="px-3 py-2 text-left">{t("uorder.size")}</th><th className="px-3 py-2 text-left">{t("uorder.qty")}</th><th className="px-3 py-2 text-right">{t("uorder.amount")}</th><th /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">{t("uorder.noItems")}</td></tr>}
            {lines.map((l) => {
              const it = items.get(l.itemId)!;
              const v = it.variants.find((x) => x.id === l.variantId);
              const sug = data.suggestions[l.itemId];
              return (
                <tr key={l.key} className="align-top">
                  <td className="px-3 py-2 font-medium text-slate-900">{it.name}
                    {sug && <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-brand-700"><Sparkles className="size-3" />{fill(t("uorder.suggested"), { size: sug.size })}{sug.movedUp ? fill(t("uorder.last"), { size: sug.lastSize ?? "" }) : ""}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Select value={l.variantId} onChange={(e) => update(l.key, { variantId: e.target.value })} placeholder={t("uorder.chooseSize")} className={`w-36 ${!l.variantId ? "border-amber-400" : ""}`} aria-label={fill(t("uorder.sizeFor"), { name: it.name })}>
                      {it.variants.map((x) => <option key={x.id} value={x.id}>{x.size}{showStock ? fill(t("uorder.inStock"), { n: x.stock }) : x.stock <= 0 ? t("uorder.onOrder") : ""}</option>)}
                    </Select>
                    {v && showStock && v.stock < l.qty && <p className="mt-1 text-xs text-amber-700">{fill(t("uorder.onlyInStock"), { n: v.stock })}</p>}
                  </td>
                  <td className="px-3 py-2"><Input type="number" min={1} max={50} value={l.qty} onChange={(e) => update(l.key, { qty: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} className="w-20" aria-label={t("uorder.quantity")} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{v ? inr(v.price * l.qty) : "—"}</td>
                  <td className="px-2 py-2 text-right"><button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={t("uorder.remove")}><Trash2 className="size-4" /></button></td>
                </tr>
              );
            })}
          </tbody>
          {lines.length > 0 && <tfoot className="bg-slate-50"><tr><td colSpan={3} className="px-3 py-2 text-right font-semibold">{t("uorder.total")}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{inr(total)}</td><td /></tr></tfoot>}
        </table>
      </div>
      <Field label={t("uorder.notes")}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder={t("uorder.optional")} /></Field>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {isPreOrder && <Badge tone="purple">{fill(t("uorder.preOrderFor"), { year: data.year.name })}</Badge>}
        {missing && <span className="text-xs text-amber-700">{t("uorder.chooseEvery")}</span>}
        <Button type="button" onClick={submit} loading={pending} disabled={!lines.length || missing}>{submitLabel}</Button>
      </div>
    </div>
  );
}

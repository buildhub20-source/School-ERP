"use client";
import { useState } from "react";
import { ActionForm } from "@/components/ui/client";
import { Badge, Card, CardHeader, Checkbox, Field, Input } from "@/components/ui";
import { runPromotion } from "./actions";

type Row = { classId: string; className: string; target: { id: string; name: string } | null; students: { id: string; name: string; admissionNo: string; section: string; dues: number }[] };

export function PromotionForm({ rows, hasNextStructure, nextName }: { rows: Row[]; hasNextStructure: boolean; nextName: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [result, setResult] = useState<{ promoted: number; graduated: number; detained: number; structuresCopied: number; allocations: number; year: string } | null>(null);
  if (result) return (
    <Card className="p-6 text-sm">
      <p className="text-base font-semibold text-emerald-700">{result.year} has started.</p>
      <p className="mt-2">{result.promoted} promoted · {result.graduated} graduated · {result.detained} stayed in the same class · {result.structuresCopied} fee structure lines copied · {result.allocations} bus allocations carried forward.</p>
      <p className="mt-2 text-slate-500">Next: review the fee structure for {result.year}; dues are generated automatically when each term starts.</p>
    </Card>
  );
  return (
    <ActionForm action={runPromotion} submitLabel={`Close year and start ${nextName}`} submitVariant="danger" successMessage="Academic year closed" onSuccess={setResult}>
      <Card>
        <CardHeader title="Classes" description="Open a class to choose students who stay back." />
        <div className="divide-y divide-slate-100">
          {rows.filter((r) => r.students.length).map((r) => (
            <div key={r.classId}>
              <button type="button" onClick={() => setOpen(open === r.classId ? null : r.classId)} className="flex w-full flex-wrap items-center justify-between gap-2 px-5 py-3 text-left text-sm hover:bg-slate-50">
                <span className="font-medium">{r.className} <span className="font-normal text-slate-500">→ {r.target ? r.target.name : "Graduate"}</span></span>
                <span className="flex items-center gap-2 text-xs text-slate-500">{r.students.length} students{r.students.some((s) => s.dues > 0) && <Badge tone="red">{r.students.filter((s) => s.dues > 0).length} with dues</Badge>}</span>
              </button>
              <div className={open === r.classId ? "grid gap-1 bg-slate-50/60 px-5 pb-3 sm:grid-cols-2 lg:grid-cols-3" : "hidden"}>
                {r.students.map((s) => (
                  <Checkbox key={s.id} name="detainIds[]" value={s.id} label={<span>{s.name} <span className="text-xs text-slate-500">{s.admissionNo}{s.section && ` · ${s.section}`}</span>{s.dues > 0 && <span className="ml-1 text-xs text-rose-600">₹{s.dues.toLocaleString("en-IN")} due</span>} <span className="text-xs text-amber-700">(stay back)</span></span>} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card className="space-y-3 p-5">
        <Checkbox name="copyFeeStructure" defaultChecked={!hasNextStructure} disabled={hasNextStructure} label={hasNextStructure ? `${nextName} already has a fee structure` : `Copy this year's fee structure to ${nextName} (review amounts afterwards)`} />
        <Checkbox name="carryTransport" defaultChecked label="Carry forward bus allocations (transport fees are added for the new year)" />
        <Checkbox name="openPreorders" defaultChecked label="Open uniform pre-orders and send parents the suggested sizes" />
        <Field label='Type "CLOSE" to confirm' required><Input name="confirm" required autoComplete="off" className="max-w-40" /></Field>
      </Card>
    </ActionForm>
  );
}

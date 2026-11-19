"use client";
import { useMemo, useState } from "react";
import { ModalForm, ActionButton, useAction } from "@/components/ui/client";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { ClipboardCheck } from "lucide-react";
import { startAuditAction, saveCountsAction, completeAuditAction, cancelAuditAction } from "../actions";

export function StartAuditButton({ categories }: { categories: string[] }) {
  return (
    <ModalForm trigger="Start a count" icon={<ClipboardCheck className="size-4" />} title="Start a stock audit" description="Takes a snapshot of the system stock now. Enter the physical counts, then complete." action={startAuditAction}
      submitLabel="Start" successMessage="Audit started" redirectTo={(d: { id: string }) => `/stationery/audits/${d.id}`}>
      <Field label="Items to count"><Select name="category"><option value="">All active items</option>{categories.map((c) => <option key={c} value={c}>{c} only</option>)}</Select></Field>
      <Field label="Notes"><Textarea name="notes" rows={2} maxLength={500} placeholder="e.g. Term-end count, main store" /></Field>
    </ModalForm>
  );
}

type Line = { id: string; name: string; code: string; category: string; unit: string; systemQty: number; countedQty: number | null; note: string | null; unitCost: number };

/** Count sheet: enter counted quantities; differences are highlighted as you type. */
export function CountSheet({ id, lines, editable }: { id: string; lines: Line[]; editable: boolean }) {
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, l.countedQty === null ? "" : String(l.countedQty)])));
  const [notes, setNotes] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, l.note ?? ""])));
  const [filter, setFilter] = useState<"all" | "diff" | "uncounted">("all");
  const [q, setQ] = useState("");
  const save = useAction(saveCountsAction, { successMessage: "Counts saved" });
  const payload = () => ({ id, counts: JSON.stringify(lines.map((l) => ({ lineId: l.id, countedQty: vals[l.id] === "" ? null : Number(vals[l.id]), note: notes[l.id] || undefined }))) });
  const stats = useMemo(() => {
    let counted = 0, diffs = 0, value = 0;
    for (const l of lines) {
      if (vals[l.id] === "") continue;
      counted++;
      const d = Number(vals[l.id]) - l.systemQty;
      if (d !== 0) { diffs++; value += d * l.unitCost; }
    }
    return { counted, diffs, value };
  }, [vals, lines]);
  const shown = lines.filter((l) => {
    if (q && !`${l.name} ${l.code}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "uncounted") return vals[l.id] === "";
    if (filter === "diff") return vals[l.id] !== "" && Number(vals[l.id]) !== l.systemQty;
    return true;
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="search" placeholder="Find item or code" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-auto">
          <option value="all">All lines</option><option value="diff">Differences only</option><option value="uncounted">Not counted yet</option>
        </Select>
        <span className="text-sm text-slate-600">Counted {stats.counted}/{lines.length} · <b className={stats.diffs ? "text-amber-700" : ""}>{stats.diffs} difference{stats.diffs === 1 ? "" : "s"}</b> · value {stats.value >= 0 ? "+" : "−"}₹{Math.abs(stats.value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-right">System</th><th className="px-3 py-2 text-right">Counted</th><th className="px-3 py-2 text-right">Difference</th><th className="px-3 py-2 text-left">Note</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">No lines.</td></tr>}
            {shown.map((l) => {
              const has = vals[l.id] !== "";
              const d = has ? Number(vals[l.id]) - l.systemQty : 0;
              return (
                <tr key={l.id} className={has && d < 0 ? "bg-rose-50" : has && d > 0 ? "bg-amber-50" : ""}>
                  <td className="px-3 py-2"><span className="font-medium text-slate-900">{l.name}</span><span className="block font-mono text-xs text-slate-500">{l.code} · {l.category}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{l.systemQty} {l.unit}</td>
                  <td className="px-3 py-2 text-right">
                    {editable
                      ? <Input type="number" min={0} step={1} inputMode="numeric" value={vals[l.id]} onChange={(e) => setVals({ ...vals, [l.id]: e.target.value })} className="ml-auto w-24 text-right" aria-label={`Counted ${l.name}`} />
                      : <span className="tabular-nums">{l.countedQty ?? "—"}</span>}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${d < 0 ? "text-rose-700" : d > 0 ? "text-amber-700" : "text-slate-400"}`}>{has ? (d > 0 ? `+${d}` : d) : "—"}</td>
                  <td className="px-3 py-2">{editable ? <Input value={notes[l.id]} onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })} maxLength={300} className="min-w-40" aria-label={`Note for ${l.name}`} /> : l.note ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="flex flex-wrap justify-end gap-2">
          <ActionButton action={cancelAuditAction} args={{ id }} confirm="Cancel this audit? No stock will change." variant="danger" size="md" successMessage="Audit cancelled">Cancel audit</ActionButton>
          <Button variant="secondary" loading={save.pending} onClick={() => save.run(payload())}>Save counts</Button>
          <CompleteButton id={id} save={() => save.run(payload())} diffs={stats.diffs} />
        </div>
      )}
    </div>
  );
}

function CompleteButton({ id, save, diffs }: { id: string; save: () => Promise<{ ok: boolean }>; diffs: number }) {
  const done = useAction(completeAuditAction, { successMessage: (d: { adjusted: number; counted: number }) => `Audit completed: ${d.adjusted} adjustment(s) posted for ${d.counted} counted item(s).` });
  const [pending, setPending] = useState(false);
  return (
    <Button loading={pending || done.pending} onClick={async () => {
      if (!confirm(`Complete the audit? ${diffs} difference(s) will be posted as stock adjustments. This cannot be undone.`)) return;
      setPending(true);
      const r = await save();
      setPending(false);
      if (r.ok) await done.run({ id });
    }}>Complete & post adjustments</Button>
  );
}

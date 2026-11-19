"use client";
import { useState } from "react";
import { ModalForm } from "@/components/ui/client";
import { Field, FormGrid, Input, Select, Textarea, Checkbox } from "@/components/ui";
import { Plus, Pencil, PackageCheck } from "lucide-react";
import { saveKitAction, issueKitAction } from "../actions";
import { LinesEditor, type ItemOpt } from "../_components/lines-editor";

type ClassOpt = { id: string; name: string; sections: { id: string; name: string }[] };

export function KitFormButton({ items, classes, kit }: { items: ItemOpt[]; classes: ClassOpt[]; kit?: { id: string; name: string; classId: string; isActive: boolean; lines: { itemId: string; qty: number }[] } }) {
  return (
    <ModalForm trigger={kit ? "Edit kit" : "New kit"} icon={kit ? <Pencil className="size-4" /> : <Plus className="size-4" />} triggerVariant={kit ? "secondary" : "primary"} triggerSize={kit ? "sm" : "md"}
      title={kit ? `Edit ${kit.name}` : "New class kit"} description="Quantities are per student." action={saveKitAction} extra={{ id: kit?.id }} size="lg" successMessage="Kit saved">
      <FormGrid>
        <Field label="Kit name" required><Input name="name" defaultValue={kit?.name} required maxLength={120} placeholder="e.g. Class 5 kit 2026-27" /></Field>
        <Field label="Class" required><Select name="classId" defaultValue={kit?.classId ?? ""} required placeholder="Choose class…">{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      </FormGrid>
      <Field label="Items per student" required><LinesEditor items={items} showStock={false} initial={kit?.lines} qtyLabel="Per student" /></Field>
      {kit && <Checkbox name="isActive" value="true" defaultChecked={kit.isActive} label="Active" />}
    </ModalForm>
  );
}

/** Issue a kit to a whole class or one section. The server checks every item's stock before deducting anything. */
export function IssueKitButton({ kit, sections, counts, lines }: {
  kit: { id: string; name: string; className: string };
  sections: { id: string; name: string }[];
  /** active students: key "" = whole class, else sectionId */
  counts: Record<string, number>;
  lines: { name: string; perStudent: number; stock: number; unit: string }[];
}) {
  const [sectionId, setSectionId] = useState("");
  const [override, setOverride] = useState("");
  const n = override ? Number(override) : counts[sectionId] ?? 0;
  const short = lines.filter((l) => l.perStudent * n > l.stock);
  return (
    <ModalForm trigger="Issue to class" icon={<PackageCheck className="size-4" />} triggerSize="sm" title={`Issue ${kit.name}`} description={`One step for the whole of ${kit.className} or one section.`}
      action={issueKitAction} extra={{ kitId: kit.id }} submitLabel={`Issue to ${n} student${n === 1 ? "" : "s"}`} successMessage={(d: { studentCount: number }) => `Kit issued to ${d.studentCount} students. Stock deducted.`} size="lg">
      <FormGrid>
        <Field label="Section">
          <Select name="sectionId" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
            <option value="">Whole class ({counts[""] ?? 0} students)</option>
            {sections.map((s) => <option key={s.id} value={s.id}>Section {s.name} ({counts[s.id] ?? 0} students)</option>)}
          </Select>
        </Field>
        <Field label="Number of students" hint="Leave blank to use the active students count."><Input name="studentCount" type="number" min={1} step={1} value={override} onChange={(e) => setOverride(e.target.value)} placeholder={String(counts[sectionId] ?? 0)} /></Field>
      </FormGrid>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2 text-left">Item</th><th className="px-3 py-2 text-right">Per student</th><th className="px-3 py-2 text-right">Needed</th><th className="px-3 py-2 text-right">In stock</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l) => {
              const need = l.perStudent * n;
              return (
                <tr key={l.name} className={need > l.stock ? "bg-rose-50" : ""}>
                  <td className="px-3 py-2">{l.name}</td><td className="px-3 py-2 text-right">{l.perStudent}</td>
                  <td className="px-3 py-2 text-right font-medium">{need}</td><td className={`px-3 py-2 text-right ${need > l.stock ? "font-semibold text-rose-700" : ""}`}>{l.stock} {l.unit}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {short.length > 0 && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">Not enough stock for {short.map((s) => s.name).join(", ")}. The issue will be refused and nothing deducted.</p>}
      <Field label="Note"><Textarea name="note" rows={2} maxLength={300} /></Field>
    </ModalForm>
  );
}

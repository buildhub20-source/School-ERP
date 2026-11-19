"use client";
import { useState } from "react";
import { ModalForm, useAction } from "@/components/ui/client";
import { Button, Field, FormGrid, Input } from "@/components/ui";
import { Plus, Trash2 } from "lucide-react";
import { saveAcademicYear, saveClass, saveDepartment, setClassTeacher } from "../actions";

type Term = { name: string; startDate: string; endDate: string };

export function YearForm({ initial }: { initial?: { id: string; name: string; startDate: string; endDate: string; terms: Term[] } }) {
  const [terms, setTerms] = useState<Term[]>(initial?.terms ?? [{ name: "Term 1", startDate: "", endDate: "" }, { name: "Term 2", startDate: "", endDate: "" }, { name: "Term 3", startDate: "", endDate: "" }]);
  const set = (i: number, k: keyof Term, v: string) => setTerms((t) => t.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <ModalForm trigger={initial ? "Edit" : "Add year"} triggerVariant={initial ? "ghost" : "primary"} triggerSize="sm" title={initial ? `Edit ${initial.name}` : "Add academic year"} size="lg"
      action={saveAcademicYear} extra={{ id: initial?.id, terms: JSON.stringify(terms) }} successMessage="Academic year saved">
      <FormGrid cols={3}>
        <Field label="Name" hint="e.g. 2027-28" required><Input name="name" defaultValue={initial?.name} required /></Field>
        <Field label="Starts" required><Input type="date" name="startDate" defaultValue={initial?.startDate} required /></Field>
        <Field label="Ends" required><Input type="date" name="endDate" defaultValue={initial?.endDate} required /></Field>
      </FormGrid>
      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">Terms</p>
        {terms.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
            <Input value={t.name} onChange={(e) => set(i, "name", e.target.value)} aria-label="Term name" />
            <Input type="date" value={t.startDate} onChange={(e) => set(i, "startDate", e.target.value)} aria-label="Term start" />
            <Input type="date" value={t.endDate} onChange={(e) => set(i, "endDate", e.target.value)} aria-label="Term end" />
            <Button type="button" variant="ghost" size="sm" onClick={() => setTerms((x) => x.filter((_, j) => j !== i))} disabled={terms.length === 1} aria-label="Remove term"><Trash2 className="size-4" /></Button>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" onClick={() => setTerms((x) => [...x, { name: `Term ${x.length + 1}`, startDate: "", endDate: "" }])}><Plus className="size-4" />Add term</Button>
      </div>
    </ModalForm>
  );
}

export function ClassForm({ initial }: { initial?: { id: string; name: string; grade: number; sections: string } }) {
  return (
    <ModalForm trigger={initial ? "Edit" : "Add class"} triggerVariant={initial ? "ghost" : "primary"} triggerSize="sm" title={initial ? `Edit ${initial.name}` : "Add class"} action={saveClass} extra={{ id: initial?.id }} successMessage="Class saved">
      <FormGrid cols={2}>
        <Field label="Class name" required><Input name="name" defaultValue={initial?.name} placeholder="Class 6" required /></Field>
        <Field label="Grade (order)" hint="LKG = -1, UKG = 0, Class 1 = 1 …" required><Input type="number" name="grade" defaultValue={initial?.grade} required /></Field>
        <Field label="Sections" hint="Comma separated, e.g. A, B, C" className="sm:col-span-2"><Input name="sections" defaultValue={initial?.sections ?? "A"} /></Field>
      </FormGrid>
    </ModalForm>
  );
}

export function DepartmentForm({ initial }: { initial?: { id: string; name: string } }) {
  return (
    <ModalForm trigger={initial ? "Rename" : "Add department"} triggerVariant={initial ? "ghost" : "primary"} triggerSize="sm" title={initial ? "Rename department" : "Add department"} action={saveDepartment} extra={{ id: initial?.id }} successMessage="Department saved" size="sm">
      <Field label="Name" required><Input name="name" defaultValue={initial?.name} required /></Field>
    </ModalForm>
  );
}

export function ClassTeacherSelect({ sectionId, value, teachers }: { sectionId: string; value: string; teachers: { id: string; name: string }[] }) {
  const { run, pending } = useAction(setClassTeacher, { successMessage: "Class teacher updated" });
  return (
    <select defaultValue={value} disabled={pending} onChange={(e) => run({ sectionId, teacherId: e.target.value })} className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs" aria-label="Class teacher">
      <option value="">No class teacher</option>
      {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </select>
  );
}

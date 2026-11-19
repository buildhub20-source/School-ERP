"use client";
import { useState } from "react";
import { ActionForm } from "@/components/ui/client";
import { Button, Card, CardBody, CardHeader, Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import { Plus, Trash2 } from "lucide-react";
import { saveStudent } from "./actions";

type ClassOpt = { id: string; name: string; sections: { id: string; name: string }[] };
type Guardian = { relation: string; name: string; phone: string; email?: string | null; occupation?: string | null };
export type StudentFormValues = {
  id?: string; admissionNo?: string; firstName?: string; lastName?: string | null; gender?: string; dob?: string; bloodGroup?: string | null; classId?: string; sectionId?: string | null;
  rollNo?: string | null; admissionDate?: string; address?: string | null; medicalNotes?: string | null; emergencyPhone?: string | null; isStaffChild?: boolean; staffUserId?: string | null; photoUrl?: string | null;
  guardians?: Guardian[];
};

const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

export function StudentForm({ classes, staff, initial }: { classes: ClassOpt[]; staff: { id: string; name: string }[]; initial?: StudentFormValues }) {
  const [classId, setClassId] = useState(initial?.classId ?? "");
  const [staffChild, setStaffChild] = useState(!!initial?.isStaffChild);
  const [guardians, setGuardians] = useState<Guardian[]>(initial?.guardians?.length ? initial.guardians : [{ relation: "Father", name: "", phone: "" }, { relation: "Mother", name: "", phone: "" }]);
  const sections = classes.find((c) => c.id === classId)?.sections ?? [];
  const valid = guardians.filter((g) => g.name.trim() || g.phone.trim());
  const set = (i: number, k: keyof Guardian, v: string) => setGuardians((gs) => gs.map((g, j) => (j === i ? { ...g, [k]: v } : g)));

  return (
    <ActionForm action={saveStudent} submitLabel={initial?.id ? "Save changes" : "Add student"} successMessage="Student saved"
      extra={{ id: initial?.id, guardians: JSON.stringify(valid) }} redirectTo={(d) => `/students/${d.id}`}>
      <Card>
        <CardHeader title="Student details" />
        <CardBody>
          <FormGrid cols={3}>
            <Field label="First name" required><Input name="firstName" defaultValue={initial?.firstName} required /></Field>
            <Field label="Last name"><Input name="lastName" defaultValue={initial?.lastName ?? ""} /></Field>
            <Field label="Admission no" hint="Leave blank to generate automatically"><Input name="admissionNo" defaultValue={initial?.admissionNo} /></Field>
            <Field label="Gender" required><Select name="gender" defaultValue={initial?.gender ?? ""} required placeholder="Select"><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></Select></Field>
            <Field label="Date of birth"><Input type="date" name="dob" defaultValue={initial?.dob} /></Field>
            <Field label="Blood group"><Select name="bloodGroup" defaultValue={initial?.bloodGroup ?? ""} placeholder="—">{BLOOD.map((b) => <option key={b}>{b}</option>)}</Select></Field>
            <Field label="Class" required><Select name="classId" value={classId} onChange={(e) => setClassId(e.target.value)} required placeholder="Select class">{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Section"><Select name="sectionId" defaultValue={initial?.sectionId ?? ""} key={classId} placeholder="—">{sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Roll no"><Input name="rollNo" defaultValue={initial?.rollNo ?? ""} /></Field>
            <Field label="Admission date"><Input type="date" name="admissionDate" defaultValue={initial?.admissionDate} /></Field>
            <Field label="Emergency phone"><Input name="emergencyPhone" inputMode="tel" defaultValue={initial?.emergencyPhone ?? ""} /></Field>
            <Field label="Photo" hint="JPG/PNG, up to 3 MB"><Input type="file" name="photo" accept="image/jpeg,image/png,image/webp" className="h-auto py-1.5" /></Field>
            <Field label="Address" className="sm:col-span-2 lg:col-span-3"><Textarea name="address" defaultValue={initial?.address ?? ""} rows={2} /></Field>
            <Field label="Medical notes" hint="Allergies, conditions — shown on the bus emergency sheet" className="sm:col-span-2 lg:col-span-3"><Textarea name="medicalNotes" defaultValue={initial?.medicalNotes ?? ""} rows={2} /></Field>
          </FormGrid>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Checkbox label="Child of a staff member" name="isStaffChild" checked={staffChild} onChange={(e) => setStaffChild(e.target.checked)} />
            {staffChild && <Select name="staffUserId" defaultValue={initial?.staffUserId ?? ""} className="max-w-xs" placeholder="Select staff member">{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Parents / guardians" description="Each mobile number gets a parent login (OTP). One login covers all their children."
          actions={<Button type="button" variant="secondary" size="sm" onClick={() => setGuardians((g) => [...g, { relation: "Guardian", name: "", phone: "" }])}><Plus className="size-4" />Add guardian</Button>} />
        <CardBody className="space-y-4">
          {guardians.map((g, i) => (
            <div key={i} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-100 p-3 sm:grid-cols-[120px_1fr_1fr_1fr_auto] sm:items-end">
              <Field label="Relation"><Select value={g.relation} onChange={(e) => set(i, "relation", e.target.value)}><option>Father</option><option>Mother</option><option>Guardian</option></Select></Field>
              <Field label="Name" required={i === 0}><Input value={g.name} aria-label={`Guardian ${i + 1} name`} onChange={(e) => set(i, "name", e.target.value)} /></Field>
              <Field label="Mobile" required={i === 0}><Input value={g.phone} inputMode="tel" aria-label={`Guardian ${i + 1} mobile`} onChange={(e) => set(i, "phone", e.target.value)} /></Field>
              <Field label="Email"><Input type="email" value={g.email ?? ""} onChange={(e) => set(i, "email", e.target.value)} /></Field>
              <Button type="button" variant="ghost" size="sm" onClick={() => setGuardians((gs) => gs.filter((_, j) => j !== i))} aria-label="Remove guardian" disabled={guardians.length === 1}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </CardBody>
      </Card>
    </ActionForm>
  );
}

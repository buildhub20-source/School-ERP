import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui";

export function HostelFields({ hostel }: { hostel?: { name: string; type: string; wardenName: string | null; phone: string | null; feePerTerm: unknown; notes: string | null } }) {
  return (
    <FormGrid cols={2}>
      <Field label="Name" required><Input name="name" defaultValue={hostel?.name} required placeholder="e.g. Boys Hostel A" /></Field>
      <Field label="For" required><Select name="type" defaultValue={hostel?.type ?? "BOYS"}><option value="BOYS">Boys</option><option value="GIRLS">Girls</option><option value="MIXED">Boys & girls</option></Select></Field>
      <Field label="Warden"><Input name="wardenName" defaultValue={hostel?.wardenName ?? ""} /></Field>
      <Field label="Warden phone"><Input name="phone" defaultValue={hostel?.phone ?? ""} inputMode="tel" /></Field>
      <Field label="Hostel fee per term (₹)" required hint="Rooms can override this"><Input name="feePerTerm" type="number" min={0} step="1" defaultValue={hostel ? String(hostel.feePerTerm) : 0} required /></Field>
      <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={hostel?.notes ?? ""} rows={2} /></Field>
    </FormGrid>
  );
}

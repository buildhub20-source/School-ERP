import type { StaffProfile } from "@prisma/client";
import { Field, FormGrid, Input, Select, Textarea, Checkbox } from "@/components/ui";
import { isoDate } from "@/lib/format";
import { CATEGORY_LABEL, EMPLOYMENT_LABEL } from "@/server/hr/service";

type Opt = { id: string; name: string };

/** Add / edit staff profile fields. `logins` are staff logins not yet linked to another profile. */
export function StaffFields({ staff, departments, logins }: { staff?: StaffProfile; departments: Opt[]; logins: Opt[] }) {
  return (
    <div className="space-y-5">
      <FormGrid cols={2}>
        <Field label="Full name" required><Input name="name" defaultValue={staff?.name} required maxLength={100} /></Field>
        <Field label="Designation" required hint="e.g. PG Assistant – Physics, Office Assistant"><Input name="designation" defaultValue={staff?.designation} required maxLength={80} /></Field>
        <Field label="Department">
          <Select name="departmentId" defaultValue={staff?.departmentId ?? ""} placeholder="None">{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        </Field>
        <Field label="Category" required>
          <Select name="category" defaultValue={staff?.category ?? "TEACHING"}>{Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field label="Employment" required>
          <Select name="employmentType" defaultValue={staff?.employmentType ?? "PERMANENT"}>{Object.entries(EMPLOYMENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </Field>
        <Field label="Joining date" required><Input name="joiningDate" type="date" defaultValue={staff ? isoDate(staff.joiningDate) : isoDate()} required /></Field>
        <Field label="Probation ends" hint="Only for staff on probation"><Input name="probationEndsOn" type="date" defaultValue={staff?.probationEndsOn ? isoDate(staff.probationEndsOn) : ""} /></Field>
        <Field label="Login account" hint="Links the profile to a login so they can apply for leave and check in">
          <Select name="userId" defaultValue={staff?.userId ?? ""} placeholder="No login">{logins.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
        </Field>
      </FormGrid>
      <FormGrid cols={3}>
        <Field label="Mobile"><Input name="phone" inputMode="tel" defaultValue={staff?.phone ?? ""} /></Field>
        <Field label="Email"><Input name="email" type="email" defaultValue={staff?.email ?? ""} /></Field>
        <Field label="Date of birth"><Input name="dob" type="date" defaultValue={staff?.dob ? isoDate(staff.dob) : ""} /></Field>
        <Field label="Gender">
          <Select name="gender" defaultValue={staff?.gender ?? ""} placeholder="—"><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></Select>
        </Field>
        <Field label="Blood group"><Input name="bloodGroup" defaultValue={staff?.bloodGroup ?? ""} maxLength={10} /></Field>
        <Field label="Experience before joining (years)"><Input name="priorExperienceYears" type="number" min={0} max={60} defaultValue={staff?.priorExperienceYears ?? ""} /></Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Qualifications" hint="e.g. M.Sc., B.Ed."><Input name="qualifications" defaultValue={staff?.qualifications ?? ""} maxLength={300} /></Field>
        <Field label="Subjects taught"><Input name="subjects" defaultValue={staff?.subjects ?? ""} maxLength={200} /></Field>
        <Field label="Emergency contact"><Input name="emergencyName" defaultValue={staff?.emergencyName ?? ""} maxLength={100} /></Field>
        <Field label="Emergency mobile"><Input name="emergencyPhone" inputMode="tel" defaultValue={staff?.emergencyPhone ?? ""} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea name="address" rows={2} defaultValue={staff?.address ?? ""} maxLength={500} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} defaultValue={staff?.notes ?? ""} maxLength={1000} /></Field>
      </FormGrid>
    </div>
  );
}

/** Leave application fields. `staff` shows a picker (office recording leave for someone); omit it for your own leave. */
export function LeaveFields({ types, staff, canApprove }: { types: { id: string; name: string; allowHalfDay: boolean; left: number | null }[]; staff?: Opt[]; canApprove?: boolean }) {
  const t = isoDate();
  return (
    <FormGrid cols={2}>
      {staff && (
        <Field label="Staff member" required className="sm:col-span-2">
          <Select name="staffId" required placeholder="Choose…">{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        </Field>
      )}
      <Field label="Leave type" required className="sm:col-span-2">
        <Select name="leaveTypeId" required placeholder="Choose…">
          {types.map((x) => <option key={x.id} value={x.id}>{x.name}{x.left !== null ? ` (${x.left} left)` : ""}</option>)}
        </Select>
      </Field>
      <Field label="From" required><Input name="fromDate" type="date" defaultValue={t} required /></Field>
      <Field label="To" hint="Leave empty for one day"><Input name="toDate" type="date" /></Field>
      <div className="sm:col-span-2"><Checkbox name="halfDay" value="true" label="Half day (from and to must be the same date)" /></div>
      <Field label="Reason" required className="sm:col-span-2"><Textarea name="reason" rows={2} required maxLength={500} /></Field>
      {canApprove && <div className="sm:col-span-2"><Checkbox name="approveNow" value="true" label="Record as approved (leave already agreed)" /></div>}
      <p className="text-xs text-muted sm:col-span-2">Holidays and weekly offs inside the dates are not counted.</p>
    </FormGrid>
  );
}

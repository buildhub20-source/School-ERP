"use client";
import { ActionForm } from "@/components/ui/client";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import type { Policies, SchoolProfile } from "@/lib/settings";
import { savePolicies, saveSchoolProfile } from "./actions";

const STAFF_ROLES = [
  { key: "SUPER_ADMIN", name: "Super Admin" }, { key: "SCHOOL_ADMIN", name: "School Admin" }, { key: "ACCOUNTANT", name: "Accountant" },
  { key: "STORE_MANAGER", name: "Store Manager" }, { key: "TRANSPORT_MANAGER", name: "Transport Manager" }, { key: "LIBRARIAN", name: "Librarian" },
  { key: "HOSTEL_WARDEN", name: "Hostel Warden" }, { key: "TEACHER", name: "Teacher" },
];

export function SchoolProfileForm({ school }: { school: SchoolProfile }) {
  return (
    <ActionForm action={saveSchoolProfile} successMessage="School profile saved">
      <FormGrid cols={2}>
        <Field label="School name" required><Input name="name" defaultValue={school.name} required /></Field>
        <Field label="Tagline / motto"><Input name="tagline" defaultValue={school.tagline} /></Field>
        <Field label="Affiliation / board" className="sm:col-span-2"><Input name="affiliation" defaultValue={school.affiliation} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea name="address" defaultValue={school.address} rows={2} /></Field>
        <Field label="Phone"><Input name="phone" defaultValue={school.phone} /></Field>
        <Field label="Email"><Input type="email" name="email" defaultValue={school.email} /></Field>
        <Field label="Website"><Input name="website" defaultValue={school.website} /></Field>
        <Field label="Logo" hint="PNG/JPG up to 2 MB, shown on the letterhead">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {school.logoUrl && <img src={school.logoUrl} alt="" className="size-10 rounded object-contain" />}
            <Input type="file" name="logo" accept="image/png,image/jpeg,image/webp" className="h-auto py-1.5" />
          </div>
          {school.logoUrl && <Checkbox name="removeLogo" label="Remove current logo" className="mt-1" />}
        </Field>
        <Field label="Principal name"><Input name="principalName" defaultValue={school.principalName} /></Field>
        <Field label="Principal email" hint="Receives the daily collection summary and the weekly / month-end reports"><Input type="email" name="principalEmail" defaultValue={school.principalEmail} /></Field>
      </FormGrid>
    </ActionForm>
  );
}

export function PoliciesForm({ p }: { p: Policies }) {
  return (
    <ActionForm action={savePolicies} successMessage="Policies saved" className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Security</h3>
        <FormGrid cols={3}>
          <Field label="Sign out after inactivity (minutes)"><Input type="number" name="idleLogoutMinutes" defaultValue={p.idleLogoutMinutes} min={5} max={480} /></Field>
          <Field label="Maximum session length (days)"><Input type="number" name="sessionDays" defaultValue={p.sessionDays} min={1} max={60} /></Field>
        </FormGrid>
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-slate-700">Two-step login is mandatory for</p>
          <div className="flex flex-wrap gap-4">
            {STAFF_ROLES.map((r) => <Checkbox key={r.key} name="requireTwoFactorRoles[]" value={r.key} label={r.name} defaultChecked={p.requireTwoFactorRoles?.includes(r.key)} />)}
          </div>
          <p className="mt-1 text-xs text-slate-500">Users in these roles must set up an authenticator app before they can use anything else.</p>
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Fees</h3>
        <FormGrid cols={3}>
          <Field label="Defaulter after (days overdue)"><Input type="number" name="defaulterDays" defaultValue={p.defaulterDays} min={0} /></Field>
          <Field label="Receipt prefix"><Input name="receiptPrefix" defaultValue={p.receiptPrefix} /></Field>
          <div />
          <Field label="Sibling discount (%)" hint="Suggested when requesting a sibling concession"><Input type="number" step="0.01" name="siblingDiscountPercent" defaultValue={p.siblingDiscountPercent} /></Field>
          <Field label="Staff-child concession (%)"><Input type="number" step="0.01" name="staffChildDiscountPercent" defaultValue={p.staffChildDiscountPercent} /></Field>
        </FormGrid>
        <div className="mt-4 rounded-lg border border-slate-200 p-4">
          <Checkbox name="lateFeeEnabled" label="Add a late fee automatically after the due date" defaultChecked={p.lateFee.enabled} />
          <FormGrid cols={4} className="mt-3">
            <Field label="Late fee type"><Select name="lateFeeType" defaultValue={p.lateFee.type}><option value="FIXED">Fixed amount</option><option value="PER_DAY">Per day overdue</option><option value="PERCENT">Percent of balance</option></Select></Field>
            <Field label="Amount / % / per day"><Input type="number" step="0.01" name="lateFeeAmount" defaultValue={p.lateFee.amount} /></Field>
            <Field label="Grace days"><Input type="number" name="lateFeeGraceDays" defaultValue={p.lateFee.graceDays} /></Field>
            <Field label="Maximum late fee (₹)"><Input type="number" step="0.01" name="lateFeeMax" defaultValue={p.lateFee.maxAmount} /></Field>
          </FormGrid>
        </div>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Transport</h3>
        <FormGrid cols={3}>
          <Field label="When a bus is full"><Select name="capacityPolicy" defaultValue={p.capacityPolicy}><option value="BLOCK">Block the allocation</option><option value="WARN">Warn and allow override</option></Select></Field>
          <Field label="Transport fee set by"><Select name="transportFeeMode" defaultValue={p.transportFeeMode}><option value="STOP">Stop</option><option value="DISTANCE">Distance slabs</option></Select></Field>
          <Field label="Transport fee charged"><Select name="transportFeeBasis" defaultValue={p.transportFeeBasis}><option value="TERM">Every term</option><option value="ANNUAL">Once a year</option></Select></Field>
          <Field label="'Bus near stop' distance (metres)"><Input type="number" name="gpsNearStopMeters" defaultValue={p.gpsNearStopMeters} /></Field>
        </FormGrid>
      </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Uniforms</h3>
        <FormGrid cols={3}>
          <Field label="Suggest next size at new year (steps up)" hint="0 = suggest the same size"><Input type="number" name="sizeGrowthSteps" defaultValue={p.sizeGrowthSteps} min={0} max={3} /></Field>
        </FormGrid>
      </section>
    </ActionForm>
  );
}

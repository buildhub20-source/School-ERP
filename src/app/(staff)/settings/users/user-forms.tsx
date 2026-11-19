"use client";
import { useState } from "react";
import { ModalForm, ActionButton, Modal } from "@/components/ui/client";
import { Button, Checkbox, Field, FormGrid, Input, Select } from "@/components/ui";
import { resetUserPassword, resetUserTwoFactor, saveUser, unlockUser } from "../actions";

type Opt = { id: string; name: string };
type Props = { roles: (Opt & { key: string })[]; departments: Opt[]; branches: Opt[] };
type U = { id: string; name: string; email: string | null; phone: string | null; roleId: string; departmentId: string | null; isActive: boolean; dob: string; branchId: string; twoFactorEnabled: boolean; locked: boolean; hasPassword: boolean };

function TempPassword({ password, onClose }: { password: string | null; onClose: () => void }) {
  return (
    <Modal open={!!password} onClose={onClose} title="Temporary password" size="sm" footer={<Button onClick={onClose}>Done</Button>}>
      <p className="text-sm text-slate-600">Share this password with the user privately. They must set a new password at first sign-in.</p>
      <p className="mt-3 select-all rounded-lg bg-slate-100 px-3 py-2 text-center font-mono text-lg">{password}</p>
    </Modal>
  );
}

function Fields({ roles, departments, branches, u }: Props & { u?: U }) {
  return (
    <FormGrid cols={2}>
      <Field label="Full name" required><Input name="name" defaultValue={u?.name} required /></Field>
      <Field label="Role" required><Select name="roleId" defaultValue={u?.roleId ?? ""} required placeholder="Select role">{roles.filter((r) => r.key !== "PARENT").map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
      <Field label="Email" hint="Used to sign in"><Input type="email" name="email" defaultValue={u?.email ?? ""} /></Field>
      <Field label="Mobile"><Input name="phone" inputMode="tel" defaultValue={u?.phone ?? ""} /></Field>
      <Field label="Department"><Select name="departmentId" defaultValue={u?.departmentId ?? ""} placeholder="—">{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      <Field label="Date of birth" hint="For birthday greetings"><Input type="date" name="dob" defaultValue={u?.dob} /></Field>
      {branches.length > 1 && <Field label="Branch"><Select name="branchId" defaultValue={u?.branchId}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}
      <div className="flex items-end"><Checkbox name="isActive" label="Account active" defaultChecked={u?.isActive ?? true} /></div>
    </FormGrid>
  );
}

export function UserForm(props: Props) {
  const [pw, setPw] = useState<string | null>(null);
  return (
    <>
      <ModalForm trigger="Add user" title="Add staff user" size="lg" action={saveUser} successMessage="User created" onSuccess={(d) => setPw(d.password)}>
        <Fields {...props} />
      </ModalForm>
      <TempPassword password={pw} onClose={() => setPw(null)} />
    </>
  );
}

export function UserRowActions({ user, ...props }: Props & { user: U }) {
  const [pw, setPw] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <ModalForm trigger="Edit" triggerVariant="ghost" triggerSize="sm" title={`Edit ${user.name}`} size="lg" action={saveUser} extra={{ id: user.id }} successMessage="User saved">
        <Fields {...props} u={user} />
      </ModalForm>
      {user.email && <ActionButton action={resetUserPassword} args={{ id: user.id }} variant="ghost" confirm={`Reset ${user.name}'s password?`} successMessage="Password reset" onSuccess={(d) => setPw(d.password)}>Reset password</ActionButton>}
      {user.twoFactorEnabled && <ActionButton action={resetUserTwoFactor} args={{ id: user.id }} variant="ghost" confirm="Turn off two-step verification for this user?" successMessage="Two-step verification reset">Reset 2-step</ActionButton>}
      {user.locked && <ActionButton action={unlockUser} args={{ id: user.id }} variant="ghost" successMessage="Account unlocked">Unlock</ActionButton>}
      <TempPassword password={pw} onClose={() => setPw(null)} />
    </div>
  );
}

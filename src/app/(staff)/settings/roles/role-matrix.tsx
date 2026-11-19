"use client";
import { useState } from "react";
import { useAction, ModalForm, ActionButton } from "@/components/ui/client";
import { Button, Card, CardHeader, CardBody, Checkbox, Field, Input, Select, Badge, cn } from "@/components/ui";
import { createRole, deleteRole, saveRolePermissions } from "../actions";

type Role = { id: string; key: string; name: string; description: string | null; permissions: string[]; users: number; isSystem: boolean };
type Group = { label: string; perms: { key: string; label: string }[] };

export function RoleMatrix({ roles, groups }: { roles: Role[]; groups: Group[] }) {
  const [selected, setSelected] = useState(roles.find((r) => r.key === "SCHOOL_ADMIN")?.id ?? roles[0]?.id);
  const role = roles.find((r) => r.id === selected)!;
  const [perms, setPerms] = useState<Record<string, string[]>>(Object.fromEntries(roles.map((r) => [r.id, r.permissions])));
  const current = perms[role.id] ?? [];
  const dirty = JSON.stringify([...current].sort()) !== JSON.stringify([...role.permissions].sort());
  const { run, pending } = useAction(saveRolePermissions, { successMessage: `${role.name} permissions saved` });
  const toggle = (k: string) => setPerms((p) => ({ ...p, [role.id]: current.includes(k) ? current.filter((x) => x !== k) : [...current, k] }));
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <Card>
        <CardHeader title="Roles" actions={
          <ModalForm trigger="New role" triggerSize="sm" title="New role" action={createRole} successMessage="Role created" size="sm">
            <Field label="Name" required><Input name="name" required /></Field>
            <Field label="Description"><Input name="description" /></Field>
            <Field label="Copy permissions from"><Select name="copyFrom" placeholder="Start empty">{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          </ModalForm>} />
        <div className="p-2">
          {roles.map((r) => (
            <button key={r.id} onClick={() => setSelected(r.id)} className={cn("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm", r.id === selected ? "bg-brand-50 font-medium text-brand-800" : "hover:bg-slate-50")}>
              <span>{r.name}</span><span className="text-xs text-slate-500">{r.users}</span>
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title={role.name} description={role.description ?? undefined}
          actions={<>
            {!role.isSystem && <ActionButton action={deleteRole} args={{ id: role.id }} variant="ghost" confirm={`Delete the ${role.name} role?`} successMessage="Role deleted">Delete role</ActionButton>}
            <Button variant="secondary" size="sm" onClick={() => setPerms((p) => ({ ...p, [role.id]: role.permissions }))} disabled={!dirty}>Undo</Button>
            <Button size="sm" loading={pending} disabled={!dirty} onClick={() => run({ roleId: role.id, permissions: current })}>Save permissions</Button>
          </>} />
        <CardBody className="grid gap-5 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.label} <Badge>{g.perms.filter((p) => current.includes(p.key)).length}/{g.perms.length}</Badge></p>
              <div className="space-y-1.5">
                {g.perms.map((p) => <Checkbox key={p.key} label={p.label} checked={current.includes(p.key)} onChange={() => toggle(p.key)} />)}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

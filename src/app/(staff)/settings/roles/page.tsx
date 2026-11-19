import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { PERMISSIONS, PERMISSION_GROUPS } from "@/lib/permissions";
import { SettingsTabs } from "../tabs";
import { RoleMatrix } from "./role-matrix";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const user = await requireUser("roles.manage");
  const roles = await db.role.findMany({ include: { _count: { select: { users: true } } }, orderBy: { name: "asc" } });
  const groups = PERMISSION_GROUPS.map((g) => ({ label: g.label, perms: Object.entries(PERMISSIONS).filter(([k]) => g.prefix.includes(k.split(".")[0])).map(([key, label]) => ({ key, label })) }));
  return (
    <>
      <PageHeader title="Settings" description="Choose what each role can see and do. Changes apply at the user's next page load — no code changes needed." />
      <SettingsTabs user={user} active="/settings/roles" />
      <RoleMatrix groups={groups} roles={roles.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, permissions: r.permissions, users: r._count.users, isSystem: r.isSystem }))} />
    </>
  );
}

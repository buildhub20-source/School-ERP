import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, Pagination, pageParams, sp } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { fmtDateTime } from "@/lib/format";
import { SettingsTabs } from "../tabs";
import { UserForm, UserRowActions } from "./user-forms";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Users" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("users.manage");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const q = sp(s, "q");
  const where: Prisma.UserWhereInput = {
    ...(user.roleKey === "SUPER_ADMIN" ? {} : { branchId: user.branchId }),
    ...(sp(s, "roleId") ? { roleId: sp(s, "roleId") } : { role: { key: { not: "PARENT" } } }),
    ...(sp(s, "status") === "inactive" ? { isActive: false } : sp(s, "status") === "locked" ? { lockedUntil: { gt: new Date() } } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}),
  };
  const [total, users, roles, departments, branches] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({ where, include: { role: true, department: true, branch: true }, orderBy: [{ isActive: "desc" }, { name: "asc" }], skip, take }),
    db.role.findMany({ orderBy: { name: "asc" } }),
    db.department.findMany({ where: { branchId: user.branchId }, orderBy: { name: "asc" } }),
    db.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);
  const opts = { roles: roles.map((r) => ({ id: r.id, name: r.name, key: r.key })), departments: departments.map((d) => ({ id: d.id, name: d.name })), branches: branches.map((b) => ({ id: b.id, name: b.name })) };
  return (
    <>
      <PageHeader title="Settings" description="Staff accounts. Parent logins are created automatically from student records; driver logins from Transport → Drivers." />
      <SettingsTabs user={user} active="/settings/users" />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Name, email or mobile" />
            <FilterSelect name="roleId" label="Staff roles" options={roles.map((r) => ({ value: r.id, label: r.name }))} />
            <FilterSelect name="status" label="Any status" options={[{ value: "inactive", label: "Inactive" }, { value: "locked", label: "Locked" }]} />
          </FilterBar>
          <UserForm {...opts} />
        </div>
        <Table>
          <THead><tr><TH>Name</TH><TH>Role</TH><TH>Email / mobile</TH><TH>Department</TH><TH>Security</TH><TH>Last sign-in</TH><TH /></tr></THead>
          <TBody>
            {users.length === 0 && <EmptyRow colSpan={7} />}
            {users.map((u) => (
              <TR key={u.id} className={u.isActive ? "" : "opacity-60"}>
                <TD className="font-medium">{u.name}{!u.isActive && <Badge className="ml-2">Inactive</Badge>}{branches.length > 1 && <span className="block text-xs text-slate-500">{u.branch.name}</span>}</TD>
                <TD><Badge tone="indigo">{u.role.name}</Badge></TD>
                <TD>{u.email}<span className="block text-xs text-slate-500">{u.phone}</span></TD>
                <TD>{u.department?.name ?? "—"}</TD>
                <TD className="space-x-1">{u.twoFactorEnabled && <Badge tone="green">2-step</Badge>}{u.lockedUntil && u.lockedUntil > new Date() && <Badge tone="red">Locked</Badge>}{u.mustChangePassword && <Badge tone="yellow">Temp password</Badge>}</TD>
                <TD className="text-xs">{fmtDateTime(u.lastLoginAt)}</TD>
                <TD align="right"><UserRowActions {...opts} user={{ id: u.id, name: u.name, email: u.email, phone: u.phone, roleId: u.roleId, departmentId: u.departmentId, isActive: u.isActive, dob: u.dob?.toISOString().slice(0, 10) ?? "", branchId: u.branchId, twoFactorEnabled: u.twoFactorEnabled, locked: !!(u.lockedUntil && u.lockedUntil > new Date()), hasPassword: !!u.passwordHash }} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/settings/users" />
      </Card>
    </>
  );
}

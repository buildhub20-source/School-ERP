import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge } from "@/components/ui";
import { SettingsTabs } from "../tabs";
import { BranchForm } from "./branch-form";

export const metadata = { title: "Branches" };

export default async function BranchesPage() {
  const user = await requireUser("settings.manage");
  const branches = await db.branch.findMany({ include: { _count: { select: { students: true, users: true, buses: true } } }, orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader title="Settings" description="Each branch keeps separate students, stock, buses and fees. The Super Admin switches branch from the user menu; the dashboard and reports show the active branch." />
      <SettingsTabs user={user} active="/settings/branches" />
      <Card>
        <div className="flex justify-end border-b border-slate-100 p-3"><BranchForm /></div>
        <Table>
          <THead><tr><TH>Code</TH><TH>Name</TH><TH>Contact</TH><TH align="right">Students</TH><TH align="right">Users</TH><TH align="right">Buses</TH><TH>Status</TH><TH /></tr></THead>
          <TBody>
            {branches.map((b) => (
              <TR key={b.id}>
                <TD className="font-mono text-xs">{b.code}</TD><TD className="font-medium">{b.name}{b.id === user.branchId && <Badge tone="indigo" className="ml-2">Active</Badge>}</TD>
                <TD className="text-xs">{b.address}<br />{b.phone} {b.email}</TD>
                <TD align="right">{b._count.students}</TD><TD align="right">{b._count.users}</TD><TD align="right">{b._count.buses}</TD>
                <TD>{b.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</TD>
                <TD align="right"><BranchForm initial={{ id: b.id, code: b.code, name: b.name, address: b.address ?? "", phone: b.phone ?? "", email: b.email ?? "", isActive: b.isActive }} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

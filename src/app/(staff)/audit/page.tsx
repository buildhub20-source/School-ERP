import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, Pagination, pageParams, sp } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect, FilterDate } from "@/components/ui/client";
import { fmtDateTime } from "@/lib/format";
import type { Prisma } from "@prisma/client";
import { AuditDiff } from "./audit-diff";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("audit.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s, 50);
  const from = sp(s, "from"), to = sp(s, "to");
  const where: Prisma.AuditLogWhereInput = {
    ...(user.roleKey === "SUPER_ADMIN" ? {} : { OR: [{ branchId: user.branchId }, { branchId: null }] }),
    ...(sp(s, "entity") ? { entity: sp(s, "entity") } : {}),
    ...(sp(s, "action") ? { action: { startsWith: sp(s, "action") } } : {}),
    ...(sp(s, "userId") ? { userId: sp(s, "userId") } : {}),
    ...(sp(s, "q") ? { OR: [{ entityId: sp(s, "q") }, { userName: { contains: sp(s, "q"), mode: "insensitive" } }] } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from + "T00:00:00+05:30") } : {}), ...(to ? { lte: new Date(to + "T23:59:59+05:30") } : {}) } } : {}),
  };
  const [total, logs, entities, users] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    db.auditLog.findMany({ distinct: ["entity"], select: { entity: true }, orderBy: { entity: "asc" } }),
    db.user.findMany({ where: { role: { key: { notIn: ["PARENT"] } } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Audit log" description="Every create, edit and delete — who did it, when, from where, and what changed. Sign-ins and sign-outs are included." />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Record id or user name" />
            <FilterSelect name="entity" label="All records" options={entities.map((e) => ({ value: e.entity, label: e.entity }))} />
            <FilterSelect name="action" label="All actions" options={["CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "LOGIN_FAILED"].map((a) => ({ value: a, label: a }))} />
            <FilterSelect name="userId" label="All users" options={users.map((u) => ({ value: u.id, label: u.name }))} />
            <FilterDate name="from" label="From" /><FilterDate name="to" label="To" />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>When</TH><TH>User</TH><TH>Action</TH><TH>Record</TH><TH>Changes</TH></tr></THead>
          <TBody>
            {logs.length === 0 && <EmptyRow colSpan={5} />}
            {logs.map((l) => (
              <TR key={l.id}>
                <TD className="whitespace-nowrap text-xs">{fmtDateTime(l.createdAt)}<span className="block text-slate-400">{l.ip}</span></TD>
                <TD className="text-sm">{l.userName ?? "System"}</TD>
                <TD><Badge tone={l.action.startsWith("DELETE") ? "red" : l.action.startsWith("CREATE") ? "green" : l.action.includes("FAIL") ? "yellow" : "blue"}>{l.action}</Badge></TD>
                <TD className="text-xs">{l.entity}<span className="block font-mono text-slate-400">{l.entityId}</span></TD>
                <TD><AuditDiff before={l.before as Record<string, unknown> | null} after={l.after as Record<string, unknown> | null} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/audit" />
      </Card>
    </>
  );
}

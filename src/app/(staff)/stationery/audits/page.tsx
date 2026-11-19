import Link from "next/link";
import type { AuditStatus, Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { CATEGORIES } from "@/server/stationery/core";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge } from "@/components/ui";
import { FilterBar, FilterSelect } from "@/components/ui/client";
import { fmtDateTime } from "@/lib/format";
import { StartAuditButton } from "./audit-forms";

export const metadata = { title: "Stock audits" };
const STATUSES: AuditStatus[] = ["IN_PROGRESS", "COMPLETED", "CANCELLED"];

export default async function AuditsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("stationery.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const status = STATUSES.find((x) => x === sp(s, "status"));
  const where: Prisma.StockAuditWhereInput = { branchId: user.branchId, ...(status ? { status } : {}) };
  const [total, rows] = await Promise.all([
    db.stockAudit.count({ where }),
    db.stockAudit.findMany({ where, include: { lines: { select: { systemQty: true, countedQty: true } } }, orderBy: { createdAt: "desc" }, skip, take }),
  ]);
  const users = await db.user.findMany({ where: { id: { in: rows.flatMap((r) => [r.startedById, r.completedById]).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const name = (id: string | null) => users.find((u) => u.id === id)?.name ?? "—";
  return (
    <>
      <PageHeader title="Stock audits" description="Physical count versus system count; completing an audit posts the differences as adjustments." breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Audits" }]}
        actions={hasPerm(user, "stationery.manage") && <StartAuditButton categories={CATEGORIES} />} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar><FilterSelect name="status" label="Any status" options={STATUSES.map((x) => ({ value: x, label: x.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))} /></FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Audit</TH><TH>Started</TH><TH>Completed</TH><TH align="right">Counted</TH><TH align="right">Differences</TH><TH>Status</TH></tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={6} message="No audits yet." />}
            {rows.map((a) => {
              const counted = a.lines.filter((l) => l.countedQty !== null);
              const diffs = counted.filter((l) => l.countedQty !== l.systemQty).length;
              return (
                <TR key={a.id}>
                  <TD><Link href={`/stationery/audits/${a.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">{a.auditNo}</Link>{a.notes && <span className="block text-xs text-slate-500">{a.notes}</span>}</TD>
                  <TD className="whitespace-nowrap">{fmtDateTime(a.createdAt)}<span className="block text-xs text-slate-500">{name(a.startedById)}</span></TD>
                  <TD className="whitespace-nowrap">{a.completedAt ? <>{fmtDateTime(a.completedAt)}<span className="block text-xs text-slate-500">{name(a.completedById)}</span></> : "—"}</TD>
                  <TD align="right">{counted.length} / {a.lines.length}</TD>
                  <TD align="right" className={diffs ? "font-semibold text-amber-700" : ""}>{diffs}</TD>
                  <TD><StatusBadge status={a.status} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/stationery/audits" />
      </Card>
    </>
  );
}

import Link from "next/link";
import type { Prisma, RequestStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { classOptions, staffOptions } from "@/server/lookups";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge, Tabs } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect, FilterDate } from "@/components/ui/client";
import { fmtDate, daysBetween } from "@/lib/format";

export const metadata = { title: "Stationery requests" };

const STATUSES: RequestStatus[] = ["PENDING", "APPROVED", "PARTIALLY_APPROVED", "ISSUED", "REJECTED", "CANCELLED"];

export default async function RequestsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["stationery.view", "stationery.approve"]);
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const status = STATUSES.find((x) => x === sp(s, "status"));
  const from = sp(s, "from"), to = sp(s, "to");
  const where: Prisma.StationeryRequestWhereInput = {
    branchId: user.branchId,
    ...(status ? { status } : {}),
    ...(sp(s, "teacherId") ? { requestedById: sp(s, "teacherId") } : {}),
    ...(sp(s, "classId") ? { classId: sp(s, "classId") } : {}),
    ...(sp(s, "q") ? { OR: [{ requestNo: { contains: sp(s, "q"), mode: "insensitive" } }, { purpose: { contains: sp(s, "q"), mode: "insensitive" } }, { requestedBy: { name: { contains: sp(s, "q"), mode: "insensitive" } } }] } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from + "T00:00:00+05:30") } : {}), ...(to ? { lte: new Date(to + "T23:59:59.999+05:30") } : {}) } } : {}),
  };
  const [total, rows, counts, classes, staff] = await Promise.all([
    db.stationeryRequest.count({ where }),
    db.stationeryRequest.findMany({ where, include: { requestedBy: { select: { name: true } }, schoolClass: true, department: true, approvedBy: { select: { name: true } }, lines: { select: { qtyRequested: true, qtyApproved: true, qtyIssued: true } } }, orderBy: { createdAt: "desc" }, skip, take }),
    db.stationeryRequest.groupBy({ by: ["status"], where: { branchId: user.branchId }, _count: true }),
    classOptions(user.branchId),
    staffOptions(user.branchId),
  ]);
  const count = (st: string) => counts.find((c) => c.status === st)?._count ?? 0;
  const base = new URLSearchParams(Object.entries(s).filter(([k, v]) => typeof v === "string" && k !== "page" && k !== "status"));
  const tabHref = (st?: string) => { const q = new URLSearchParams(base); if (st) q.set("status", st); const t = q.toString(); return `/stationery/requests${t ? `?${t}` : ""}`; };
  return (
    <>
      <PageHeader title="Teacher requests" description="Approve, partly approve or reject; issuing deducts stock." breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Requests" }]} />
      <Tabs active={tabHref(status)} tabs={[
        { href: tabHref(), label: "All" },
        { href: tabHref("PENDING"), label: "Pending", count: count("PENDING") },
        { href: tabHref("APPROVED"), label: "Approved", count: count("APPROVED") },
        { href: tabHref("PARTIALLY_APPROVED"), label: "Partly approved", count: count("PARTIALLY_APPROVED") },
        { href: tabHref("ISSUED"), label: "Issued" },
        { href: tabHref("REJECTED"), label: "Rejected" },
        { href: tabHref("CANCELLED"), label: "Cancelled" },
      ]} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            {status && <input type="hidden" name="status" value={status} />}
            <SearchField placeholder="Request no, teacher or purpose" />
            <FilterSelect name="teacherId" label="All staff" options={staff.map((u) => ({ value: u.id, label: u.name }))} />
            <FilterSelect name="classId" label="All classes" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
            <FilterDate name="from" label="From" />
            <FilterDate name="to" label="To" />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Request</TH><TH>Requested by</TH><TH>For</TH><TH>Purpose</TH><TH align="right">Items</TH><TH align="right">Qty req / appr</TH><TH>Date</TH><TH>Status</TH></tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={8} />}
            {rows.map((r) => {
              const req = r.lines.reduce((a, l) => a + l.qtyRequested, 0);
              const appr = r.lines.reduce((a, l) => a + (l.qtyApproved ?? 0), 0);
              const age = daysBetween(r.createdAt, new Date());
              return (
                <TR key={r.id} highlight={r.status === "PENDING" && age >= 2 ? "yellow" : undefined}>
                  <TD><Link href={`/stationery/requests/${r.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">{r.requestNo}</Link></TD>
                  <TD>{r.requestedBy.name}</TD>
                  <TD>{r.schoolClass?.name ?? r.department?.name ?? "—"}</TD>
                  <TD className="max-w-xs truncate">{r.purpose ?? "—"}</TD>
                  <TD align="right">{r.lines.length}</TD>
                  <TD align="right">{req} / {r.status === "PENDING" ? "—" : appr}</TD>
                  <TD className="whitespace-nowrap">{fmtDate(r.createdAt)}{r.status === "PENDING" && age >= 1 && <span className="block text-xs text-amber-700">{age} day{age === 1 ? "" : "s"} waiting</span>}</TD>
                  <TD><StatusBadge status={r.status} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/stationery/requests" />
      </Card>
    </>
  );
}

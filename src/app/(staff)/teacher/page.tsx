import Link from "next/link";
import type { Prisma, RequestStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { classOptions, departmentOptions } from "@/server/lookups";
import { itemOptions } from "@/server/stationery/lookups";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge, StatCard } from "@/components/ui";
import { FilterBar, FilterSelect, SearchField } from "@/components/ui/client";
import { fmtDate } from "@/lib/format";
import { NewRequestButton } from "./requests/request-form";

export const metadata = { title: "My stationery requests" };
const STATUSES: RequestStatus[] = ["PENDING", "APPROVED", "PARTIALLY_APPROVED", "ISSUED", "REJECTED", "CANCELLED"];

export default async function TeacherHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("stationery.request");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s, 20);
  const status = STATUSES.find((x) => x === sp(s, "status"));
  const where: Prisma.StationeryRequestWhereInput = {
    branchId: user.branchId, requestedById: user.id, ...(status ? { status } : {}),
    ...(sp(s, "q") ? { OR: [{ requestNo: { contains: sp(s, "q"), mode: "insensitive" } }, { purpose: { contains: sp(s, "q"), mode: "insensitive" } }] } : {}),
  };
  const [total, rows, counts, items, classes, depts, me, mySection] = await Promise.all([
    db.stationeryRequest.count({ where }),
    db.stationeryRequest.findMany({ where, include: { schoolClass: true, department: true, lines: { select: { qtyRequested: true, qtyApproved: true, qtyIssued: true } } }, orderBy: { createdAt: "desc" }, skip, take }),
    db.stationeryRequest.groupBy({ by: ["status"], where: { branchId: user.branchId, requestedById: user.id }, _count: true }),
    itemOptions(user.branchId), classOptions(user.branchId), departmentOptions(user.branchId),
    db.user.findUnique({ where: { id: user.id }, select: { departmentId: true } }),
    db.section.findFirst({ where: { classTeacherId: user.id }, select: { classId: true } }),
  ]);
  const c = (st: RequestStatus[]) => counts.filter((x) => st.includes(x.status)).reduce((a, x) => a + x._count, 0);
  const defaultTarget = mySection ? `c:${mySection.classId}` : me?.departmentId ? `d:${me.departmentId}` : undefined;
  return (
    <>
      <PageHeader title="My stationery requests" description="Request items from the store and track approval and issue."
        actions={<NewRequestButton items={items} classes={classes.map((x) => ({ id: x.id, name: x.name }))} departments={depts.map((d) => ({ id: d.id, name: d.name }))} defaultTarget={defaultTarget} />} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Pending" value={c(["PENDING"])} tone="yellow" href="/teacher?status=PENDING" />
        <StatCard label="Approved" value={c(["APPROVED", "PARTIALLY_APPROVED"])} tone="blue" href="/teacher?status=APPROVED" />
        <StatCard label="Issued" value={c(["ISSUED"])} tone="green" href="/teacher?status=ISSUED" />
        <StatCard label="Rejected" value={c(["REJECTED"])} tone="red" href="/teacher?status=REJECTED" />
      </div>
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Request no or purpose" />
            <FilterSelect name="status" label="Any status" options={STATUSES.map((x) => ({ value: x, label: x.replace(/_/g, " ").toLowerCase().replace(/^\w/, (ch) => ch.toUpperCase()) }))} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Request</TH><TH>Date</TH><TH>For</TH><TH>Purpose</TH><TH align="right">Requested</TH><TH align="right">Approved</TH><TH align="right">Issued</TH><TH>Status</TH></tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={8} message="No requests yet. Use “New request” to ask the store for items." />}
            {rows.map((r) => (
              <TR key={r.id}>
                <TD><Link href={`/teacher/requests/${r.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">{r.requestNo}</Link></TD>
                <TD className="whitespace-nowrap">{fmtDate(r.createdAt)}</TD>
                <TD>{r.schoolClass?.name ?? r.department?.name ?? "Personal"}</TD>
                <TD className="max-w-xs truncate">{r.purpose ?? "—"}</TD>
                <TD align="right">{r.lines.reduce((a, l) => a + l.qtyRequested, 0)}</TD>
                <TD align="right">{r.status === "PENDING" ? "—" : r.lines.reduce((a, l) => a + (l.qtyApproved ?? 0), 0)}</TD>
                <TD align="right">{r.lines.reduce((a, l) => a + l.qtyIssued, 0)}</TD>
                <TD><StatusBadge status={r.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/teacher" />
      </Card>
    </>
  );
}

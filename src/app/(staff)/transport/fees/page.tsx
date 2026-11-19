import Link from "next/link";
import type { FeeStatus, Prisma } from "@prisma/client";
import { Plus, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { fmtDate, fullName, money, today, toNum } from "@/lib/format";
import { stopFee } from "@/server/transport/core";
import { PageHeader, Card, CardHeader, CardBody, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge, Badge, Field, FormGrid, Input, Tabs, StatCard } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect, ModalForm, ActionButton } from "@/components/ui/client";
import { deleteSlabAction, saveSlabAction } from "../actions";

export const metadata = { title: "Transport fees" };

const STATUSES: FeeStatus[] = ["PENDING", "PARTIAL", "PAID", "WAIVED", "CANCELLED"];

export default async function TransportFeesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("transport.fees.view");
  const s = await searchParams;
  const tab = s.tab === "settings" ? "settings" : "students";
  const branchId = user.branchId;
  const policies = await getSetting("policies", branchId);
  const canManage = hasPerm(user, "transport.manage");
  const tabs = [{ href: "/transport/fees", label: "Students' transport fees" }, { href: "/transport/fees?tab=settings", label: "Fee per stop & slabs" }];

  if (tab === "settings") {
    const [routes, slabs] = await Promise.all([
      db.route.findMany({ where: { branchId, isActive: true }, include: { stops: { orderBy: { sequence: "asc" }, include: { _count: { select: { allocations: { where: { status: "ACTIVE" } } } } } } }, orderBy: { code: "asc" } }),
      db.transportFeeSlab.findMany({ where: { branchId }, orderBy: { fromKm: "asc" } }),
    ]);
    const fees = new Map<string, number>();
    for (const r of routes) for (const st of r.stops) fees.set(st.id, await stopFee(db, st.id));
    return (
      <>
        <PageHeader title="Transport fees" breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Fees" }]} />
        <Tabs tabs={tabs} active={tabs[1].href} />
        <Card>
          <CardBody className="text-sm text-slate-600">
            Fee mode: <b>{policies.transportFeeMode === "STOP" ? "per stop" : "by distance (slabs)"}</b> · charged <b>{policies.transportFeeBasis === "TERM" ? "every term" : "once a year"}</b>. When a student is assigned to a stop, the fee is added to their fee account automatically.
            {hasPerm(user, "settings.manage") ? <> Change the mode in <Link href="/settings/policies" className="text-brand-700 hover:underline">Settings → Policies</Link>.</> : " The mode is set by the administrator in Settings → Policies."}
          </CardBody>
        </Card>
        <div className="mt-5 grid gap-5 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader title="Fee per stop" description={policies.transportFeeMode === "STOP" ? "Set each stop's fee on the route page." : "Distance mode: the matching slab applies; the stop fee is the fallback."} />
            <Table>
              <THead><tr><TH>Route</TH><TH>Stop</TH><TH align="right">Distance</TH><TH align="right">Stop fee</TH><TH align="right">Effective fee</TH><TH align="right">Students</TH></tr></THead>
              <TBody>
                {routes.every((r) => !r.stops.length) && <EmptyRow colSpan={6} message="No stops yet." />}
                {routes.flatMap((r) => r.stops.map((st) => (
                  <TR key={st.id}>
                    <TD><Link href={`/transport/routes/${r.id}`} className="hover:text-brand-700">{r.code}</Link></TD>
                    <TD>{st.sequence}. {st.name}</TD>
                    <TD align="right">{toNum(st.distanceKm)} km</TD>
                    <TD align="right">{st.feeAmount === null ? "—" : money(st.feeAmount)}</TD>
                    <TD align="right" className="font-medium">{money(fees.get(st.id))}{fees.get(st.id) === 0 && <Badge tone="yellow" className="ml-1">no fee</Badge>}</TD>
                    <TD align="right">{st._count.allocations}</TD>
                  </TR>
                )))}
              </TBody>
            </Table>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader title="Distance slabs" description={policies.transportFeeMode === "DISTANCE" ? "In use (distance mode)" : "Used only in distance mode"}
              actions={canManage && <ModalForm trigger="Add slab" triggerSize="sm" icon={<Plus className="size-3.5" />} title="Add distance slab" action={saveSlabAction} successMessage="Slab added">
                <FormGrid cols={3}>
                  <Field label="From km" required><Input type="number" step="0.1" min="0" name="fromKm" required /></Field>
                  <Field label="To km" required><Input type="number" step="0.1" min="0" name="toKm" required /></Field>
                  <Field label="Fee per term" required><Input type="number" step="1" min="0" name="amount" required /></Field>
                </FormGrid>
              </ModalForm>} />
            <Table>
              <THead><tr><TH>Distance</TH><TH align="right">Fee</TH>{canManage && <TH />}</tr></THead>
              <TBody>
                {slabs.length === 0 && <EmptyRow colSpan={3} message="No slabs." />}
                {slabs.map((sl) => (
                  <TR key={sl.id}>
                    <TD>{toNum(sl.fromKm)} – {toNum(sl.toKm)} km</TD>
                    <TD align="right">{money(sl.amount)}</TD>
                    {canManage && <TD><div className="flex justify-end gap-1">
                      <ModalForm trigger="Edit" triggerVariant="ghost" triggerSize="sm" title="Edit slab" action={saveSlabAction} extra={{ id: sl.id }} successMessage="Slab updated">
                        <FormGrid cols={3}>
                          <Field label="From km" required><Input type="number" step="0.1" min="0" name="fromKm" defaultValue={toNum(sl.fromKm)} required /></Field>
                          <Field label="To km" required><Input type="number" step="0.1" min="0" name="toKm" defaultValue={toNum(sl.toKm)} required /></Field>
                          <Field label="Fee per term" required><Input type="number" step="1" min="0" name="amount" defaultValue={toNum(sl.amount)} required /></Field>
                        </FormGrid>
                      </ModalForm>
                      <ActionButton action={deleteSlabAction} args={{ id: sl.id }} variant="ghost" confirm="Delete this slab?" successMessage="Slab deleted"><Trash2 className="size-4 text-rose-600" /></ActionButton>
                    </div></TD>}
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="px-4 py-3 text-xs text-slate-500">Changing fees affects new allocations; existing fee lines are not changed.</p>
          </Card>
        </div>
      </>
    );
  }

  const { page, pageSize, skip, take } = pageParams(s);
  const q = sp(s, "q");
  const status = sp(s, "status");
  const parts = q?.split(/\s+/).filter(Boolean) ?? [];
  const where: Prisma.StudentFeeWhereInput = {
    feeHead: { type: "TRANSPORT" },
    student: { branchId, ...(q ? { OR: [{ admissionNo: { contains: q, mode: "insensitive" } }, { AND: parts.map((p) => ({ OR: [{ firstName: { contains: p, mode: "insensitive" as const } }, { lastName: { contains: p, mode: "insensitive" as const } }] })) }] } : {}) },
    ...(status === "OVERDUE" ? { status: { in: ["PENDING", "PARTIAL"] }, dueDate: { lt: today() } } : status && (STATUSES as string[]).includes(status) ? { status: status as FeeStatus } : { status: { not: "CANCELLED" } }),
    ...(sp(s, "routeId") ? { allocation: { routeId: sp(s, "routeId") } } : {}),
    ...(sp(s, "termId") ? { termId: sp(s, "termId") } : {}),
  };
  const [total, fees, agg, routes, terms] = await Promise.all([
    db.studentFee.count({ where }),
    db.studentFee.findMany({ where, include: { student: true, term: true, allocation: { include: { route: true, stop: true, bus: true } } }, orderBy: [{ dueDate: "asc" }, { student: { firstName: "asc" } }], skip, take }),
    db.studentFee.aggregate({ where, _sum: { amount: true, concessionAmount: true, paidAmount: true, balance: true } }),
    db.route.findMany({ where: { branchId }, orderBy: { code: "asc" } }),
    db.term.findMany({ where: { academicYear: { isCurrent: true } }, orderBy: { sequence: "asc" } }),
  ]);
  const t = today();
  return (
    <>
      <PageHeader title="Transport fees" description="Transport fee lines on students' fee accounts" breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Fees" }]} />
      <Tabs tabs={tabs} active={tabs[0].href} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Billed" value={money(agg._sum.amount)} />
        <StatCard label="Concessions" value={money(agg._sum.concessionAmount)} tone="gray" />
        <StatCard label="Collected" value={money(agg._sum.paidAmount)} tone="green" />
        <StatCard label="Balance" value={money(agg._sum.balance)} tone="red" />
      </div>
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Student name or admission no" />
            <FilterSelect name="status" label="All (not cancelled)" options={[{ value: "OVERDUE", label: "Overdue" }, ...STATUSES.map((x) => ({ value: x, label: x.charAt(0) + x.slice(1).toLowerCase() }))]} />
            <FilterSelect name="routeId" label="All routes" options={routes.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))} />
            <FilterSelect name="termId" label="All terms" options={terms.map((x) => ({ value: x.id, label: x.name }))} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Student</TH><TH>Description</TH><TH>Route · stop</TH><TH>Due</TH><TH align="right">Amount</TH><TH align="right">Paid</TH><TH align="right">Balance</TH><TH>Status</TH></tr></THead>
          <TBody>
            {fees.length === 0 && <EmptyRow colSpan={8} />}
            {fees.map((f) => {
              const overdue = (f.status === "PENDING" || f.status === "PARTIAL") && f.dueDate < t;
              return (
                <TR key={f.id} highlight={overdue ? "red" : undefined}>
                  <TD><Link href={`/students/${f.studentId}`} className="font-medium hover:text-brand-700">{fullName(f.student)}</Link><span className="block text-xs text-slate-500">{f.student.admissionNo}</span></TD>
                  <TD>{f.description}</TD>
                  <TD>{f.allocation ? <>{f.allocation.route.code} · {f.allocation.stop.name}<span className="block text-xs text-slate-500">{f.allocation.bus.busNo}{f.allocation.status !== "ACTIVE" ? " · ended" : ""}</span></> : "—"}</TD>
                  <TD>{fmtDate(f.dueDate)}</TD>
                  <TD align="right">{money(toNum(f.amount) - toNum(f.concessionAmount))}</TD>
                  <TD align="right">{money(f.paidAmount)}</TD>
                  <TD align="right">{money(f.balance)}</TD>
                  <TD><StatusBadge status={overdue ? "OVERDUE" : f.status} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/transport/fees" />
      </Card>
    </>
  );
}

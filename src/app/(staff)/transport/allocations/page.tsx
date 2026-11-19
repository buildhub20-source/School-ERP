import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { className, fmtDate, fullName, isoDate } from "@/lib/format";
import { stopFee } from "@/server/transport/core";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge, Badge, Field, Input } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect, ModalForm } from "@/components/ui/client";
import { endAllocationAction } from "../actions";
import { AllocateForm, ChangeForm, type BusOpt, type RouteOpt } from "./allocation-form";

export const metadata = { title: "Student allocation" };

export default async function AllocationsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("transport.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const branchId = user.branchId;
  const q = sp(s, "q");
  const status = sp(s, "status") ?? "ACTIVE";
  const studentId = sp(s, "studentId");
  const parts = q?.split(/\s+/).filter(Boolean) ?? [];
  const where: Prisma.TransportAllocationWhereInput = {
    student: { branchId, ...(q ? { OR: [{ admissionNo: { contains: q, mode: "insensitive" } }, { AND: parts.map((p) => ({ OR: [{ firstName: { contains: p, mode: "insensitive" as const } }, { lastName: { contains: p, mode: "insensitive" as const } }] })) }] } : {}) },
    ...(status === "ALL" ? {} : { status }),
    ...(sp(s, "busId") ? { busId: sp(s, "busId") } : {}),
    ...(sp(s, "routeId") ? { routeId: sp(s, "routeId") } : {}),
    ...(studentId ? { studentId } : {}),
  };
  const canManage = hasPerm(user, "transport.manage");
  const showFees = hasPerm(user, "transport.fees.view");
  const [total, allocs, routesRaw, busesRaw, seatCounts, policies, picked] = await Promise.all([
    db.transportAllocation.count({ where }),
    db.transportAllocation.findMany({ where, include: { bus: true, route: true, stop: true, student: { include: { schoolClass: true, section: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], skip, take }),
    db.route.findMany({ where: { branchId, isActive: true }, include: { stops: { orderBy: { sequence: "asc" } } }, orderBy: { code: "asc" } }),
    db.bus.findMany({ where: { branchId, isActive: true }, orderBy: { busNo: "asc" } }),
    db.transportAllocation.groupBy({ by: ["busId"], where: { status: "ACTIVE", bus: { branchId } }, _count: true }),
    getSetting("policies", branchId),
    studentId ? db.student.findFirst({ where: { id: studentId, branchId }, include: { schoolClass: true, section: true, allocations: { where: { status: "ACTIVE" }, include: { bus: true } } } }) : Promise.resolve(null),
  ]);
  const routes: RouteOpt[] = await Promise.all(routesRaw.map(async (r) => ({
    id: r.id, code: r.code, name: r.name, busId: r.busId,
    stops: await Promise.all(r.stops.map(async (x) => ({ id: x.id, name: x.name, sequence: x.sequence, pickupTime: x.pickupTime, fee: showFees ? await stopFee(db, x.id) : null }))),
  })));
  const buses: BusOpt[] = busesRaw.map((b) => ({ id: b.id, busNo: b.busNo, capacity: b.capacity, taken: seatCounts.find((c) => c.busId === b.id)?._count ?? 0 }));
  const initialStudent = picked && picked.status === "ACTIVE" ? { id: picked.id, name: fullName(picked), admissionNo: picked.admissionNo, className: className(picked.schoolClass, picked.section), address: picked.address, currentBus: picked.allocations[0]?.bus.busNo ?? null } : null;
  const t = isoDate();
  return (
    <>
      <PageHeader title="Student allocation" description={`Capacity policy: ${policies.capacityPolicy === "BLOCK" ? "block when a bus is full" : "warn when a bus is full (override allowed)"}`}
        breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Allocation" }]}
        actions={canManage && <AllocateForm routes={routes} buses={buses} policy={policies.capacityPolicy} initialStudent={initialStudent} today={t} showFees={showFees} />} />
      {picked && <p className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">Showing allocations for <Link href={`/students/${picked.id}`} className="font-medium underline">{fullName(picked)}</Link> · <Link href="/transport/allocations" className="underline">show all</Link></p>}
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Student name or admission no" />
            <FilterSelect name="routeId" label="All routes" options={routesRaw.map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))} />
            <FilterSelect name="busId" label="All buses" options={busesRaw.map((b) => ({ value: b.id, label: b.busNo }))} />
            <FilterSelect name="status" label="Active" options={[{ value: "ENDED", label: "Ended" }, { value: "ALL", label: "All" }]} />
            {studentId && <input type="hidden" name="studentId" value={studentId} />}
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Student</TH><TH>Class</TH><TH>Route · stop</TH><TH>Bus</TH><TH>From</TH><TH>To</TH><TH>Status</TH>{canManage && <TH />}</tr></THead>
          <TBody>
            {allocs.length === 0 && <EmptyRow colSpan={8} message={studentId ? "This student has no allocation yet." : undefined} />}
            {allocs.map((a) => (
              <TR key={a.id}>
                <TD><Link href={`/students/${a.studentId}`} className="font-medium text-slate-900 hover:text-brand-700">{fullName(a.student)}</Link><span className="block text-xs text-slate-500">{a.student.admissionNo}</span></TD>
                <TD>{className(a.student.schoolClass, a.student.section)}</TD>
                <TD>{a.route.code} · {a.stop.name}{a.stop.pickupTime && <span className="block text-xs text-slate-500">Pickup {a.stop.pickupTime}</span>}</TD>
                <TD>{a.bus.busNo}{a.capacityOverride && <Badge tone="yellow" className="ml-1">over capacity</Badge>}</TD>
                <TD>{fmtDate(a.startDate)}</TD>
                <TD>{fmtDate(a.endDate)}</TD>
                <TD><StatusBadge status={a.status} /></TD>
                {canManage && (
                  <TD>
                    {a.status === "ACTIVE" && (
                      <div className="flex gap-1.5">
                        <ChangeForm allocation={{ id: a.id, routeId: a.routeId, stopId: a.stopId, busId: a.busId, student: fullName(a.student) }} routes={routes} buses={buses} policy={policies.capacityPolicy} today={t} showFees={showFees} />
                        <ModalForm trigger="End" triggerVariant="danger" triggerSize="sm" title={`End allocation — ${fullName(a.student)}`} description="Frees the seat. Unpaid transport fees for later terms are cancelled." action={endAllocationAction} extra={{ allocationId: a.id }} submitLabel="End allocation" successMessage="@result">
                          <Field label="Last day on the bus"><Input type="date" name="endDate" defaultValue={t} /></Field>
                        </ModalForm>
                      </div>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/transport/allocations" />
      </Card>
    </>
  );
}

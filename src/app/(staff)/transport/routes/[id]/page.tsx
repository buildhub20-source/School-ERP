import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, FileDown, Pencil, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { className, fullName, money, toNum } from "@/lib/format";
import { stopFee } from "@/server/transport/core";
import { pathKm } from "@/server/transport/helpers";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, EmptyRow, Field, FormGrid, Input, Select, Textarea, Checkbox, LinkButton, Badge, sp } from "@/components/ui";
import { ActionButton, ModalForm, FilterBar, FilterSelect } from "@/components/ui/client";
import { deleteStopAction, moveStopAction, saveRouteAction } from "../../actions";
import { TransportMap } from "../../_components/map";
import { StopEditor, type StopRow } from "./stop-editor";

export const metadata = { title: "Route" };

export default async function RoutePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("transport.view");
  const { id } = await params;
  const s = await searchParams;
  const route = await db.route.findFirst({ where: { id, branchId: user.branchId }, include: { bus: true, stops: { orderBy: { sequence: "asc" }, include: { _count: { select: { allocations: { where: { status: "ACTIVE" } } } } } } } });
  if (!route) notFound();
  const stopFilter = sp(s, "stopId");
  const [allocs, buses, policies] = await Promise.all([
    db.transportAllocation.findMany({
      where: { routeId: route.id, status: "ACTIVE", ...(stopFilter ? { stopId: stopFilter } : {}) },
      include: { bus: true, stop: true, student: { include: { schoolClass: true, section: true, guardians: { include: { guardian: true }, orderBy: { isPrimary: "desc" }, take: 1 } } } },
      orderBy: [{ stop: { sequence: "asc" } }, { student: { firstName: "asc" } }],
    }),
    db.bus.findMany({ where: { branchId: user.branchId, isActive: true }, orderBy: { busNo: "asc" } }),
    getSetting("policies", user.branchId),
  ]);
  const fees = await Promise.all(route.stops.map((x) => stopFee(db, x.id)));
  const canManage = hasPerm(user, "transport.manage");
  const canFees = hasPerm(user, "transport.fees.view");
  const rows: StopRow[] = route.stops.map((x) => ({ id: x.id, name: x.name, sequence: x.sequence, lat: x.lat, lng: x.lng, pickupTime: x.pickupTime, dropTime: x.dropTime, distanceKm: toNum(x.distanceKm), feeAmount: x.feeAmount === null ? null : toNum(x.feeAmount) }));
  const pts = rows.filter((x) => x.lat !== null && x.lng !== null);
  const total = route.stops.reduce((n, x) => n + x._count.allocations, 0);
  const qs = stopFilter ? `?stopId=${stopFilter}` : "";
  return (
    <>
      <PageHeader title={`${route.code} · ${route.name}`} description={route.description ?? undefined}
        breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Routes", href: "/transport/routes" }, { label: route.code }]}
        actions={<>
          <LinkButton href={`/api/transport/routes/${route.id}/students${qs}`} target="_blank"><FileDown className="size-4" />Student list PDF</LinkButton>
          {canManage && <ModalForm trigger="Edit route" triggerVariant="secondary" icon={<Pencil className="size-4" />} title="Edit route" action={saveRouteAction} successMessage="Route updated">
            <input type="hidden" name="id" value={route.id} />
            <FormGrid>
              <Field label="Code" required><Input name="code" defaultValue={route.code} required /></Field>
              <Field label="Name" required><Input name="name" defaultValue={route.name} required /></Field>
            </FormGrid>
            <Field label="Bus" hint="New allocations on this route default to this bus. Existing students keep their bus."><Select name="busId" defaultValue={route.busId ?? ""} placeholder="— No bus —">{buses.map((b) => <option key={b.id} value={b.id}>{b.busNo} ({b.capacity} seats)</option>)}</Select></Field>
            <Field label="Description"><Textarea name="description" defaultValue={route.description ?? ""} /></Field>
            <input type="hidden" name="isActive" value="false" />
            <Checkbox name="isActive" value="true" label="Route is active" defaultChecked={route.isActive} />
          </ModalForm>}
        </>} />
      {!route.isActive && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">This route is inactive.</p>}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Summary" />
          <CardBody>
            <DescList cols={2} items={[
              { label: "Bus", value: route.bus ? <Link href={`/transport/buses/${route.bus.id}`} className="hover:text-brand-700">{route.bus.busNo}</Link> : <span className="text-amber-700">Not assigned</span> },
              { label: "Students", value: route.bus ? <span className={total > route.bus.capacity ? "font-semibold text-rose-700" : ""}>{total}/{route.bus.capacity}</span> : total },
              { label: "Stops", value: route.stops.length },
              { label: "Length", value: `${Math.max(0, ...rows.map((r) => r.distanceKm))} km (map path ${pts.length > 1 ? pathKm(pts.map((p) => ({ lat: p.lat!, lng: p.lng! }))) : 0} km)` },
              { label: "First pickup", value: route.stops[0]?.pickupTime ?? "—" },
              { label: "Fee mode", value: `${policies.transportFeeMode === "STOP" ? "Per stop" : "Distance slabs"} · ${policies.transportFeeBasis === "TERM" ? "per term" : "annual"}` },
            ]} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-3">
          <CardBody className="p-2 sm:p-2">
            {pts.length
              ? <TransportMap height={300} markers={pts.map((p) => ({ id: p.id, lat: p.lat!, lng: p.lng!, label: `${p.sequence}. ${p.name}`, sub: [p.pickupTime && `Pickup ${p.pickupTime}`, p.dropTime && `Drop ${p.dropTime}`].filter(Boolean).join(" · "), text: String(p.sequence) }))}
                  lines={[{ id: route.id, points: pts.map((p) => [p.lat!, p.lng!] as [number, number]), color: "#4f46e5" }]} />
              : <p className="px-4 py-16 text-center text-sm text-slate-500">Place stops on the map to see the route.</p>}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Stops" description="In pickup order" actions={canManage && <StopEditor routeId={route.id} others={rows} nextSeq={rows.length + 1} />} />
        <Table>
          <THead><tr><TH>#</TH><TH>Stop</TH><TH>Pickup</TH><TH>Drop</TH><TH align="right">Distance</TH>{canFees && <TH align="right">Fee</TH>}<TH align="right">Students</TH><TH>Location</TH>{canManage && <TH />}</tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={9} message="No stops yet." />}
            {rows.map((x, i) => (
              <TR key={x.id}>
                <TD>{x.sequence}</TD>
                <TD className="font-medium text-slate-900">{x.name}</TD>
                <TD>{x.pickupTime ?? "—"}</TD>
                <TD>{x.dropTime ?? "—"}</TD>
                <TD align="right">{x.distanceKm} km</TD>
                {canFees && <TD align="right">{money(fees[i])}{x.feeAmount === null && policies.transportFeeMode === "STOP" && <Badge tone="yellow" className="ml-1">not set</Badge>}</TD>}
                <TD align="right">{route.stops[i]._count.allocations}</TD>
                <TD>{x.lat !== null ? <span className="font-mono text-xs">{x.lat.toFixed(4)}, {x.lng!.toFixed(4)}</span> : <Badge tone="yellow">Not on map</Badge>}</TD>
                {canManage && (
                  <TD>
                    <div className="flex items-center gap-1">
                      <ActionButton action={moveStopAction} args={{ id: x.id, dir: "up" }} variant="ghost" disabled={i === 0} successMessage="Moved" title="Move up"><ArrowUp className="size-4" /></ActionButton>
                      <ActionButton action={moveStopAction} args={{ id: x.id, dir: "down" }} variant="ghost" disabled={i === rows.length - 1} successMessage="Moved" title="Move down"><ArrowDown className="size-4" /></ActionButton>
                      <StopEditor routeId={route.id} stop={x} others={rows} nextSeq={rows.length} />
                      <ActionButton action={deleteStopAction} args={{ id: x.id }} variant="ghost" confirm={`Delete stop ${x.name}?`} successMessage="Stop deleted" title="Delete"><Trash2 className="size-4 text-rose-600" /></ActionButton>
                    </div>
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <Card className="mt-5">
        <CardHeader title={`Route-wise student list (${allocs.length})`} actions={<FilterBar><FilterSelect name="stopId" label="All stops" options={route.stops.map((x) => ({ value: x.id, label: `${x.sequence}. ${x.name}` }))} /></FilterBar>} />
        <Table>
          <THead><tr><TH>Stop</TH><TH>Student</TH><TH>Class</TH><TH>Bus</TH><TH>Parent</TH><TH>Phone</TH></tr></THead>
          <TBody>
            {allocs.length === 0 && <EmptyRow colSpan={6} message="No students on this route." />}
            {allocs.map((a) => (
              <TR key={a.id}>
                <TD>{a.stop.sequence}. {a.stop.name}</TD>
                <TD><Link href={`/students/${a.studentId}`} className="font-medium hover:text-brand-700">{fullName(a.student)}</Link><span className="block text-xs text-slate-500">{a.student.admissionNo}</span></TD>
                <TD>{className(a.student.schoolClass, a.student.section)}</TD>
                <TD>{a.bus.busNo}</TD>
                <TD>{a.student.guardians[0]?.guardian.name ?? "—"}</TD>
                <TD>{a.student.guardians[0] ? <a href={`tel:${a.student.guardians[0].guardian.phone}`} className="text-brand-700">{a.student.guardians[0].guardian.phone}</a> : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

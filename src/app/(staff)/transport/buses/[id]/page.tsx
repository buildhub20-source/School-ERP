import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { automation } from "@/lib/automations/config";
import { className, fmtDate, fmtDateTime, fullName, money, number, today, toNum } from "@/lib/format";
import { DOC_LABELS, docStatus, serviceDueInfo } from "@/server/transport/helpers";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, EmptyRow, StatusBadge, Badge, Field, Select, FormGrid, LinkButton } from "@/components/ui";
import { ActionButton, ActionForm, ModalForm } from "@/components/ui/client";
import { assignCrewAction, saveBusAction, setBusActiveAction } from "../../actions";
import { BusFields } from "../../_components/fields";

export const metadata = { title: "Bus" };

export default async function BusPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("transport.view");
  const { id } = await params;
  const bus = await db.bus.findFirst({
    where: { id, branchId: user.branchId },
    include: {
      driver: true, attendant: true, routes: { include: { _count: { select: { stops: true } } } },
      documents: { where: { isCurrent: true }, orderBy: { expiryDate: "asc" } },
      maintenance: { orderBy: { date: "desc" }, take: 10 }, fuelLogs: { orderBy: { date: "desc" }, take: 10 },
      reminders: { where: { status: "OPEN" } },
      allocations: { where: { status: "ACTIVE" }, include: { stop: true, route: true, student: { include: { schoolClass: true, section: true } } }, orderBy: [{ stop: { sequence: "asc" } }, { student: { firstName: "asc" } }] },
    },
  });
  if (!bus) notFound();
  const canManage = hasPerm(user, "transport.manage");
  const [staff, docCfg, svcCfg, totals, fuelTotals] = await Promise.all([
    canManage ? db.transportStaff.findMany({ where: { branchId: user.branchId, isActive: true }, include: { drivesBus: true, attendsBus: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    automation("transport.docExpiry"), automation("transport.serviceDue"),
    db.maintenanceRecord.aggregate({ where: { busId: bus.id }, _sum: { cost: true } }),
    db.fuelLog.aggregate({ where: { busId: bus.id }, _sum: { cost: true, litres: true } }),
  ]);
  const t = today();
  const due = serviceDueInfo(bus, t, { daysAhead: Number(svcCfg.config.daysAhead ?? 7), kmAhead: Number(svcCfg.config.kmAhead ?? 500) });
  const filled = bus.allocations.length;
  const pct = bus.capacity ? Math.round((filled / bus.capacity) * 100) : 0;
  const busDocs = bus.documents;
  const driverDocs = bus.driverId ? await db.transportDocument.findMany({ where: { staffId: bus.driverId, isCurrent: true } }) : [];
  return (
    <>
      <PageHeader title={bus.busNo} description={`${bus.registrationNo}${bus.make ? ` · ${bus.make} ${bus.model ?? ""}` : ""}${bus.year ? ` (${bus.year})` : ""}`}
        breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Buses", href: "/transport/buses" }, { label: bus.busNo }]}
        actions={canManage && <>
          <ModalForm trigger="Edit" triggerVariant="secondary" icon={<Pencil className="size-4" />} title={`Edit ${bus.busNo}`} action={saveBusAction} size="lg" successMessage="Bus updated"><BusFields bus={bus} /></ModalForm>
          <ActionButton action={setBusActiveAction} args={{ id: bus.id, active: !bus.isActive }} size="md" variant={bus.isActive ? "danger" : "success"} confirm={bus.isActive ? `Deactivate ${bus.busNo}?` : undefined} successMessage={bus.isActive ? "Bus deactivated" : "Bus activated"}>{bus.isActive ? "Deactivate" : "Activate"}</ActionButton>
        </>} />
      {!bus.isActive && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">This bus is inactive.</p>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescList cols={3} items={[
                { label: "Capacity", value: `${bus.capacity} seats` },
                { label: "Seats filled", value: <span className={pct >= 100 ? "font-semibold text-rose-700" : ""}>{filled}/{bus.capacity} ({pct}%)</span> },
                { label: "Free seats", value: Math.max(0, bus.capacity - filled) },
                { label: "Odometer", value: `${number(bus.odometerKm)} km` },
                { label: "Last service", value: bus.lastServiceDate ? `${fmtDate(bus.lastServiceDate)}${bus.lastServiceKm !== null ? ` at ${number(bus.lastServiceKm)} km` : ""}` : "—" },
                { label: "Next service", value: <>{fmtDate(due.nextDate)} or {number(due.nextKm)} km {due.reason && <Badge tone={due.overdue ? "red" : "yellow"} className="ml-1">{due.overdue ? "Overdue" : "Due soon"}</Badge>}</> },
                { label: "Service interval", value: `${number(bus.serviceIntervalKm)} km / ${bus.serviceIntervalDays} days` },
                { label: "Maintenance cost (all time)", value: money(totals._sum.cost) },
                { label: "Fuel (all time)", value: `${number(toNum(fuelTotals._sum.litres))} L · ${money(fuelTotals._sum.cost)}` },
                { label: "Last location", value: bus.lastLocationAt ? fmtDateTime(bus.lastLocationAt) : "—" },
              ]} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Students (${filled})`} description="Active allocations on this bus" actions={canManage && <LinkButton href={`/transport/allocations?busId=${bus.id}`} size="sm">Manage allocations</LinkButton>} />
            <Table>
              <THead><tr><TH>Student</TH><TH>Class</TH><TH>Route</TH><TH>Stop</TH><TH>Pickup</TH></tr></THead>
              <TBody>
                {filled === 0 && <EmptyRow colSpan={5} message="No students allocated." />}
                {bus.allocations.map((a) => (
                  <TR key={a.id} highlight={a.capacityOverride ? "yellow" : undefined}>
                    <TD><Link href={`/students/${a.studentId}`} className="font-medium hover:text-brand-700">{fullName(a.student)}</Link><span className="block text-xs text-slate-500">{a.student.admissionNo}</span></TD>
                    <TD>{className(a.student.schoolClass, a.student.section)}</TD>
                    <TD>{a.route.code}</TD>
                    <TD>{a.stop.sequence}. {a.stop.name}</TD>
                    <TD>{a.stop.pickupTime ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          <Card>
            <CardHeader title="Maintenance" description="Latest 10 records" actions={<LinkButton href={`/transport/maintenance?busId=${bus.id}`} size="sm">All records & fuel</LinkButton>} />
            <Table>
              <THead><tr><TH>Date</TH><TH>Type</TH><TH>Description</TH><TH align="right">Odometer</TH><TH align="right">Cost</TH></tr></THead>
              <TBody>
                {bus.maintenance.length === 0 && <EmptyRow colSpan={5} message="No maintenance recorded." />}
                {bus.maintenance.map((m) => <TR key={m.id}><TD>{fmtDate(m.date)}</TD><TD><Badge tone={m.type === "SERVICE" ? "green" : m.type === "REPAIR" ? "red" : "gray"}>{m.type}</Badge></TD><TD>{m.description}{m.vendor && <span className="block text-xs text-slate-500">{m.vendor}</span>}</TD><TD align="right">{m.odometerKm ? number(m.odometerKm) : "—"}</TD><TD align="right">{money(m.cost)}</TD></TR>)}
              </TBody>
            </Table>
            {bus.fuelLogs.length > 0 && (
              <Table className="border-t border-slate-100">
                <THead><tr><TH>Fuel date</TH><TH align="right">Litres</TH><TH align="right">Odometer</TH><TH align="right">Cost</TH></tr></THead>
                <TBody>{bus.fuelLogs.map((f) => <TR key={f.id}><TD>{fmtDate(f.date)}</TD><TD align="right">{toNum(f.litres)}</TD><TD align="right">{f.odometerKm ? number(f.odometerKm) : "—"}</TD><TD align="right">{money(f.cost)}</TD></TR>)}</TBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Driver & attendant" />
            <CardBody>
              {canManage ? (
                <ActionForm action={assignCrewAction} submitLabel="Save crew" successMessage="Crew updated" extra={{ busId: bus.id }}>
                  <FormGrid cols={1}>
                    <Field label="Driver" hint="Moving someone here removes them from their current bus.">
                      <Select name="driverId" defaultValue={bus.driverId ?? ""} placeholder="— None —">
                        {staff.filter((s) => s.type === "DRIVER").map((s) => <option key={s.id} value={s.id}>{s.name}{s.drivesBus && s.drivesBus.id !== bus.id ? ` (on ${s.drivesBus.busNo})` : ""}</option>)}
                      </Select>
                    </Field>
                    <Field label="Attendant">
                      <Select name="attendantId" defaultValue={bus.attendantId ?? ""} placeholder="— None —">
                        {staff.filter((s) => s.type === "ATTENDANT").map((s) => <option key={s.id} value={s.id}>{s.name}{s.attendsBus && s.attendsBus.id !== bus.id ? ` (on ${s.attendsBus.busNo})` : ""}</option>)}
                      </Select>
                    </Field>
                  </FormGrid>
                </ActionForm>
              ) : (
                <DescList cols={1} items={[{ label: "Driver", value: bus.driver ? `${bus.driver.name} · ${bus.driver.phone}` : "—" }, { label: "Attendant", value: bus.attendant ? `${bus.attendant.name} · ${bus.attendant.phone}` : "—" }]} />
              )}
              {bus.driver && <p className="mt-3 text-xs text-slate-500">Licence: {bus.driver.licenseNo ?? "—"}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Routes" />
            <ul className="divide-y divide-slate-100 text-sm">
              {bus.routes.length === 0 && <li className="px-5 py-6 text-center text-slate-500">Not assigned to a route.</li>}
              {bus.routes.map((r) => <li key={r.id} className="flex justify-between px-5 py-2.5"><Link href={`/transport/routes/${r.id}`} className="font-medium hover:text-brand-700">{r.code} · {r.name}</Link><span className="text-slate-500">{r._count.stops} stops</span></li>)}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Documents" actions={<LinkButton href={`/transport/documents?busId=${bus.id}`} size="sm">Manage</LinkButton>} />
            <ul className="divide-y divide-slate-100 text-sm">
              {busDocs.length + driverDocs.length === 0 && <li className="px-5 py-6 text-center text-slate-500">No documents recorded.</li>}
              {[...busDocs, ...driverDocs].map((d) => {
                const st = docStatus(d.expiryDate, t, Number(docCfg.config.daysBefore ?? 30));
                return <li key={d.id} className="flex items-center justify-between gap-2 px-5 py-2.5"><span>{DOC_LABELS[d.type]}<span className="block text-xs text-slate-500">{d.number ?? ""} · expires {fmtDate(d.expiryDate)}</span></span><StatusBadge status={st} /></li>;
              })}
            </ul>
          </Card>

          {bus.reminders.length > 0 && (
            <Card>
              <CardHeader title="Open reminders" />
              <ul className="divide-y divide-slate-100 text-sm">{bus.reminders.map((r) => <li key={r.id} className="px-5 py-2.5">Service due {r.dueDate ? `by ${fmtDate(r.dueDate)}` : ""}{r.dueKm ? ` / ${number(r.dueKm)} km` : ""}</li>)}</ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

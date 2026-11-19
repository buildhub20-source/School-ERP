import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus, Fuel } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { automation } from "@/lib/automations/config";
import { fmtDate, fmtDateTime, isoDate, money, number, round2, today, toNum } from "@/lib/format";
import { serviceDueInfo } from "@/server/transport/helpers";
import { MAINTENANCE_TYPES } from "@/server/transport/service";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, Tabs, Badge, StatusBadge, Field, FormGrid, Input, Select, Textarea } from "@/components/ui";
import { FilterBar, FilterSelect, FilterDate, ModalForm, ActionButton } from "@/components/ui/client";
import { addFuelAction, addMaintenanceAction, completeReminderAction } from "../actions";

export const metadata = { title: "Maintenance & fuel" };

const TABS = ["due", "records", "fuel", "reminders", "costs"] as const;

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("transport.view");
  const s = await searchParams;
  const tab = (TABS as readonly string[]).includes(s.tab) ? s.tab : "due";
  const { page, pageSize, skip, take } = pageParams(s);
  const branchId = user.branchId;
  const busId = sp(s, "busId");
  const from = sp(s, "from"), to = sp(s, "to");
  const dateF = from || to ? { ...(from ? { gte: new Date(from + "T00:00:00Z") } : {}), ...(to ? { lte: new Date(to + "T00:00:00Z") } : {}) } : undefined;
  const busWhere = { branchId, ...(busId ? { id: busId } : {}) };
  const buses = await db.bus.findMany({ where: { branchId }, orderBy: { busNo: "asc" } });
  const canManage = hasPerm(user, "transport.manage");
  const qs = (t: string) => { const p = new URLSearchParams(Object.entries(s).filter(([k, v]) => typeof v === "string" && k !== "page" && k !== "tab")); p.set("tab", t); return `/transport/maintenance?${p}`; };
  const busOpts = buses.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.busNo} · {b.registrationNo} ({number(b.odometerKm)} km)</option>);

  let body: React.ReactNode = null;
  if (tab === "due") {
    const cfg = await automation("transport.serviceDue");
    const w = { daysAhead: Number(cfg.config.daysAhead ?? 7), kmAhead: Number(cfg.config.kmAhead ?? 500) };
    const list = await db.bus.findMany({ where: { ...busWhere, isActive: true }, include: { reminders: { where: { status: "OPEN" } } }, orderBy: { busNo: "asc" } });
    const t = today();
    body = (
      <Table>
        <THead><tr><TH>Bus</TH><TH>Last service</TH><TH align="right">Odometer</TH><TH>Next by date</TH><TH align="right">Next by km</TH><TH>Status</TH></tr></THead>
        <TBody>
          {list.length === 0 && <EmptyRow colSpan={6} />}
          {list.map((b) => {
            const i = serviceDueInfo(b, t, w);
            return (
              <TR key={b.id} highlight={i.overdue ? "red" : i.reason ? "yellow" : undefined}>
                <TD><Link href={`/transport/buses/${b.id}`} className="font-medium hover:text-brand-700">{b.busNo}</Link></TD>
                <TD>{fmtDate(b.lastServiceDate)}{b.lastServiceKm !== null && <span className="block text-xs text-slate-500">at {number(b.lastServiceKm)} km</span>}</TD>
                <TD align="right">{number(b.odometerKm)} km</TD>
                <TD>{fmtDate(i.nextDate)}<span className="block text-xs text-slate-500">every {b.serviceIntervalDays} days</span></TD>
                <TD align="right">{number(i.nextKm)} km<span className="block text-xs text-slate-500">every {number(b.serviceIntervalKm)} km</span></TD>
                <TD>{i.reason ? <><Badge tone={i.overdue ? "red" : "yellow"}>{i.overdue ? "Overdue" : "Due soon"}</Badge><span className="block text-xs text-slate-500">{i.reason}</span></> : <Badge tone="green">OK</Badge>}{b.reminders.length > 0 && <span className="block text-xs text-amber-700">Reminder open</span>}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    );
  } else if (tab === "records") {
    const type = sp(s, "type");
    const where: Prisma.MaintenanceRecordWhereInput = { bus: busWhere, ...(dateF ? { date: dateF } : {}), ...(type ? { type } : {}) };
    const [total, rows, sum] = await Promise.all([
      db.maintenanceRecord.count({ where }),
      db.maintenanceRecord.findMany({ where, include: { bus: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip, take }),
      db.maintenanceRecord.aggregate({ where, _sum: { cost: true } }),
    ]);
    body = (
      <>
        <Table>
          <THead><tr><TH>Date</TH><TH>Bus</TH><TH>Type</TH><TH>Description</TH><TH>Vendor</TH><TH align="right">Odometer</TH><TH align="right">Cost</TH></tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={7} />}
            {rows.map((m) => <TR key={m.id}><TD>{fmtDate(m.date)}</TD><TD>{m.bus.busNo}</TD><TD><Badge tone={m.type === "SERVICE" ? "green" : m.type === "REPAIR" ? "red" : "gray"}>{m.type}</Badge></TD><TD>{m.description}</TD><TD>{m.vendor ?? "—"}</TD><TD align="right">{m.odometerKm ? number(m.odometerKm) : "—"}</TD><TD align="right">{money(m.cost)}</TD></TR>)}
            {rows.length > 0 && <TR><TD colSpan={6} className="text-right font-semibold">Total ({total} records)</TD><TD align="right" className="font-semibold">{money(sum._sum.cost)}</TD></TR>}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/transport/maintenance" />
      </>
    );
  } else if (tab === "fuel") {
    const where: Prisma.FuelLogWhereInput = { bus: busWhere, ...(dateF ? { date: dateF } : {}) };
    const [total, rows, sum] = await Promise.all([
      db.fuelLog.count({ where }),
      db.fuelLog.findMany({ where, include: { bus: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip, take }),
      db.fuelLog.aggregate({ where, _sum: { cost: true, litres: true } }),
    ]);
    body = (
      <>
        <Table>
          <THead><tr><TH>Date</TH><TH>Bus</TH><TH align="right">Litres</TH><TH align="right">Rate / L</TH><TH align="right">Odometer</TH><TH align="right">Cost</TH></tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={6} />}
            {rows.map((f) => <TR key={f.id}><TD>{fmtDate(f.date)}</TD><TD>{f.bus.busNo}</TD><TD align="right">{toNum(f.litres)}</TD><TD align="right">{money(round2(toNum(f.cost) / Math.max(0.01, toNum(f.litres))))}</TD><TD align="right">{f.odometerKm ? number(f.odometerKm) : "—"}</TD><TD align="right">{money(f.cost)}</TD></TR>)}
            {rows.length > 0 && <TR><TD colSpan={2} className="font-semibold">Total</TD><TD align="right" className="font-semibold">{number(toNum(sum._sum.litres))} L</TD><TD /><TD /><TD align="right" className="font-semibold">{money(sum._sum.cost)}</TD></TR>}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/transport/maintenance" />
      </>
    );
  } else if (tab === "reminders") {
    const st = sp(s, "status") ?? "OPEN";
    const where: Prisma.MaintenanceReminderWhereInput = { bus: busWhere, ...(st === "ALL" ? {} : { status: st }) };
    const [total, rows] = await Promise.all([db.maintenanceReminder.count({ where }), db.maintenanceReminder.findMany({ where, include: { bus: true }, orderBy: [{ status: "desc" }, { createdAt: "desc" }], skip, take })]);
    body = (
      <>
        <Table>
          <THead><tr><TH>Bus</TH><TH>Reason</TH><TH>Due date</TH><TH align="right">Due km</TH><TH>Created</TH><TH>Status</TH>{canManage && <TH />}</tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={7} message="No reminders." />}
            {rows.map((r) => (
              <TR key={r.id}>
                <TD><Link href={`/transport/buses/${r.bus.id}`} className="font-medium hover:text-brand-700">{r.bus.busNo}</Link></TD>
                <TD>{r.reason === "DATE_KM" ? "Date & km" : r.reason === "KM" ? "Kilometres" : "Date"}</TD>
                <TD>{fmtDate(r.dueDate)}</TD>
                <TD align="right">{r.dueKm ? number(r.dueKm) : "—"}</TD>
                <TD>{fmtDateTime(r.createdAt)}</TD>
                <TD><StatusBadge status={r.status} />{r.doneAt && <span className="block text-xs text-slate-500">{fmtDateTime(r.doneAt)}</span>}</TD>
                {canManage && <TD>{r.status === "OPEN" && <ActionButton action={completeReminderAction} args={{ id: r.id }} confirm="Mark this reminder as done?" successMessage="Reminder closed">Mark done</ActionButton>}</TD>}
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/transport/maintenance" />
        <p className="px-4 pb-3 text-xs text-slate-500">Recording a SERVICE closes the bus&apos;s open reminders automatically.</p>
      </>
    );
  } else {
    const [m, f] = await Promise.all([
      db.maintenanceRecord.groupBy({ by: ["busId", "type"], where: { bus: busWhere, ...(dateF ? { date: dateF } : {}) }, _sum: { cost: true } }),
      db.fuelLog.groupBy({ by: ["busId"], where: { bus: busWhere, ...(dateF ? { date: dateF } : {}) }, _sum: { cost: true, litres: true } }),
    ]);
    const rows = buses.filter((b) => !busId || b.id === busId).map((b) => {
      const c = (t: string) => toNum(m.find((x) => x.busId === b.id && x.type === t)?._sum.cost);
      const fuel = f.find((x) => x.busId === b.id);
      const repair = round2(c("REPAIR") + c("TYRES") + c("OTHER"));
      return { b, service: c("SERVICE"), repair, litres: toNum(fuel?._sum.litres), fuel: toNum(fuel?._sum.cost), total: round2(c("SERVICE") + repair + toNum(fuel?._sum.cost)) };
    });
    const tot = rows.reduce((a, r) => ({ service: a.service + r.service, repair: a.repair + r.repair, fuel: a.fuel + r.fuel, total: a.total + r.total }), { service: 0, repair: 0, fuel: 0, total: 0 });
    body = (
      <Table>
        <THead><tr><TH>Bus</TH><TH align="right">Service</TH><TH align="right">Repairs, tyres & other</TH><TH align="right">Fuel (L)</TH><TH align="right">Fuel cost</TH><TH align="right">Total</TH></tr></THead>
        <TBody>
          {rows.map((r) => <TR key={r.b.id}><TD className="font-medium">{r.b.busNo}</TD><TD align="right">{money(r.service)}</TD><TD align="right">{money(r.repair)}</TD><TD align="right">{number(r.litres)}</TD><TD align="right">{money(r.fuel)}</TD><TD align="right" className="font-semibold">{money(r.total)}</TD></TR>)}
          <TR><TD className="font-semibold">Total</TD><TD align="right" className="font-semibold">{money(tot.service)}</TD><TD align="right" className="font-semibold">{money(tot.repair)}</TD><TD /><TD align="right" className="font-semibold">{money(tot.fuel)}</TD><TD align="right" className="font-semibold">{money(tot.total)}</TD></TR>
        </TBody>
      </Table>
    );
  }

  return (
    <>
      <PageHeader title="Maintenance & fuel" description="Service due by date or km, repair costs and fuel per bus" breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Maintenance" }]}
        actions={canManage && <>
          <ModalForm trigger="Fuel" triggerVariant="secondary" icon={<Fuel className="size-4" />} title="Add fuel log" action={addFuelAction} successMessage="Fuel logged">
            <Field label="Bus" required><Select name="busId" defaultValue={busId ?? ""} placeholder="Choose bus" required>{busOpts}</Select></Field>
            <FormGrid>
              <Field label="Date" required><Input type="date" name="date" defaultValue={isoDate()} max={isoDate()} required /></Field>
              <Field label="Litres" required><Input type="number" step="0.01" min="0.01" name="litres" required /></Field>
              <Field label="Cost" required><Input type="number" step="0.01" min="0" name="cost" required /></Field>
              <Field label="Odometer (km)"><Input type="number" min="0" name="odometerKm" /></Field>
            </FormGrid>
          </ModalForm>
          <ModalForm trigger="Maintenance" icon={<Plus className="size-4" />} title="Record maintenance" description="A SERVICE updates the bus's last service date/km and closes open reminders." action={addMaintenanceAction} successMessage="Maintenance recorded">
            <FormGrid>
              <Field label="Bus" required><Select name="busId" defaultValue={busId ?? ""} placeholder="Choose bus" required>{busOpts}</Select></Field>
              <Field label="Type" required><Select name="type" defaultValue="SERVICE">{MAINTENANCE_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}</Select></Field>
              <Field label="Date" required><Input type="date" name="date" defaultValue={isoDate()} max={isoDate()} required /></Field>
              <Field label="Odometer (km)"><Input type="number" min="0" name="odometerKm" /></Field>
              <Field label="Cost" required><Input type="number" step="0.01" min="0" name="cost" required /></Field>
              <Field label="Vendor / garage"><Input name="vendor" /></Field>
            </FormGrid>
            <Field label="Description" required><Textarea name="description" required /></Field>
          </ModalForm>
        </>} />
      <Tabs active={qs(tab)} tabs={[{ href: qs("due"), label: "Service due" }, { href: qs("records"), label: "Maintenance records" }, { href: qs("fuel"), label: "Fuel log" }, { href: qs("reminders"), label: "Reminders" }, { href: qs("costs"), label: "Cost per bus" }]} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <input type="hidden" name="tab" value={tab} />
            <FilterSelect name="busId" label="All buses" options={buses.map((b) => ({ value: b.id, label: b.busNo }))} />
            {tab === "reminders" && <FilterSelect name="status" label="Open" options={[{ value: "DONE", label: "Done" }, { value: "ALL", label: "All" }]} />}
            {tab === "records" && <FilterSelect name="type" label="All types" options={MAINTENANCE_TYPES.map((t) => ({ value: t, label: t }))} />}
            {(tab === "records" || tab === "fuel" || tab === "costs") && <><FilterDate name="from" label="From" /><FilterDate name="to" label="To" /></>}
          </FilterBar>
        </div>
        {body}
      </Card>
    </>
  );
}

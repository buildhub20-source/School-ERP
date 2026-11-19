import Link from "next/link";
import { Bus, Route as RouteIcon, Users, Armchair, FileWarning, Wrench } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { fmtDate, fmtDateTime, today } from "@/lib/format";
import { transportDashboard } from "@/server/transport/dashboard";
import { daysUntil } from "@/server/transport/helpers";
import { PageHeader, Card, CardHeader, StatCard, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, LinkButton } from "@/components/ui";
import { hasPerm } from "@/lib/permissions";
import { UserPlus, Bus as BusIcon } from "lucide-react";

export const metadata = { title: "Transport" };

export default async function TransportOverview() {
  const user = await requireUser("transport.view");
  const branchId = user.branchId;
  const [d, buses, trips] = await Promise.all([
    transportDashboard(branchId),
    db.bus.findMany({ where: { branchId, isActive: true }, include: { driver: true, routes: { where: { isActive: true } }, _count: { select: { allocations: { where: { status: "ACTIVE" } } } } }, orderBy: { busNo: "asc" } }),
    db.busTrip.findMany({ where: { endedAt: null, bus: { branchId } }, include: { bus: true }, orderBy: { startedAt: "desc" } }),
  ]);
  const t = today();
  return (
    <>
      <PageHeader title="Transport" description="Buses, routes, seats and alerts at a glance."
        actions={hasPerm(user, "transport.manage") && <>
          <LinkButton href="/transport/buses"><BusIcon className="size-4" />Buses</LinkButton>
          <LinkButton href="/transport/allocations" variant="primary"><UserPlus className="size-4" />Assign student</LinkButton>
        </>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Buses" value={d.buses} href="/transport/buses" icon={<Bus className="size-5" />} />
        <StatCard label="Routes" value={d.routes} href="/transport/routes" icon={<RouteIcon className="size-5" />} tone="blue" />
        <StatCard label="Seats filled" value={`${d.seatsFilled}/${d.seats}`} hint={d.seats ? `${Math.round((d.seatsFilled / d.seats) * 100)}% occupancy` : undefined} icon={<Armchair className="size-5" />} tone={d.seats && d.seatsFilled >= d.seats ? "red" : "green"} />
        <StatCard label="Students" value={d.studentsUsingTransport} href="/transport/allocations" icon={<Users className="size-5" />} tone="gray" />
        <StatCard label="Docs expiring" value={d.docsExpiringSoon.length} href="/transport/documents?status=ATTENTION" icon={<FileWarning className="size-5" />} tone={d.docsExpiringSoon.length ? "yellow" : "green"} />
        <StatCard label="Service due" value={d.busesDueForService.length} href="/transport/maintenance?tab=due" icon={<Wrench className="size-5" />} tone={d.busesDueForService.length ? "red" : "green"} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Bus occupancy" description="Seats filled vs capacity" />
          <Table>
            <THead><tr><TH>Bus</TH><TH>Routes</TH><TH>Driver</TH><TH align="right">Filled</TH><TH>Occupancy</TH></tr></THead>
            <TBody>
              {buses.length === 0 && <EmptyRow colSpan={5} message="No buses yet." />}
              {buses.map((b) => {
                const pct = b.capacity ? Math.round((b._count.allocations / b.capacity) * 100) : 0;
                return (
                  <TR key={b.id} highlight={pct >= 100 ? "red" : pct >= 90 ? "yellow" : undefined}>
                    <TD><Link href={`/transport/buses/${b.id}`} className="font-medium text-slate-900 hover:text-brand-700">{b.busNo}</Link><span className="block text-xs text-slate-500">{b.registrationNo}</span></TD>
                    <TD>{b.routes.map((r) => r.code).join(", ") || "—"}</TD>
                    <TD>{b.driver?.name ?? <span className="text-slate-400">Not assigned</span>}</TD>
                    <TD align="right">{b._count.allocations}/{b.capacity}</TD>
                    <TD><div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100"><div className={pct >= 100 ? "h-full bg-rose-500" : pct >= 90 ? "h-full bg-amber-500" : "h-full bg-emerald-500"} style={{ width: `${Math.min(100, pct)}%` }} /></div><span className="text-xs text-slate-500">{pct}%</span></TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Trips running now" actions={<Link href="/transport/live" className="text-sm text-brand-700 hover:underline">Live map</Link>} />
            <ul className="divide-y divide-slate-100 text-sm">
              {trips.length === 0 && <li className="px-5 py-6 text-center text-slate-500">No trips running.</li>}
              {trips.map((tr) => <li key={tr.id} className="flex justify-between px-5 py-2.5"><span className="font-medium">{tr.bus.busNo}</span><span className="text-slate-500">{tr.type === "PICKUP" ? "Pickup" : "Drop"} · since {fmtDateTime(tr.startedAt)}</span></li>)}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Documents expiring soon" />
            <ul className="divide-y divide-slate-100 text-sm">
              {d.docsExpiringSoon.length === 0 && <li className="px-5 py-6 text-center text-slate-500">All documents are valid.</li>}
              {d.docsExpiringSoon.slice(0, 8).map((x) => {
                const left = daysUntil(x.expiryDate, t);
                return <li key={x.id} className="flex items-center justify-between gap-2 px-5 py-2.5"><span><span className="font-medium">{x.busNo}</span> · {x.type}<span className="block text-xs text-slate-500">{fmtDate(x.expiryDate)}</span></span><Badge tone={left < 0 ? "red" : "yellow"}>{left < 0 ? "Expired" : `${left} days`}</Badge></li>;
              })}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Buses due for service" />
            <ul className="divide-y divide-slate-100 text-sm">
              {d.busesDueForService.length === 0 && <li className="px-5 py-6 text-center text-slate-500">No service due.</li>}
              {d.busesDueForService.map((x) => <li key={x.busId} className="px-5 py-2.5"><Link href={`/transport/buses/${x.busId}`} className="font-medium hover:text-brand-700">{x.busNo}</Link><span className="block text-xs text-slate-500">{x.reason}</span></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

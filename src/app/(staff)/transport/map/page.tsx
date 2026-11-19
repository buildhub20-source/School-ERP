import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { toNum } from "@/lib/format";
import { pathKm, ROUTE_COLORS } from "@/server/transport/helpers";
import { PageHeader, Card, CardHeader, CardBody, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge } from "@/components/ui";
import { TransportMap, type MapMarker, type MapLine } from "../_components/map";

export const metadata = { title: "Route map" };

/** Route optimisation view: every route's stops on one map, with load vs capacity and length so problem routes stand out. */
export default async function RouteMapPage() {
  const user = await requireUser("transport.view");
  const routes = await db.route.findMany({
    where: { branchId: user.branchId, isActive: true },
    include: { bus: true, stops: { orderBy: { sequence: "asc" }, include: { _count: { select: { allocations: { where: { status: "ACTIVE" } } } } } }, _count: { select: { allocations: { where: { status: "ACTIVE" } } } } },
    orderBy: { code: "asc" },
  });
  const rows = routes.map((r, i) => {
    const pts = r.stops.filter((s) => s.lat !== null && s.lng !== null);
    const mapKm = pathKm(pts.map((s) => ({ lat: s.lat!, lng: s.lng! })));
    const km = Math.max(mapKm, ...r.stops.map((s) => toNum(s.distanceKm)));
    const first = r.stops.find((s) => s.pickupTime)?.pickupTime ?? null;
    const last = [...r.stops].reverse().find((s) => s.pickupTime)?.pickupTime ?? null;
    const mins = first && last ? (Number(last.slice(0, 2)) * 60 + Number(last.slice(3))) - (Number(first.slice(0, 2)) * 60 + Number(first.slice(3))) : null;
    return { r, color: ROUTE_COLORS[i % ROUTE_COLORS.length], pts, km, students: r._count.allocations, capacity: r.bus?.capacity ?? 0, mins };
  });
  const avgKm = rows.length ? rows.reduce((s, x) => s + x.km, 0) / rows.length : 0;
  const flagged = (x: (typeof rows)[number]) => ({ over: x.capacity > 0 && x.students > x.capacity, near: x.capacity > 0 && x.students >= x.capacity * 0.9 && x.students <= x.capacity, long: rows.length > 1 && x.km > avgKm * 1.4, noBus: !x.r.bus });
  const markers: MapMarker[] = rows.flatMap((x) => x.pts.map((s) => ({ id: s.id, lat: s.lat!, lng: s.lng!, color: x.color, text: String(s.sequence), label: `${x.r.code} · ${s.sequence}. ${s.name}`, sub: `${s._count.allocations} students${s.pickupTime ? ` · pickup ${s.pickupTime}` : ""} · ${toNum(s.distanceKm)} km`, highlight: flagged(x).over })));
  const lines: MapLine[] = rows.filter((x) => x.pts.length > 1).map((x) => ({ id: x.r.id, color: x.color, points: x.pts.map((s) => [s.lat!, s.lng!] as [number, number]), dashed: flagged(x).long }));
  return (
    <>
      <PageHeader title="Route map" description="All routes' stops plotted together — spot overloaded or long routes." breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Route map" }]} />
      <Card>
        <CardBody className="p-2 sm:p-2">
          {markers.length ? <TransportMap markers={markers} lines={lines} height={480} /> : <p className="px-4 py-16 text-center text-sm text-slate-500">No stops have a location yet. Place stops on the map from each route&apos;s page.</p>}
          <p className="px-2 pt-2 text-xs text-slate-500">Dashed line = route much longer than average. Amber stops = route over capacity.</p>
        </CardBody>
      </Card>
      <Card className="mt-5">
        <CardHeader title="Route load and length" description={`Average route length ${Math.round(avgKm * 10) / 10} km`} />
        <Table>
          <THead><tr><TH>Route</TH><TH>Bus</TH><TH align="right">Stops</TH><TH align="right">Length</TH><TH align="right">Pickup span</TH><TH align="right">Students / seats</TH><TH>Flags</TH></tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={7} message="No routes yet." />}
            {rows.map((x) => {
              const f = flagged(x);
              return (
                <TR key={x.r.id} highlight={f.over ? "red" : f.long || f.near ? "yellow" : undefined}>
                  <TD><span className="mr-2 inline-block size-3 rounded-full align-middle" style={{ background: x.color }} /><Link href={`/transport/routes/${x.r.id}`} className="font-medium hover:text-brand-700">{x.r.code} · {x.r.name}</Link></TD>
                  <TD>{x.r.bus?.busNo ?? "—"}</TD>
                  <TD align="right">{x.r.stops.length}</TD>
                  <TD align="right">{Math.round(x.km * 10) / 10} km</TD>
                  <TD align="right">{x.mins !== null ? `${x.mins} min` : "—"}</TD>
                  <TD align="right">{x.students}{x.capacity ? `/${x.capacity}` : ""}</TD>
                  <TD className="space-x-1">
                    {f.over && <Badge tone="red">Overloaded</Badge>}
                    {f.near && <Badge tone="yellow">Nearly full</Badge>}
                    {f.long && <Badge tone="yellow">Long route</Badge>}
                    {f.noBus && <Badge tone="gray">No bus</Badge>}
                    {!f.over && !f.near && !f.long && !f.noBus && <Badge tone="green">OK</Badge>}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { toNum } from "@/lib/format";
import { pathKm } from "@/server/transport/helpers";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge, Field, FormGrid, Input, Select, Textarea, LinkButton } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { CreateModal } from "../_components/create-modal";
import { saveRouteAction } from "../actions";

export const metadata = { title: "Routes & stops" };

export default async function RoutesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("transport.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const q = sp(s, "q");
  const status = sp(s, "status") ?? "ACTIVE";
  const where: Prisma.RouteWhereInput = {
    branchId: user.branchId, ...(status === "ALL" ? {} : { isActive: status === "ACTIVE" }), ...(sp(s, "busId") ? { busId: sp(s, "busId") } : {}),
    ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { stops: { some: { name: { contains: q, mode: "insensitive" } } } }] } : {}),
  };
  const [total, routes, buses] = await Promise.all([
    db.route.count({ where }),
    db.route.findMany({ where, include: { bus: true, stops: { orderBy: { sequence: "asc" } }, _count: { select: { allocations: { where: { status: "ACTIVE" } } } } }, orderBy: { code: "asc" }, skip, take }),
    db.bus.findMany({ where: { branchId: user.branchId, isActive: true }, orderBy: { busNo: "asc" } }),
  ]);
  const canManage = hasPerm(user, "transport.manage");
  return (
    <>
      <PageHeader title="Routes & stops" description={`${total} route${total === 1 ? "" : "s"}`} breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Routes" }]}
        actions={<>
          <LinkButton href="/transport/map">Route map</LinkButton>
          {canManage && <CreateModal redirectBase="/transport/routes/" trigger="Add route" icon={<Plus className="size-4" />} title="Add route" action={saveRouteAction} successMessage="Route added">
            <FormGrid>
              <Field label="Code" required><Input name="code" placeholder="R6" required /></Field>
              <Field label="Name" required><Input name="name" placeholder="Anna Nagar – School" required /></Field>
            </FormGrid>
            <Field label="Bus"><Select name="busId" placeholder="— Assign later —">{buses.map((b) => <option key={b.id} value={b.id}>{b.busNo} ({b.capacity} seats)</option>)}</Select></Field>
            <Field label="Description"><Textarea name="description" /></Field>
          </CreateModal>}
        </>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Route code, name or stop" />
            <FilterSelect name="busId" label="All buses" options={buses.map((b) => ({ value: b.id, label: b.busNo }))} />
            <FilterSelect name="status" label="Active" options={[{ value: "INACTIVE", label: "Inactive" }, { value: "ALL", label: "All" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Route</TH><TH>Bus</TH><TH align="right">Stops</TH><TH align="right">Length</TH><TH>First pickup</TH><TH align="right">Students</TH><TH>Status</TH></tr></THead>
          <TBody>
            {routes.length === 0 && <EmptyRow colSpan={7} />}
            {routes.map((r) => {
              const pts = r.stops.filter((x) => x.lat !== null && x.lng !== null).map((x) => ({ lat: x.lat!, lng: x.lng! }));
              const maxKm = Math.max(0, ...r.stops.map((x) => toNum(x.distanceKm)));
              const over = r.bus && r._count.allocations > r.bus.capacity;
              return (
                <TR key={r.id} highlight={over ? "red" : undefined}>
                  <TD><Link href={`/transport/routes/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">{r.code} · {r.name}</Link>{r.description && <span className="block text-xs text-slate-500">{r.description}</span>}</TD>
                  <TD>{r.bus ? <Link href={`/transport/buses/${r.bus.id}`} className="hover:text-brand-700">{r.bus.busNo}</Link> : <span className="text-amber-700">No bus</span>}</TD>
                  <TD align="right">{r.stops.length}</TD>
                  <TD align="right">{maxKm ? `${maxKm} km` : pts.length > 1 ? `${pathKm(pts)} km` : "—"}</TD>
                  <TD>{r.stops[0]?.pickupTime ?? "—"}</TD>
                  <TD align="right">{r._count.allocations}{r.bus ? `/${r.bus.capacity}` : ""}</TD>
                  <TD><StatusBadge status={r.isActive ? "ACTIVE" : "ENDED"} label={r.isActive ? "Active" : "Inactive"} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/transport/routes" />
      </Card>
    </>
  );
}

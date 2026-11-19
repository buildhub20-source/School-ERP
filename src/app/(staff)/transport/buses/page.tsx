import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { number } from "@/lib/format";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { CreateModal } from "../_components/create-modal";
import { saveBusAction } from "../actions";
import { BusFields } from "../_components/fields";

export const metadata = { title: "Buses" };

export default async function BusesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("transport.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const q = sp(s, "q");
  const status = sp(s, "status") ?? "ACTIVE";
  const where: Prisma.BusWhereInput = {
    branchId: user.branchId,
    ...(status === "ALL" ? {} : { isActive: status === "ACTIVE" }),
    ...(q ? { OR: [{ busNo: { contains: q, mode: "insensitive" } }, { registrationNo: { contains: q, mode: "insensitive" } }, { driver: { name: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [total, buses] = await Promise.all([
    db.bus.count({ where }),
    db.bus.findMany({ where, include: { driver: true, attendant: true, routes: { where: { isActive: true } }, _count: { select: { allocations: { where: { status: "ACTIVE" } } } } }, orderBy: { busNo: "asc" }, skip, take }),
  ]);
  const canManage = hasPerm(user, "transport.manage");
  return (
    <>
      <PageHeader title="Buses" description={`${total} bus${total === 1 ? "" : "es"}`} breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Buses" }]}
        actions={canManage && <CreateModal redirectBase="/transport/buses/" trigger="Add bus" icon={<Plus className="size-4" />} title="Add bus" action={saveBusAction} size="lg" successMessage="Bus added"><BusFields /></CreateModal>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Bus, registration or driver" />
            <FilterSelect name="status" label="Active" options={[{ value: "INACTIVE", label: "Inactive" }, { value: "ALL", label: "All" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Bus</TH><TH>Routes</TH><TH>Driver</TH><TH>Attendant</TH><TH align="right">Seats filled</TH><TH align="right">Odometer</TH><TH>Status</TH></tr></THead>
          <TBody>
            {buses.length === 0 && <EmptyRow colSpan={7} />}
            {buses.map((b) => {
              const full = b._count.allocations >= b.capacity;
              return (
                <TR key={b.id} highlight={full ? "red" : undefined}>
                  <TD><Link href={`/transport/buses/${b.id}`} className="font-medium text-slate-900 hover:text-brand-700">{b.busNo}</Link><span className="block font-mono text-xs text-slate-500">{b.registrationNo}</span></TD>
                  <TD>{b.routes.map((r) => <Link key={r.id} href={`/transport/routes/${r.id}`} className="mr-2 hover:text-brand-700">{r.code}</Link>)}{!b.routes.length && "—"}</TD>
                  <TD>{b.driver ? <>{b.driver.name}<span className="block text-xs text-slate-500">{b.driver.phone}</span></> : <span className="text-slate-400">—</span>}</TD>
                  <TD>{b.attendant ? <>{b.attendant.name}<span className="block text-xs text-slate-500">{b.attendant.phone}</span></> : <span className="text-slate-400">—</span>}</TD>
                  <TD align="right"><span className={full ? "font-semibold text-rose-700" : ""}>{b._count.allocations}/{b.capacity}</span></TD>
                  <TD align="right">{number(b.odometerKm)} km</TD>
                  <TD><StatusBadge status={b.isActive ? "ACTIVE" : "ENDED"} label={b.isActive ? "Active" : "Inactive"} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/transport/buses" />
      </Card>
    </>
  );
}

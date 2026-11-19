import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { className, fmtDateTime, fullName, isoDate } from "@/lib/format";
import { PageHeader, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, Badge } from "@/components/ui";
import { FilterBar, FilterSelect, FilterDate } from "@/components/ui/client";

export const metadata = { title: "Boarding attendance" };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("transport.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s, 50);
  const branchId = user.branchId;
  const date = sp(s, "date") ?? isoDate();
  // IST day window
  const start = new Date(new Date(date + "T00:00:00.000Z").getTime() - 330 * 60000);
  const end = new Date(start.getTime() + 86400000);
  const busId = sp(s, "busId"), type = sp(s, "type"), tripId = sp(s, "tripId"), event = sp(s, "event");
  const tripWhere: Prisma.BusTripWhereInput = { bus: { branchId }, startedAt: { gte: start, lt: end }, ...(busId ? { busId } : {}), ...(type ? { type } : {}) };
  const where: Prisma.BoardingRecordWhereInput = { trip: tripWhere, ...(tripId ? { tripId } : {}), ...(event ? { event } : {}) };
  const [buses, trips, total, records] = await Promise.all([
    db.bus.findMany({ where: { branchId }, orderBy: { busNo: "asc" } }),
    db.busTrip.findMany({ where: tripWhere, include: { bus: true, boardings: { select: { studentId: true, event: true } } }, orderBy: { startedAt: "asc" } }),
    db.boardingRecord.count({ where }),
    db.boardingRecord.findMany({ where, include: { trip: { include: { bus: true } }, student: { include: { schoolClass: true, section: true } } }, orderBy: { at: "desc" }, skip, take }),
  ]);
  const markers = await db.user.findMany({ where: { id: { in: [...new Set(records.map((r) => r.markedById).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
  const allocated = await db.transportAllocation.groupBy({ by: ["busId"], where: { status: "ACTIVE", busId: { in: trips.map((t) => t.busId) } }, _count: true });
  return (
    <>
      <PageHeader title="Boarding attendance" description="Students marked on and off the bus by the attendant (tap or ID-card scan)." breadcrumbs={[{ label: "Transport", href: "/transport" }, { label: "Attendance" }]} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <FilterDate name="date" label="Date" />
            <FilterSelect name="busId" label="All buses" options={buses.map((b) => ({ value: b.id, label: b.busNo }))} />
            <FilterSelect name="type" label="Pickup & drop" options={[{ value: "PICKUP", label: "Pickup" }, { value: "DROP", label: "Drop" }]} />
            <FilterSelect name="event" label="Boarded & got off" options={[{ value: "BOARDED", label: "Boarded" }, { value: "ALIGHTED", label: "Got off" }]} />
            {tripId && <input type="hidden" name="tripId" value={tripId} />}
          </FilterBar>
        </div>
        <CardHeader title={`Trips on ${date}`} />
        <Table>
          <THead><tr><TH>Bus</TH><TH>Trip</TH><TH>Started</TH><TH>Ended</TH><TH align="right">Boarded</TH><TH align="right">Got off</TH><TH align="right">On bus list</TH><TH /></tr></THead>
          <TBody>
            {trips.length === 0 && <EmptyRow colSpan={8} message="No trips on this date." />}
            {trips.map((t) => {
              const boarded = new Set(t.boardings.filter((b) => b.event === "BOARDED").map((b) => b.studentId)).size;
              const off = new Set(t.boardings.filter((b) => b.event === "ALIGHTED").map((b) => b.studentId)).size;
              const qs = new URLSearchParams({ date, tripId: t.id });
              return (
                <TR key={t.id} highlight={tripId === t.id ? "green" : undefined}>
                  <TD className="font-medium">{t.bus.busNo}</TD>
                  <TD><Badge tone={t.type === "PICKUP" ? "blue" : "purple"}>{t.type === "PICKUP" ? "Pickup" : "Drop"}</Badge></TD>
                  <TD>{fmtDateTime(t.startedAt)}</TD>
                  <TD>{t.endedAt ? fmtDateTime(t.endedAt) : <Badge tone="green">Running</Badge>}</TD>
                  <TD align="right">{boarded}</TD>
                  <TD align="right">{off}</TD>
                  <TD align="right">{allocated.find((a) => a.busId === t.busId)?._count ?? 0}</TD>
                  <TD><Link href={`/transport/attendance?${qs}`} className="text-sm text-brand-700 hover:underline">Records</Link></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
      <Card className="mt-5">
        <CardHeader title={`Boarding records (${total})`} actions={tripId && <Link href={`/transport/attendance?date=${date}`} className="text-sm text-brand-700 hover:underline">All trips</Link>} />
        <Table>
          <THead><tr><TH>Time</TH><TH>Student</TH><TH>Class</TH><TH>Bus · trip</TH><TH>Event</TH><TH>Method</TH><TH>Marked by</TH></tr></THead>
          <TBody>
            {records.length === 0 && <EmptyRow colSpan={7} />}
            {records.map((r) => (
              <TR key={r.id}>
                <TD>{fmtDateTime(r.at)}</TD>
                <TD><Link href={`/students/${r.studentId}`} className="font-medium hover:text-brand-700">{fullName(r.student)}</Link><span className="block text-xs text-slate-500">{r.student.admissionNo}</span></TD>
                <TD>{className(r.student.schoolClass, r.student.section)}</TD>
                <TD>{r.trip.bus.busNo} · {r.trip.type === "PICKUP" ? "Pickup" : "Drop"}</TD>
                <TD><Badge tone={r.event === "BOARDED" ? "green" : "gray"}>{r.event === "BOARDED" ? "Boarded" : "Got off"}</Badge></TD>
                <TD>{r.method === "SCAN" ? "ID scan" : "Tap"}</TD>
                <TD>{markers.find((m) => m.id === r.markedById)?.name ?? "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/transport/attendance" />
      </Card>
    </>
  );
}

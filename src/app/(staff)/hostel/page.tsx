import Link from "next/link";
import { BedDouble, Building2, DoorOpen, Footprints, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fmtDateTime, fullName, money, toNum } from "@/lib/format";
import { TYPE_LABEL, hostelDashboard } from "@/server/hostel/service";
import { PageHeader, Card, CardHeader, StatCard, Table, THead, TBody, TR, TH, TD, Badge, EmptyState } from "@/components/ui";
import { ModalForm } from "@/components/ui/client";
import { saveHostelAction } from "./actions";
import { HostelFields } from "./_components/hostel-fields";

export const metadata = { title: "Hostel" };

export default async function HostelOverview() {
  const user = await requireUser("hostel.view");
  const [d, hostels] = await Promise.all([
    hostelDashboard(user.branchId),
    db.hostel.findMany({ where: { branchId: user.branchId }, include: { rooms: { where: { isActive: true }, include: { _count: { select: { allocations: { where: { status: "ACTIVE" } } } } } } }, orderBy: { name: "asc" } }),
  ]);
  const canManage = hasPerm(user, "hostel.manage");
  return (
    <>
      <PageHeader title="Hostel" description="Hostels, rooms, residents, outpasses and roll call."
        actions={canManage && <ModalForm trigger="Add hostel" icon={<Plus className="size-4" />} title="Add hostel" action={saveHostelAction} successMessage="Hostel added" redirectTo="/hostel/[id]"><HostelFields /></ModalForm>} />
      {hostels.length === 0 ? <EmptyState title="No hostels yet" description="Add a hostel, then its rooms, then give students their beds. Hostel fees are added to fee accounts automatically." /> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard label="Residents" value={d.residents} href="/hostel/residents" icon={<BedDouble />} />
            <StatCard label="Free beds" value={`${d.free} / ${d.beds}`} hint={`${d.rooms} rooms`} icon={<DoorOpen />} />
            <StatCard label="Out on pass" value={d.out} href="/hostel/outpasses" icon={<Footprints />} />
            <StatCard label="Late back" value={d.overdue.length} hint={d.overdue.length ? "Past their return time" : "Everyone is back on time"} href="/hostel/outpasses" icon={<Building2 />} />
          </div>
          <Card className="mt-6">
            <CardHeader title="Hostels" />
            <Table>
              <THead><tr><TH>Hostel</TH><TH>For</TH><TH>Warden</TH><TH align="right">Rooms</TH><TH align="right">Beds</TH><TH align="right">Occupied</TH><TH align="right">Fee / term</TH></tr></THead>
              <TBody>
                {hostels.map((h) => {
                  const beds = h.rooms.reduce((s, r) => s + r.capacity, 0), used = h.rooms.reduce((s, r) => s + r._count.allocations, 0);
                  return (
                    <TR key={h.id}>
                      <TD><Link href={`/hostel/${h.id}`} className="font-medium text-ink hover:text-brand-700">{h.name}</Link>{!h.isActive && <Badge className="ml-2">Closed</Badge>}</TD>
                      <TD>{TYPE_LABEL[h.type]}</TD>
                      <TD>{h.wardenName ?? "—"}{h.phone && <span className="block text-xs text-muted">{h.phone}</span>}</TD>
                      <TD align="right">{h.rooms.length}</TD>
                      <TD align="right">{beds}</TD>
                      <TD align="right">{used}{beds > 0 && <span className="block text-xs text-muted">{Math.round((used / beds) * 100)}%</span>}</TD>
                      <TD align="right">{money(toNum(h.feePerTerm))}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>
          {d.overdue.length > 0 && (
            <Card className="mt-5">
              <CardHeader title="Late back from outpass" />
              <Table>
                <THead><tr><TH>Student</TH><TH>Due back</TH></tr></THead>
                <TBody>{d.overdue.map((p) => <TR key={p.id}><TD>{fullName(p.student)}</TD><TD className="text-rose-700">{fmtDateTime(p.expectedReturn)}</TD></TR>)}</TBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </>
  );
}

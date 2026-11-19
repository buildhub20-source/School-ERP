import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fullName, money, toNum } from "@/lib/format";
import { TYPE_LABEL } from "@/server/hostel/service";
import { PageHeader, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow, Badge, Field, FormGrid, Input } from "@/components/ui";
import { ModalForm } from "@/components/ui/client";
import { addRoomsAction, saveHostelAction, saveRoomAction } from "../actions";
import { HostelFields } from "../_components/hostel-fields";

export const metadata = { title: "Hostel rooms" };

function RoomFields({ room }: { room?: { roomNo: string; floor: string | null; capacity: number; roomType: string | null; feePerTerm: unknown } }) {
  return (
    <FormGrid cols={2}>
      <Field label="Room no" required><Input name="roomNo" defaultValue={room?.roomNo} required /></Field>
      <Field label="Floor"><Input name="floor" defaultValue={room?.floor ?? ""} /></Field>
      <Field label="Beds" required><Input name="capacity" type="number" min={1} max={50} defaultValue={room?.capacity ?? 4} required /></Field>
      <Field label="Room type" hint="e.g. 4-bed non-AC"><Input name="roomType" defaultValue={room?.roomType ?? ""} /></Field>
      <Field label="Fee per term (₹)" hint="Leave empty to use the hostel fee"><Input name="feePerTerm" type="number" min={0} defaultValue={room?.feePerTerm != null ? String(room.feePerTerm) : ""} /></Field>
    </FormGrid>
  );
}

export default async function HostelPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("hostel.view");
  const { id } = await params;
  const hostel = await db.hostel.findFirst({
    where: { id, branchId: user.branchId },
    include: { rooms: { orderBy: [{ floor: "asc" }, { roomNo: "asc" }], include: { allocations: { where: { status: "ACTIVE" }, include: { student: { include: { schoolClass: true } } }, orderBy: { bedNo: "asc" } } } } },
  });
  if (!hostel) notFound();
  const canManage = hasPerm(user, "hostel.manage");
  const beds = hostel.rooms.filter((r) => r.isActive).reduce((s, r) => s + r.capacity, 0);
  const used = hostel.rooms.reduce((s, r) => s + r.allocations.length, 0);
  return (
    <>
      <PageHeader title={hostel.name} description={`${TYPE_LABEL[hostel.type]} · ${hostel.rooms.length} rooms · ${used} of ${beds} beds taken · ${money(toNum(hostel.feePerTerm))} per term`}
        breadcrumbs={[{ label: "Hostel", href: "/hostel" }, { label: hostel.name }]}
        actions={canManage && <>
          <ModalForm trigger="Edit" triggerVariant="secondary" icon={<Pencil className="size-4" />} title="Edit hostel" action={saveHostelAction} extra={{ id: hostel.id }} successMessage="Saved"><HostelFields hostel={hostel} /></ModalForm>
          <ModalForm trigger="Add rooms" triggerVariant="secondary" title="Add several rooms" description="Rooms are numbered from–to, e.g. 101 to 110." action={addRoomsAction} extra={{ hostelId: hostel.id }} successMessage="@result">
            <FormGrid cols={2}>
              <Field label="From room no" required><Input name="from" type="number" min={0} required /></Field>
              <Field label="To room no" required><Input name="to" type="number" min={0} required /></Field>
              <Field label="Prefix" hint="Optional, e.g. A-"><Input name="prefix" /></Field>
              <Field label="Floor"><Input name="floor" /></Field>
              <Field label="Beds per room" required><Input name="capacity" type="number" min={1} defaultValue={4} required /></Field>
              <Field label="Room type"><Input name="roomType" /></Field>
            </FormGrid>
          </ModalForm>
          <ModalForm trigger="Add room" icon={<Plus className="size-4" />} title="Add room" action={saveRoomAction} extra={{ hostelId: hostel.id }} successMessage="Room added"><RoomFields /></ModalForm>
        </>} />
      <Card>
        <CardHeader title="Rooms" />
        <Table>
          <THead><tr><TH>Room</TH><TH>Type</TH><TH align="right">Beds</TH><TH>Residents</TH><TH align="right">Fee / term</TH>{canManage && <TH />}</tr></THead>
          <TBody>
            {hostel.rooms.length === 0 && <EmptyRow colSpan={6} message="No rooms yet. Use “Add room” or “Add rooms”." />}
            {hostel.rooms.map((r) => (
              <TR key={r.id}>
                <TD className="font-medium text-ink">{r.roomNo}{r.floor && <span className="block text-xs font-normal text-muted">Floor {r.floor}</span>}{!r.isActive && <Badge className="ml-2">Closed</Badge>}</TD>
                <TD>{r.roomType ?? "—"}</TD>
                <TD align="right" className="whitespace-nowrap">{r.allocations.length} / {r.capacity}{r.allocations.length >= r.capacity && <span className="block text-xs text-amber-700">Full</span>}</TD>
                <TD>{r.allocations.length === 0 ? <span className="text-muted">Empty</span> : r.allocations.map((a) => <Link key={a.id} href={`/students/${a.studentId}`} className="block text-sm hover:text-brand-700">{a.bedNo ? `Bed ${a.bedNo}: ` : ""}{fullName(a.student)} <span className="text-xs text-muted">{a.student.schoolClass.name}</span></Link>)}</TD>
                <TD align="right">{money(toNum(r.feePerTerm ?? hostel.feePerTerm))}</TD>
                {canManage && <TD align="right"><ModalForm trigger="" triggerVariant="ghost" triggerSize="sm" icon={<Pencil className="size-4" />} title={`Room ${r.roomNo}`} action={saveRoomAction} extra={{ id: r.id, hostelId: hostel.id }} successMessage="Saved"><RoomFields room={r} /></ModalForm></TD>}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

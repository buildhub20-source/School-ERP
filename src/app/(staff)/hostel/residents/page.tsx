import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fmtDate, fullName, isoDate } from "@/lib/format";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, Field, FormGrid, Input, Select, Textarea, StatusBadge } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect, ModalForm } from "@/components/ui/client";
import { allocateBedAction, changeRoomAction, vacateAction } from "../actions";
import { StudentPicker } from "../_components/student-picker";

export const metadata = { title: "Hostel residents" };

export default async function ResidentsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("hostel.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const q = sp(s, "q"), hostelId = sp(s, "hostelId"), status = sp(s, "status") ?? "ACTIVE";
  const where: Prisma.HostelAllocationWhereInput = {
    branchId: user.branchId, ...(status === "ALL" ? {} : { status: status as "ACTIVE" }), ...(hostelId ? { room: { hostelId } } : {}),
    ...(q ? { student: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { admissionNo: { contains: q, mode: "insensitive" } }] } } : {}),
  };
  const [total, rows, hostels] = await Promise.all([
    db.hostelAllocation.count({ where }),
    db.hostelAllocation.findMany({ where, include: { student: { include: { schoolClass: true, section: true, guardians: { where: { isPrimary: true }, include: { guardian: true } } } }, room: { include: { hostel: true } } }, orderBy: [{ room: { hostel: { name: "asc" } } }, { room: { roomNo: "asc" } }], skip, take }),
    db.hostel.findMany({ where: { branchId: user.branchId, isActive: true }, include: { rooms: { where: { isActive: true }, orderBy: { roomNo: "asc" }, include: { _count: { select: { allocations: { where: { status: "ACTIVE" } } } } } } }, orderBy: { name: "asc" } }),
  ]);
  const canManage = hasPerm(user, "hostel.manage");
  const roomOptions = hostels.flatMap((h) => h.rooms.map((r) => ({ id: r.id, label: `${h.name} · ${r.roomNo} (${r.capacity - r._count.allocations} free)`, full: r._count.allocations >= r.capacity })));
  const RoomSelect = () => (
    <Select name="roomId" required placeholder="Choose a room">
      {roomOptions.map((r) => <option key={r.id} value={r.id} disabled={r.full}>{r.label}{r.full ? " — full" : ""}</option>)}
    </Select>
  );
  return (
    <>
      <PageHeader title="Residents" description={`${total} ${status === "ACTIVE" ? "staying now" : "records"}`} breadcrumbs={[{ label: "Hostel", href: "/hostel" }, { label: "Residents" }]}
        actions={canManage && (
          <ModalForm trigger="Give a bed" icon={<Plus className="size-4" />} title="Give a student a hostel bed" description="The hostel fee for each remaining term is added to the student's fee account." action={allocateBedAction} successMessage="@result">
            <FormGrid cols={2}>
              <Field label="Student" required className="sm:col-span-2"><StudentPicker /></Field>
              <Field label="Room" required className="sm:col-span-2"><RoomSelect /></Field>
              <Field label="Bed no"><Input name="bedNo" /></Field>
              <Field label="From"><Input name="startDate" type="date" defaultValue={isoDate(new Date())} /></Field>
              <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" rows={2} /></Field>
            </FormGrid>
          </ModalForm>
        )} />
      <Card>
        <div className="border-b border-line p-3">
          <FilterBar>
            <SearchField placeholder="Student name or admission no" />
            <FilterSelect name="hostelId" label="All hostels" options={hostels.map((h) => ({ value: h.id, label: h.name }))} />
            <FilterSelect name="status" label="Staying now" options={[{ value: "ENDED", label: "Left" }, { value: "ALL", label: "All" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Student</TH><TH>Hostel / room</TH><TH>Parent</TH><TH>Since</TH><TH>Status</TH>{canManage && <TH />}</tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={6} message="No residents match." />}
            {rows.map((a) => (
              <TR key={a.id}>
                <TD className="whitespace-nowrap"><Link href={`/students/${a.studentId}`} className="font-medium text-ink hover:text-brand-700">{fullName(a.student)}</Link><span className="block text-xs text-muted">{a.student.admissionNo} · {a.student.schoolClass.name}{a.student.section ? "-" + a.student.section.name : ""}</span></TD>
                <TD><Link href={`/hostel/${a.room.hostelId}`} className="hover:text-brand-700">{a.room.hostel.name}</Link><span className="block text-xs text-muted">Room {a.room.roomNo}{a.bedNo ? ` · bed ${a.bedNo}` : ""}</span></TD>
                <TD>{a.student.guardians[0]?.guardian.name ?? "—"}<span className="block text-xs text-muted">{a.student.guardians[0]?.guardian.phone}</span></TD>
                <TD>{fmtDate(a.startDate)}{a.endDate && <span className="block text-xs text-muted">left {fmtDate(a.endDate)}</span>}</TD>
                <TD><StatusBadge status={a.status === "ACTIVE" ? "ACTIVE" : "ENDED"} label={a.status === "ACTIVE" ? "Staying" : "Left"} /></TD>
                {canManage && (
                  <TD align="right">
                    {a.status === "ACTIVE" && (
                      <div className="flex justify-end gap-1.5">
                        <ModalForm trigger="Change room" triggerVariant="secondary" triggerSize="sm" title={`Move ${fullName(a.student)}`} action={changeRoomAction} extra={{ allocationId: a.id }} successMessage="Room changed">
                          <FormGrid cols={2}><Field label="New room" required className="sm:col-span-2"><RoomSelect /></Field><Field label="Bed no"><Input name="bedNo" /></Field></FormGrid>
                        </ModalForm>
                        <ModalForm trigger="Leave hostel" triggerVariant="danger" triggerSize="sm" title={`${fullName(a.student)} leaves the hostel`} description="Frees the bed and cancels unpaid hostel fees for terms that start after this date." action={vacateAction} extra={{ allocationId: a.id }} successMessage="@result" submitLabel="Confirm">
                          <Field label="Leaving date" required><Input name="endDate" type="date" defaultValue={isoDate(new Date())} required /></Field>
                        </ModalForm>
                      </div>
                    )}
                  </TD>
                )}
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/hostel/residents" />
      </Card>
    </>
  );
}

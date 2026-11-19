import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { dateOnly, fullName, isoDate } from "@/lib/format";
import { PageHeader, Card, CardBody, EmptyState, sp } from "@/components/ui";
import { FilterBar, FilterSelect, FilterDate } from "@/components/ui/client";
import { RollCallForm } from "./roll-form";

export const metadata = { title: "Roll call" };

export default async function RollCallPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("hostel.warden");
  const s = await searchParams;
  const hostels = await db.hostel.findMany({ where: { branchId: user.branchId, isActive: true }, orderBy: { name: "asc" } });
  const hostelId = sp(s, "hostelId") ?? hostels[0]?.id;
  const session = sp(s, "session") === "MORNING" ? "MORNING" : "NIGHT";
  const date = dateOnly(sp(s, "date") ?? isoDate(new Date()));
  if (!hostelId) return (<><PageHeader title="Roll call" breadcrumbs={[{ label: "Hostel", href: "/hostel" }, { label: "Roll call" }]} /><EmptyState title="No hostels yet" /></>);
  const [residents, marked, out] = await Promise.all([
    db.hostelAllocation.findMany({ where: { status: "ACTIVE", room: { hostelId } }, include: { student: true, room: true }, orderBy: [{ room: { roomNo: "asc" } }, { bedNo: "asc" }] }),
    db.hostelRollCall.findMany({ where: { hostelId, date, session } }),
    db.hostelOutpass.findMany({ where: { returnedAt: null, student: { hostelAllocations: { some: { status: "ACTIVE", room: { hostelId } } } } }, select: { studentId: true } }),
  ]);
  const onPass = new Set(out.map((o) => o.studentId));
  const rows = residents.map((a) => ({
    studentId: a.studentId, name: fullName(a.student), room: a.room.roomNo + (a.bedNo ? ` · bed ${a.bedNo}` : ""),
    status: (marked.find((m) => m.studentId === a.studentId)?.status ?? (onPass.has(a.studentId) ? "ON_LEAVE" : "PRESENT")) as "PRESENT" | "ABSENT" | "ON_LEAVE",
    onPass: onPass.has(a.studentId),
  }));
  return (
    <>
      <PageHeader title="Roll call" description={marked.length ? `Already taken: ${marked.length} marked. Saving again updates it.` : "Everyone starts as present (residents out on a pass as on leave); mark who is missing and save."} breadcrumbs={[{ label: "Hostel", href: "/hostel" }, { label: "Roll call" }]} />
      <Card className="mb-4 p-3">
        <FilterBar>
          {/* An empty selection means the default: the first hostel, the night roll call. */}
          {hostels.length > 1 && <FilterSelect name="hostelId" label={hostels[0].name} options={hostels.slice(1).map((h) => ({ value: h.id, label: h.name }))} />}
          <FilterSelect name="session" label="Night" options={[{ value: "MORNING", label: "Morning" }]} />
          <FilterDate name="date" label="Date" />
        </FilterBar>
      </Card>
      {rows.length === 0 ? <EmptyState title="No residents in this hostel" /> : (
        <Card><CardBody><RollCallForm key={`${hostelId}-${isoDate(date)}-${session}`} hostelId={hostelId} date={isoDate(date)} session={session} rows={rows} /></CardBody></Card>
      )}
    </>
  );
}

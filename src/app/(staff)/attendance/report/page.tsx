import { requireUser } from "@/lib/auth/session";
import { dateOnly, fmtDate, isoDate, today } from "@/lib/format";
import { reportPreview } from "@/server/attendance/report";
import { PageHeader, Card, sp } from "@/components/ui";
import { ReportForm } from "./report-form";

export const metadata = { title: "Send attendance report" };

export default async function SendReportPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("attendance.manage");
  const s = await searchParams;
  const raw = sp(s, "date");
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? dateOnly(raw) : today();
  const p = await reportPreview(user.branchId, date);
  const sections = p.sections.map((x) => ({
    sectionId: x.sectionId, label: x.label, students: x.students, marked: x.marked, hasTeacher: x.hasTeacher,
    present: x.counts.present + x.counts.late + x.counts.half, absent: x.counts.absent,
  }));
  const marked = sections.filter((x) => x.marked > 0).length;

  return (
    <>
      <PageHeader title="Send attendance report" description={`${fmtDate(date)}${p.closed ? ` · ${p.closed}` : ""} — ${marked} of ${sections.length} classes marked`}
        breadcrumbs={[{ label: "Attendance", href: "/attendance" }, { label: "Send report" }]} />
      {p.closed && <Card className="mb-5"><div className="p-4 text-sm text-amber-700">{fmtDate(date)} is not a school day ({p.closed}). Pick another date.</div></Card>}
      {!p.closed && marked === 0 && <Card className="mb-5"><div className="p-4 text-sm text-amber-700">No class has attendance marked for {fmtDate(date)} yet. Mark it first (Attendance → Mark a class), or pick another date.</div></Card>}
      <Card><div className="p-5 sm:p-6">
        <ReportForm key={isoDate(date)} date={isoDate(date)} sections={sections} admins={p.admins} staff={p.staff} />
      </div></Card>
    </>
  );
}

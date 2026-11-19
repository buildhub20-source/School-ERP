import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { addDays, dateOnly, fmtDate, fmtDateTime, fullName, isoDate, today } from "@/lib/format";
import { loadSection, markPermission, myTeacherSections, schoolClosedReason, sectionRegister } from "@/server/attendance/service";
import { PageHeader, Card, CardBody, EmptyState, sp, buttonClass } from "@/components/ui";
import { FilterBar, FilterSelect } from "@/components/ui/client";
import { StudentRegisterForm } from "./register-form";

export const metadata = { title: "Mark attendance" };

export default async function MarkAttendancePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["attendance.mark", "attendance.manage"]);
  const s = await searchParams;
  const t = today();
  const office = hasPerm(user, "attendance.manage");
  const raw = sp(s, "date");
  const date = office && raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? dateOnly(raw) : t;
  let sectionId = sp(s, "sectionId");

  // Teachers: their own class (or a choice when they teach more than one section).
  if (!sectionId && !office) {
    const mine = await myTeacherSections(user.id);
    if (mine.length === 0) return (<><PageHeader title="Mark attendance" /><EmptyState title="You are not a class teacher yet" description="The office assigns class teachers in Settings → Years & classes. Once you have a class, its register opens here." /></>);
    if (mine.length > 1) {
      return (
        <>
          <PageHeader title="Mark attendance" description="Choose your class." />
          <div className="grid gap-3 sm:grid-cols-2">
            {mine.map((m) => <Link key={m.id} href={`/attendance/mark?sectionId=${m.id}`} className="rounded-2xl border border-line bg-surface p-5 text-lg font-semibold text-ink hover:border-brand-400">{m.schoolClass.name} - {m.name}</Link>)}
          </div>
        </>
      );
    }
    sectionId = mine[0].id;
  }

  const sectionOptions = office
    ? (await db.section.findMany({ where: { schoolClass: { branchId: user.branchId } }, include: { schoolClass: true }, orderBy: [{ schoolClass: { grade: "asc" } }, { name: "asc" }] })).map((x) => ({ value: x.id, label: `${x.schoolClass.name} - ${x.name}` }))
    : [];

  if (!sectionId) {
    return (
      <>
        <PageHeader title="Mark attendance" description="Choose a class to open its register." breadcrumbs={[{ label: "Attendance", href: "/attendance" }, { label: "Mark" }]} />
        <Card><div className="p-3"><FilterBar><FilterSelect name="sectionId" label="Choose a class" options={sectionOptions} /></FilterBar></div></Card>
      </>
    );
  }

  const section = await loadSection(user.branchId, sectionId);
  const label = `${section.schoolClass.name} - ${section.name}`;
  if (!office && !hasPerm(user, "attendance.view") && section.classTeacherId !== user.id) {
    return (<><PageHeader title="Mark attendance" /><EmptyState title="This is not your class" description="Class teachers can open only their own class register." action={<Link href="/attendance/mark" className={buttonClass("secondary", "md")}>Open my class</Link>} /></>);
  }
  const [closed, rows] = await Promise.all([schoolClosedReason(user.branchId, date), sectionRegister(user.branchId, sectionId, date)]);
  const can = markPermission(user, section, date);
  const marked = rows.filter((r) => r.mark);
  const last = marked.reduce<Date | null>((a, r) => (!a || r.mark!.updatedAt > a ? r.mark!.updatedAt : a), null);
  const isToday = date.getTime() === t.getTime();
  const nav = (d: Date) => `/attendance/mark?sectionId=${sectionId}&date=${isoDate(d)}`;

  return (
    <>
      <PageHeader title={`Attendance · ${label}`}
        description={`${isToday ? "Today, " : ""}${fmtDate(date)}${section.classTeacher ? ` · Class teacher: ${section.classTeacher.name}` : ""}`}
        breadcrumbs={office || hasPerm(user, "attendance.view") ? [{ label: "Attendance", href: "/attendance" }, { label: label }] : undefined}
        actions={<>
          {office && <>
            <Link href={nav(addDays(date, -1))} className={buttonClass("secondary", "md")} aria-label="Previous day"><ChevronLeft className="size-4" /></Link>
            {!isToday && <Link href={`/attendance/mark?sectionId=${sectionId}`} className={buttonClass("secondary", "md")}>Today</Link>}
            {!isToday && <Link href={nav(addDays(date, 1))} className={buttonClass("secondary", "md")} aria-label="Next day"><ChevronRight className="size-4" /></Link>}
          </>}
          <Link href={`/attendance/month?sectionId=${sectionId}`} className={buttonClass("secondary", "md")}><CalendarDays className="size-4" />Month view</Link>
        </>} />
      {office && <Card className="mb-4"><div className="p-3"><FilterBar><FilterSelect name="sectionId" label="Class" options={sectionOptions} /></FilterBar></div></Card>}
      {closed ? (
        <EmptyState title="No school today" description={`${fmtDate(date)} is ${closed}. Attendance is only taken on school days.`} />
      ) : rows.length === 0 ? (
        <EmptyState title="No students in this class" description="Students appear here once they are admitted to this section." />
      ) : (
        <Card>
          <CardBody>
            {marked.length > 0 && <p className="mb-3 text-sm text-muted">Saved{last ? ` ${fmtDateTime(last)}` : ""}{marked[0].mark?.markedByName ? ` by ${marked[0].mark.markedByName}` : ""}. You can change it and save again.</p>}
            {!can.ok && <p className="mb-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-muted">{can.reason}</p>}
            <StudentRegisterForm key={`${sectionId}-${isoDate(date)}`} sectionId={sectionId} date={isoDate(date)} readOnly={!can.ok} isToday={isToday}
              rows={rows.map((r) => ({ studentId: r.student.id, name: fullName(r.student), roll: r.student.rollNo ?? "", admissionNo: r.student.admissionNo, status: r.mark?.status ?? null, note: r.mark?.note ?? undefined, parentTold: !!r.mark?.parentNotifiedAt }))} />
          </CardBody>
        </Card>
      )}
    </>
  );
}

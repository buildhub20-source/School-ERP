import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardCheck, UserX, Clock, Percent } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { addDays, dateOnly, fmtDate, fmtDateTime, fullName, isoDate, today } from "@/lib/format";
import { absenteesOn, attendanceOverview, attendancePercent, attendanceTrend, schoolClosedReason, STATUS_LABEL, type Counts } from "@/server/attendance/service";
import { ClassComparisonChart, type ClassRow } from "./class-comparison-chart";
import { PageHeader, Card, CardHeader, StatCard, Table, THead, TBody, TR, TH, TD, EmptyRow, EmptyState, Badge, sp, buttonClass } from "@/components/ui";
import { FilterBar, FilterDate } from "@/components/ui/client";

export const metadata = { title: "Student attendance" };

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

export default async function AttendanceOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["attendance.view", "attendance.manage"]);
  const s = await searchParams;
  const t = today();
  const raw = sp(s, "date");
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? dateOnly(raw) : t;
  const isToday = date.getTime() === t.getTime();
  const [closed, rows, absentees, trend] = await Promise.all([schoolClosedReason(user.branchId, date), attendanceOverview(user.branchId, date), absenteesOn(user.branchId, date), attendanceTrend(user.branchId, date)]);
  const trendAvg = attendancePercent(trend.trend.reduce<Counts>((a, d) => ({ present: a.present + d.marked - d.absent - d.late - d.half, late: a.late + d.late, half: a.half + d.half, absent: a.absent + d.absent }), { present: 0, late: 0, half: 0, absent: 0 }));
  const canMark = hasPerm(user, "attendance.manage");
  const total = rows.reduce<Counts>((a, r) => ({ present: a.present + r.counts.present, late: a.late + r.counts.late, half: a.half + r.counts.half, absent: a.absent + r.counts.absent }), { present: 0, late: 0, half: 0, absent: 0 });
  const markedSections = rows.filter((r) => r.marked > 0).length;
  const classRows: ClassRow[] = trend.bySection.flatMap((c) => {
    const sec = rows.find((r) => r.sectionId === c.sectionId);
    return sec && c.percent !== null ? [{ ...c, percent: c.percent, label: sec.label, teacher: sec.teacher }] : [];
  });
  const trendCard = trend.trend.length > 1 && classRows.length > 1 ? (
    <Card>
      <CardHeader title="Attendance lost by class"
        description={`Absences over the last ${trend.trend.length} school days (a half day counts as half), highest first; the dashed line is the school average${trendAvg !== null ? ` (attendance ${trendAvg}%)` : ""}. Click a class for its month.`} />
      <ClassComparisonChart data={classRows} average={trendAvg} month={isoDate(date).slice(0, 7)} />
    </Card>
  ) : null;
  const nav = (d: Date) => `/attendance?date=${isoDate(d)}`;
  return (
    <>
      <PageHeader title="Student attendance" description={`${isToday ? "Today, " : ""}${fmtDate(date)}${closed ? ` · ${closed}` : ""}`}
        actions={<>
          <Link href={nav(addDays(date, -1))} className={buttonClass("secondary", "md")} aria-label="Previous day"><ChevronLeft className="size-4" /></Link>
          {!isToday && <Link href="/attendance" className={buttonClass("secondary", "md")}>Today</Link>}
          {!isToday && <Link href={nav(addDays(date, 1))} className={buttonClass("secondary", "md")} aria-label="Next day"><ChevronRight className="size-4" /></Link>}
          {canMark && <Link href="/attendance/mark" className={buttonClass("primary", "md")}><ClipboardCheck className="size-4" />Mark a class</Link>}
        </>} />
      <Card className="mb-4"><div className="p-3"><FilterBar><FilterDate name="date" label="Date" /></FilterBar></div></Card>
      {closed ? <><EmptyState title="No school on this day" description={`${fmtDate(date)} is ${closed}. Attendance is only taken on school days.`} /><div className="mt-5">{trendCard}</div></> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard label="Classes marked" value={`${markedSections} / ${rows.length}`} hint={markedSections < rows.length ? `${rows.length - markedSections} still to mark` : "All classes marked"} icon={<ClipboardCheck />} />
            <StatCard label="Attendance" value={pct(attendancePercent(total))} hint="Of the classes marked so far" icon={<Percent />} />
            <StatCard label="Absent" value={total.absent} hint={isToday ? "Parents are told automatically" : undefined} icon={<UserX />} />
            <StatCard label="Late / half day" value={total.late + total.half} icon={<Clock />} />
          </div>
          {trendCard && <div className="mb-5">{trendCard}</div>}
          <Card>
            <CardHeader title="Classes" description="Each class teacher marks their own class. Open a class to see or correct its register." />
            <Table>
              <THead><tr><TH>Class</TH><TH>Class teacher</TH><TH align="right">Students</TH><TH>Register</TH><TH align="right">Present</TH><TH align="right">Absent</TH><TH align="right">Late</TH><TH align="right">%</TH><TH /></tr></THead>
              <TBody>
                {rows.length === 0 && <EmptyRow colSpan={9} message="No classes with students yet." />}
                {rows.map((r) => (
                  <TR key={r.sectionId}>
                    <TD className="font-medium">{r.label}</TD>
                    <TD>{r.teacher ?? <span className="text-muted">Not assigned</span>}</TD>
                    <TD align="right">{r.students}</TD>
                    <TD>{r.marked > 0 ? <span className="text-sm">Marked<span className="block text-xs text-muted">{r.markedBy ?? ""}{r.markedAt ? `, ${fmtDateTime(r.markedAt).split(", ").pop()}` : ""}</span></span> : <Badge tone="yellow" dot>Not marked</Badge>}</TD>
                    <TD align="right">{r.marked ? r.counts.present + r.counts.late + r.counts.half : "—"}</TD>
                    <TD align="right" className={r.counts.absent ? "font-semibold text-rose-700" : ""}>{r.marked ? r.counts.absent : "—"}</TD>
                    <TD align="right">{r.marked ? r.counts.late : "—"}</TD>
                    <TD align="right">{pct(r.percent)}</TD>
                    <TD align="right"><Link href={`/attendance/mark?sectionId=${r.sectionId}&date=${isoDate(date)}`} className="text-sm font-medium text-brand-700 hover:underline">{canMark ? (r.marked ? "Open" : "Mark") : "View"}</Link></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <Card className="mt-5">
            <CardHeader title="Students to watch" description={`Attendance below ${trend.watchBelow}% over the last ${trend.trend.length} school days, lowest first.`} />
            <Table>
              <THead><tr><TH>Student</TH><TH>Class</TH><TH align="right">Attendance</TH><TH align="right">Absent</TH><TH align="right">Half day</TH><TH align="right">Late</TH><TH align="right">Days marked</TH></tr></THead>
              <TBody>
                {trend.watch.length === 0 && <EmptyRow colSpan={7} message={`No student is below ${trend.watchBelow}%.`} />}
                {trend.watch.map((w) => (
                  <TR key={w.studentId} highlight={w.percent < 75 ? "red" : undefined}>
                    <TD className="font-medium">{hasPerm(user, "students.view") ? <Link href={`/students/${w.studentId}`} className="hover:text-brand-700">{fullName(w.student)}</Link> : fullName(w.student)}<span className="block text-xs text-muted">{w.student.admissionNo}</span></TD>
                    <TD>{w.student.schoolClass.name}{w.student.section ? `-${w.student.section.name}` : ""}</TD>
                    <TD align="right" className="font-semibold">{w.percent}%</TD>
                    <TD align="right">{w.counts.absent}</TD><TD align="right">{w.counts.half}</TD><TD align="right">{w.counts.late}</TD>
                    <TD align="right">{w.marked}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <Card className="mt-5">
            <CardHeader title={isToday ? "Not fully present today" : "Not fully present"} description="Absent, late and half-day students, with the parent to call." />
            <Table>
              <THead><tr><TH>Student</TH><TH>Class</TH><TH>Status</TH><TH>Reason</TH><TH>Parent</TH><TH>Parents told</TH></tr></THead>
              <TBody>
                {absentees.length === 0 && <EmptyRow colSpan={6} message="Everyone marked so far is present." />}
                {absentees.map((a) => {
                  const g = a.student.guardians[0]?.guardian;
                  return (
                    <TR key={a.id}>
                      <TD className="font-medium">{hasPerm(user, "students.view") ? <Link href={`/students/${a.studentId}`} className="hover:text-brand-700">{fullName(a.student)}</Link> : fullName(a.student)}</TD>
                      <TD>{a.student.schoolClass.name}{a.student.section ? `-${a.student.section.name}` : ""}</TD>
                      <TD><Badge tone={a.status === "ABSENT" ? "red" : a.status === "LATE" ? "yellow" : "blue"}>{STATUS_LABEL[a.status]}</Badge></TD>
                      <TD className="text-sm">{a.note ?? "—"}</TD>
                      <TD className="text-sm">{g ? <>{g.name} <a href={`tel:${g.phone}`} className="text-brand-700">{g.phone}</a></> : "—"}</TD>
                      <TD className="text-sm">{a.parentNotifiedAt ? fmtDateTime(a.parentNotifiedAt).split(", ").pop() : "—"}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { fullName, isoDate } from "@/lib/format";
import { loadSection, monthGrid, myTeacherSections } from "@/server/attendance/service";
import { PageHeader, Card, EmptyState, sp, buttonClass } from "@/components/ui";
import { FilterBar, FilterSelect } from "@/components/ui/client";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Monthly attendance" };

const CELL: Record<string, { l: string; c: string }> = {
  PRESENT: { l: "P", c: "text-muted" }, LATE: { l: "L", c: "bg-amber-500/15 text-amber-700" },
  HALF_DAY: { l: "H", c: "bg-sky-500/15 text-sky-700" }, ABSENT: { l: "A", c: "bg-rose-500/15 font-semibold text-rose-700" },
};
const shift = (m: string, by: number) => { const d = new Date(`${m}-01T00:00:00.000Z`); d.setUTCMonth(d.getUTCMonth() + by); return isoDate(d).slice(0, 7); };
const monthName = (m: string) => new Date(`${m}-01T00:00:00.000Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export default async function MonthAttendancePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["attendance.view", "attendance.manage", "attendance.mark"]);
  const s = await searchParams;
  const all = hasPerm(user, ["attendance.view", "attendance.manage"]);
  const mine = all ? [] : await myTeacherSections(user.id);
  const options = all
    ? (await db.section.findMany({ where: { schoolClass: { branchId: user.branchId } }, include: { schoolClass: true }, orderBy: [{ schoolClass: { grade: "asc" } }, { name: "asc" }] })).map((x) => ({ value: x.id, label: `${x.schoolClass.name} - ${x.name}` }))
    : mine.map((x) => ({ value: x.id, label: `${x.schoolClass.name} - ${x.name}` }));
  const sectionId = sp(s, "sectionId") ?? (options.length === 1 ? options[0].value : undefined);
  const raw = sp(s, "month");
  const month = raw && /^\d{4}-\d{2}$/.test(raw) ? raw : isoDate().slice(0, 7);
  if (sectionId && !options.some((o) => o.value === sectionId)) {
    return (<><PageHeader title="Monthly attendance" /><EmptyState title="This is not your class" description="Class teachers can see only their own class." /></>);
  }
  const section = sectionId ? await loadSection(user.branchId, sectionId) : null;
  const grid = sectionId ? await monthGrid(user.branchId, sectionId, month) : null;
  const href = (m: string) => `/attendance/month?${sectionId ? `sectionId=${sectionId}&` : ""}month=${m}`;
  return (
    <>
      <PageHeader title={`Monthly attendance${section ? ` · ${section.schoolClass.name} - ${section.name}` : ""}`} description={monthName(month)}
        breadcrumbs={all ? [{ label: "Attendance", href: "/attendance" }, { label: "Month" }] : undefined}
        actions={<>
          <Link href={href(shift(month, -1))} className={buttonClass("secondary", "md")} aria-label="Previous month"><ChevronLeft className="size-4" /></Link>
          <Link href={href(shift(month, 1))} className={buttonClass("secondary", "md")} aria-label="Next month"><ChevronRight className="size-4" /></Link>
        </>} />
      {options.length > 1 && <Card className="mb-4"><div className="p-3"><FilterBar><FilterSelect name="sectionId" label="Choose a class" options={options} /></FilterBar></div></Card>}
      {!grid ? <EmptyState title={options.length ? "Choose a class" : "No class to show"} description={options.length ? "Pick a class to see its attendance for the month." : "You are not a class teacher yet."} /> : (
        <Card>
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line px-4 py-2.5 text-xs text-muted">
            <span>P present</span><span className="text-rose-700">A absent</span><span className="text-amber-700">L late</span><span className="text-sky-700">H half day</span><span>Shaded columns: no school</span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr className="text-muted">
                  <th className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium">Student</th>
                  {grid.days.map((d) => <th key={d.date.toISOString()} title={d.off ?? undefined} className={cn("w-7 px-0.5 py-2 text-center font-medium", d.off && "bg-surface-2")}>{d.date.getUTCDate()}</th>)}
                  <th className="px-2 py-2 text-right font-medium">Absent</th>
                  <th className="px-3 py-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {grid.rows.length === 0 && <tr><td colSpan={grid.days.length + 3} className="px-3 py-6 text-center text-muted">No students in this class.</td></tr>}
                {grid.rows.map((r) => (
                  <tr key={r.student.id}>
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1.5 text-sm text-ink">{r.student.rollNo && <span className="mr-2 font-mono text-xs text-muted">{r.student.rollNo}</span>}{fullName(r.student)}</td>
                    {r.cells.map((c, i) => <td key={i} className={cn("px-0.5 py-1.5 text-center", grid.days[i].off && "bg-surface-2", c && CELL[c].c)}>{c ? CELL[c].l : ""}</td>)}
                    <td className={cn("px-2 py-1.5 text-right", r.counts.absent && "font-semibold text-rose-700")}>{r.counts.absent}</td>
                    <td className={cn("px-3 py-1.5 text-right font-medium", r.percent !== null && r.percent < 75 ? "text-rose-700" : "text-ink")}>{r.percent === null ? "—" : `${r.percent}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Percentage = present + late + half of half days, out of the days marked. Below 75% is shown in red.</p>
        </Card>
      )}
    </>
  );
}

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { StaffAttendanceStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { addDays, today } from "@/lib/format";
import { ATT_LABEL, ATT_SHORT, dayKey, dayOff, workCalendar } from "@/server/hr/service";
import { PageHeader, Card, EmptyState, sp, buttonClass } from "@/components/ui";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Monthly staff register" };

const CELL: Record<StaffAttendanceStatus, string> = {
  PRESENT: "text-emerald-700", LATE: "bg-amber-50 text-amber-800", HALF_DAY: "bg-sky-50 text-sky-700", ABSENT: "bg-rose-50 font-semibold text-rose-700", ON_LEAVE: "bg-violet-50 text-violet-700",
};

export default async function MonthRegister({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("hr.view");
  const s = await searchParams;
  const t = today();
  const m = sp(s, "month");
  const start = m && /^\d{4}-\d{2}$/.test(m) ? new Date(`${m}-01T00:00:00.000Z`) : new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
  const end = addDays(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)), -1);
  const days: Date[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const [staff, marks, cal] = await Promise.all([
    db.staffProfile.findMany({ where: { branchId: user.branchId, joiningDate: { lte: end }, OR: [{ isActive: true }, { leftOn: { gte: start } }] }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.staffAttendance.findMany({ where: { branchId: user.branchId, date: { gte: start, lte: end } }, select: { staffId: true, date: true, status: true } }),
    workCalendar(user.branchId, start, end),
  ]);
  const map = new Map(marks.map((x) => [`${x.staffId}|${dayKey(x.date)}`, x.status]));
  const monthKey = (d: Date) => d.toISOString().slice(0, 7);
  const label = start.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const working = days.filter((d) => !dayOff(cal, d) && d <= t).length;
  return (
    <>
      <PageHeader title="Monthly staff register" description={`${label} · ${working} working day${working === 1 ? "" : "s"} so far`} breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Monthly register" }]}
        actions={<>
          <Link href={`/hr/attendance/month?month=${monthKey(addDays(start, -1))}`} className={buttonClass("secondary", "md")} aria-label="Previous month"><ChevronLeft className="size-4" /></Link>
          <Link href={`/hr/attendance/month?month=${monthKey(addDays(end, 1))}`} className={buttonClass("secondary", "md")} aria-label="Next month"><ChevronRight className="size-4" /></Link>
        </>} />
      {staff.length === 0 ? <EmptyState title="No staff on the roll" /> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left font-medium text-muted">Staff</th>
                  {days.map((d) => (
                    <th key={d.getTime()} scope="col" className={cn("min-w-7 px-0.5 py-2 text-center font-medium tabular-nums", dayOff(cal, d) ? "text-muted/60" : "text-muted")} title={dayOff(cal, d) ?? undefined}>
                      {d.getUTCDate()}<span className="block text-[10px] font-normal">{"SMTWTFS"[d.getUTCDay()]}</span>
                    </th>
                  ))}
                  {(["PRESENT", "ABSENT", "ON_LEAVE"] as const).map((k) => <th key={k} scope="col" className="px-2 py-2 text-right font-medium text-muted">{ATT_SHORT[k]}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {staff.map((p) => {
                  let pr = 0, ab = 0, lv = 0;
                  return (
                    <tr key={p.id}>
                      <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1.5 text-left font-medium text-ink"><Link href={`/hr/staff/${p.id}`} className="hover:text-brand-700">{p.name}</Link></th>
                      {days.map((d) => {
                        const st = map.get(`${p.id}|${dayKey(d)}`);
                        const off = dayOff(cal, d);
                        const before = d < p.joiningDate || (p.leftOn && d >= p.leftOn);
                        if (st === "PRESENT" || st === "LATE") pr++; else if (st === "HALF_DAY") { pr += 0.5; lv += 0.5; } else if (st === "ABSENT") ab++; else if (st === "ON_LEAVE") lv++;
                        return (
                          <td key={d.getTime()} title={st ? ATT_LABEL[st] : off ?? undefined} className={cn("px-0.5 py-1.5 text-center tabular-nums", st ? CELL[st] : off || before ? "bg-surface-2/60 text-muted/50" : "text-muted/50")}>
                            {st ? ATT_SHORT[st] : off ? "·" : d <= t && !before ? "–" : ""}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-ink">{pr}</td>
                      <td className={cn("px-2 py-1.5 text-right tabular-nums", ab ? "font-semibold text-rose-700" : "text-muted")}>{ab}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-ink">{lv}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-3 text-xs text-muted">P present · L late · H half day · A absent · LV on leave · “·” holiday or weekly off · “–” not marked. Totals: P counts late and half days (½), LV counts half days as ½.</p>
        </Card>
      )}
    </>
  );
}

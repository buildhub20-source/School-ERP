import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { addDays, dateOnly, fmtDate, fmtDateTime, isoDate, today } from "@/lib/format";
import { CATEGORY_LABEL, dayOff, staffOnRoll, workCalendar } from "@/server/hr/service";
import { PageHeader, Card, CardBody, EmptyState, sp, buttonClass } from "@/components/ui";
import { FilterBar, FilterDate } from "@/components/ui/client";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Staff attendance" };

const time = (d: Date | null) => (d ? fmtDateTime(d).split(", ").pop() : "");

export default async function StaffAttendancePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("hr.view");
  const s = await searchParams;
  const t = today();
  const raw = sp(s, "date");
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? dateOnly(raw) : t;
  const future = date > t;
  const [staff, rows, cal] = await Promise.all([
    staffOnRoll(user.branchId, date),
    db.staffAttendance.findMany({ where: { branchId: user.branchId, date }, include: { leaveRequest: { include: { leaveType: true } } } }),
    workCalendar(user.branchId, date, date),
  ]);
  const off = dayOff(cal, date);
  const byStaff = new Map(rows.map((r) => [r.staffId, r]));
  const canMark = hasPerm(user, "hr.attendance") && !future;
  const nav = (d: Date) => `/hr/attendance?date=${isoDate(d)}`;
  return (
    <>
      <PageHeader title="Staff attendance" description={`${fmtDate(date)}${off ? ` · ${off}` : ""}`} breadcrumbs={[{ label: "HR", href: "/hr" }, { label: "Attendance" }]}
        actions={<>
          <Link href={nav(addDays(date, -1))} className={buttonClass("secondary", "md")} aria-label="Previous day"><ChevronLeft className="size-4" /></Link>
          {date.getTime() !== t.getTime() && <Link href="/hr/attendance" className={buttonClass("secondary", "md")}>Today</Link>}
          <Link href={nav(addDays(date, 1))} className={buttonClass("secondary", "md")} aria-label="Next day"><ChevronRight className="size-4" /></Link>
        </>} />
      <Card className="mb-4"><div className="p-3"><FilterBar><FilterDate name="date" label="Date" /></FilterBar></div></Card>
      {staff.length === 0 ? <EmptyState title="No staff on the roll" description="Add staff under HR → Staff first." /> : (
        <Card>
          <CardBody>
            {off && <p className="mb-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-muted">{off}. Mark only the staff who came in.</p>}
            {future && <p className="mb-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-muted">This date is in the future. Approved leave shows here; the rest is marked on the day.</p>}
            <RegisterForm key={isoDate(date)} date={isoDate(date)} readOnly={!canMark}
              rows={staff.map((p) => {
                const r = byStaff.get(p.id);
                const detail = [
                  r?.checkIn ? `in ${time(r.checkIn)}${r.checkOut ? `, out ${time(r.checkOut)}` : ""}` : null,
                  r?.leaveRequest ? `${r.leaveRequest.leaveType.name} (${r.leaveRequest.requestNo})` : null,
                ].filter(Boolean).join(" · ");
                return { staffId: p.id, name: p.name, sub: `${p.designation}${p.department ? `, ${p.department.name}` : ""} · ${CATEGORY_LABEL[p.category]}`, status: r?.status ?? null, detail: detail || undefined, note: r?.source === "LEAVE" ? undefined : r?.note ?? undefined };
              })} />
          </CardBody>
        </Card>
      )}
    </>
  );
}

import Link from "next/link";
import { requireParent } from "@/server/parent";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { fill } from "@/lib/i18n/dict";
import { parentFeeSummary } from "@/server/fees/dashboard";
import { parentBusSummary } from "@/server/transport/dashboard";
import { parentUniformSummary } from "@/server/uniforms/dashboard";
import { Card, Badge, EmptyState, buttonClass } from "@/components/ui";
import { fullName, money, fmtDate, className, today } from "@/lib/format";
import { Bus, IndianRupee, Shirt, Megaphone, ChevronRight, CalendarCheck } from "lucide-react";
import { studentAttendanceSummary } from "@/server/attendance/service";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("nav.home") };
}

export default async function ParentHome() {
  const { user, children } = await requireParent();
  const { t, lang } = await getT();
  const ids = children.map((c) => c.id);
  const [fees, bus, uniforms, circulars] = await Promise.all([
    parentFeeSummary(ids), parentBusSummary(ids), parentUniformSummary(ids),
    db.circular.findMany({ where: { branchId: user.branchId, sentAt: { not: null }, OR: [{ audience: { in: ["ALL_PARENTS", "EVERYONE"] } }, { audience: "CLASSES", classIds: { hasSome: children.map((c) => c.classId) } }] }, orderBy: { sentAt: "desc" }, take: 3 }),
  ]);
  const tday = today();
  const monthStart = new Date(Date.UTC(tday.getUTCFullYear(), tday.getUTCMonth(), 1));
  const [attendance, todayMarks] = await Promise.all([
    Promise.all(ids.map((id) => studentAttendanceSummary(id, monthStart, tday))),
    db.studentAttendance.findMany({ where: { studentId: { in: ids }, date: tday }, select: { studentId: true, status: true } }),
  ]);
  const totalDue = fees.reduce((a, f) => a + f.due, 0);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">{t("parent.welcome")}, {user.name.split(" ")[0]}</h1>
        {totalDue > 0 && <p className="mt-1 text-sm text-slate-600">{t("parent.feesDue")}: <b className="text-rose-700">{money(totalDue)}</b></p>}
      </div>
      {children.length === 0 && <EmptyState title={t("parent.noChildrenTitle")} description={t("parent.noChildrenDesc")} />}
      <div className="grid gap-4 md:grid-cols-2">
        {children.map((c) => {
          const f = fees.find((x) => x.studentId === c.id);
          const b = bus.find((x) => x.studentId === c.id);
          const u = uniforms.find((x) => x.studentId === c.id);
          const att = attendance[ids.indexOf(c.id)];
          const absentToday = todayMarks.some((m) => m.studentId === c.id && m.status === "ABSENT");
          return (
            <Card key={c.id} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-100 p-4">
                {c.photoUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={c.photoUrl} alt="" className="size-12 rounded-full object-cover" />
                  : <div className="grid size-12 place-items-center rounded-full border border-line bg-surface-2 text-lg font-semibold text-ink">{c.firstName.charAt(0)}</div>}
                <div className="min-w-0"><p className="font-semibold">{fullName(c)}</p><p className="text-xs text-slate-500">{className(c.schoolClass, c.section)} · {c.admissionNo}</p></div>
              </div>
              <div className="divide-y divide-slate-100 text-sm">
                <Link href="/parent/fees" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <IndianRupee className="size-4 text-slate-400" />
                  <span className="flex-1">{f && f.due > 0 ? <>{t("common.due")}: <b>{money(f.due)}</b>{f.overdue > 0 && <Badge tone="red" className="ml-2">{fill(t("parent.overdueAmount"), { amount: money(f.overdue) })}</Badge>}{f.nextDueDate && f.overdue === 0 && <span className="ml-1 text-xs text-slate-500">{fill(t("parent.dueBy"), { date: fmtDate(f.nextDueDate) })}</span>}</> : <span className="text-emerald-700">{t("parent.noDues")}</span>}</span>
                  <ChevronRight className="size-4 text-slate-300" />
                </Link>
                <Link href="/parent/attendance" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <CalendarCheck className="size-4 text-slate-400" />
                  <span className="flex-1">{att.percent === null ? <span className="text-slate-500">{t("att.none")}</span> : fill(t("att.homeLine"), { pct: `${att.percent}%` })}{absentToday && <Badge tone="red" className="ml-2">{t("att.absentToday")}</Badge>}</span>
                  <ChevronRight className="size-4 text-slate-300" />
                </Link>
                <Link href="/parent/bus" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <Bus className="size-4 text-slate-400" />
                  <span className="flex-1">{b ? <>{b.busNo} · {b.stopName}{b.pickupTime && <span className="text-xs text-slate-500"> · {t("parent.pickup")} {b.pickupTime}</span>}{b.tripActive && <Badge tone="green" className="ml-2">{t("parent.onTheWay")}</Badge>}</> : <span className="text-slate-500">{t("parent.noBus")}</span>}</span>
                  <ChevronRight className="size-4 text-slate-300" />
                </Link>
                <Link href="/parent/uniforms" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <Shirt className="size-4 text-slate-400" />
                  <span className="flex-1">{u && u.openOrders > 0 ? <>{fill(t("parent.openOrders"), { n: u.openOrders })}{u.ready > 0 && <Badge tone="blue" className="ml-2">{fill(t("parent.readyToCollect"), { n: u.ready })}</Badge>}</> : <span className="text-slate-500">{t("parent.orderUniform")}</span>}</span>
                  <ChevronRight className="size-4 text-slate-300" />
                </Link>
              </div>
            </Card>
          );
        })}
      </div>
      {totalDue > 0 && <Link href="/parent/fees" className={buttonClass("primary", "lg", "w-full sm:w-auto")}>{t("parent.payNow")}</Link>}
      <Card>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3"><p className="flex items-center gap-2 text-sm font-semibold"><Megaphone className="size-4 text-slate-400" />{t("parent.circulars")}</p><Link href="/parent/circulars" className="text-xs font-medium text-brand-700">{t("parent.viewAll")}</Link></div>
        {circulars.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate-500">{t("parent.noCirculars")}</p> : circulars.map((c) => (
          <div key={c.id} className="border-b border-slate-50 px-4 py-3 last:border-0"><p className="text-sm font-medium">{lang === "ta" && c.titleTa && c.bodyTa ? c.titleTa : c.title}</p><p className="line-clamp-2 whitespace-pre-line text-xs text-slate-500 [overflow-wrap:anywhere]">{lang === "ta" && c.titleTa && c.bodyTa ? c.bodyTa : c.body}</p><p className="mt-0.5 text-[11px] text-slate-400">{fmtDate(c.sentAt)}</p></div>
        ))}
      </Card>
    </div>
  );
}

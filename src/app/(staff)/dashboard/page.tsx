import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { stationeryDashboard } from "@/server/stationery/dashboard";
import { uniformsDashboard } from "@/server/uniforms/dashboard";
import { feesDashboard } from "@/server/fees/dashboard";
import { transportDashboard } from "@/server/transport/dashboard";
import { PageHeader, Card, CardHeader, CardBody, StatCard, StatStrip, Badge, Table, THead, TBody, TR, TH, TD, LinkButton } from "@/components/ui";
import { pendingStationeryApprovals } from "@/server/stationery/dashboard";
import { pendingFeeApprovals } from "@/server/fees/dashboard";
import { NeedsAttention, type AttentionItem } from "./needs-attention";
import { libraryDashboard } from "@/server/library/service";
import { assetsDashboard } from "@/server/assets/service";
import { hostelDashboard } from "@/server/hostel/service";
import { hrDashboard } from "@/server/hr/service";
import { studentsByClass } from "@/server/system/analytics";
import { attendanceDashboard } from "@/server/attendance/service";
import { ReportChart } from "@/components/charts/report-chart";
import { money, number, fmtDate, fmtDateTime, today, addDays, fullName } from "@/lib/format";
import { GraduationCap, PencilRuler, Shirt, IndianRupee, Bus, AlertTriangle, ClipboardList, Wallet, FileWarning, Wrench, Package, Clock, Plus, HandCoins } from "lucide-react";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser("dashboard.view");
  const b = user.branchId;
  const can = { students: hasPerm(user, "students.view"), stationery: hasPerm(user, "stationery.view"), uniforms: hasPerm(user, "uniforms.view"), fees: hasPerm(user, "fees.view"), transport: hasPerm(user, "transport.view"), audit: hasPerm(user, ["audit.view", "approvals.view"]) };
  const monthStart = new Date(Date.UTC(today().getUTCFullYear(), today().getUTCMonth(), 1));
  const [totalStudents, byClass, newAdmissions, st, un, fe, tr, activity, approvedToday, deadlines, events] = await Promise.all([
    can.students ? db.student.count({ where: { branchId: b, status: "ACTIVE" } }) : 0,
    can.students ? studentsByClass(b) : [],
    can.students ? db.student.count({ where: { branchId: b, admissionDate: { gte: monthStart } } }) : 0,
    can.stationery ? stationeryDashboard(b) : null,
    can.uniforms ? uniformsDashboard(b) : null,
    can.fees ? feesDashboard(b) : null,
    can.transport ? transportDashboard(b) : null,
    can.audit ? db.auditLog.findMany({ where: { OR: [{ branchId: b }, { branchId: null }], userId: { not: null }, action: { in: ["CREATE", "UPDATE", "DELETE"] }, entity: { notIn: ["Session", "User"] } }, orderBy: { createdAt: "desc" }, take: 8 }) : [],
    Promise.all([
      db.stationeryRequest.count({ where: { branchId: b, approvedAt: { gte: today() } } }),
      db.concession.count({ where: { student: { branchId: b }, status: "APPROVED", decidedAt: { gte: today() } } }),
      db.refund.count({ where: { student: { branchId: b }, status: { not: "PENDING" }, decidedAt: { gte: today() } } }),
    ]),
    can.fees ? db.studentFee.groupBy({ by: ["dueDate"], where: { student: { branchId: b }, status: { in: ["PENDING", "PARTIAL"] }, dueDate: { gte: today(), lte: addDays(today(), 21) } }, _sum: { balance: true }, _count: true, orderBy: { dueDate: "asc" }, take: 5 }) : [],
    db.schoolEvent.findMany({ where: { branchId: b, date: { gte: today(), lte: addDays(today(), 30) } }, orderBy: { date: "asc" }, take: 4 }),
  ]);
  const [stationeryApprovals, feeApprovals, lib, assets, hostel, hr, att] = await Promise.all([
    hasPerm(user, "stationery.approve") ? pendingStationeryApprovals(b) : [],
    hasPerm(user, ["fees.concession.approve", "fees.refund.approve"]) ? pendingFeeApprovals(b) : null,
    hasPerm(user, "library.view") ? libraryDashboard(b) : null,
    hasPerm(user, "assets.view") ? assetsDashboard(b) : null,
    hasPerm(user, "hostel.view") ? hostelDashboard(b) : null,
    hasPerm(user, "hr.view") ? hrDashboard(b) : null,
    hasPerm(user, ["attendance.view", "attendance.manage"]) ? attendanceDashboard(b) : null,
  ]);

  // Today's work, most urgent first: red = act now, amber = needs action soon, blue = to follow up.
  const now = new Date();
  const approvals = stationeryApprovals.length
    + (feeApprovals && hasPerm(user, "fees.concession.approve") ? feeApprovals.concessions.length : 0)
    + (feeApprovals && hasPerm(user, "fees.refund.approve") ? feeApprovals.refunds.length + feeApprovals.adjustments.length : 0)
    + (hr && hasPerm(user, "hr.leave.approve") ? hr.pending : 0);
  const expired = tr ? tr.docsExpiringSoon.filter((d) => d.expiryDate < now) : [];
  const dueIn3Weeks = deadlines.reduce((s, d) => s + d._count, 0);
  const attention: AttentionItem[] = [
    fe && fe.overdueDues > 0 && { level: "red", label: "Overdue fees", detail: `${money(fe.overdueDues)} past the due date`, value: money(fe.overdueDues), href: "/fees/defaulters" },
    expired.length > 0 && { level: "red", label: "Bus documents expired", detail: expired.slice(0, 2).map((d) => `${d.busNo} ${d.type.replace(/_/g, " ").toLowerCase()}`).join(", "), value: expired.length, href: "/transport/documents" },
    hasPerm(user, "approvals.view") && approvals > 0 && { level: "amber", label: "Approvals waiting", detail: "Stationery requests, concessions, refunds, adjustments and staff leave", value: approvals, href: "/approvals" },
    st && st.lowStock.length > 0 && { level: "amber", label: "Stationery at or below reorder level", detail: st.lowStock.slice(0, 3).map((i) => i.name).join(", "), value: st.lowStock.length, href: "/stationery/items?stock=low" },
    st && st.pendingRequests > 0 && !hasPerm(user, "stationery.approve") && { level: "amber", label: "Teacher requests pending", detail: "Waiting for approval", value: st.pendingRequests, href: "/stationery/requests" },
    tr && tr.docsExpiringSoon.length - expired.length > 0 && { level: "amber", label: "Bus documents expiring soon", detail: "Renew before they lapse", value: tr.docsExpiringSoon.length - expired.length, href: "/transport/documents" },
    tr && tr.busesDueForService.length > 0 && { level: "amber", label: "Buses due for service", detail: tr.busesDueForService.slice(0, 2).map((s) => s.busNo).join(", "), value: tr.busesDueForService.length, href: "/transport/maintenance" },
    lib && lib.overdue > 0 && { level: "amber", label: "Library books overdue", detail: lib.overdueList.slice(0, 2).map((l) => l.copy.book.title).join(", "), value: lib.overdue, href: "/library/loans?tab=overdue" },
    hostel && hostel.overdue.length > 0 && { level: "red", label: "Hostel residents late back from outpass", detail: hostel.overdue.slice(0, 2).map((p) => fullName(p.student)).join(", "), value: hostel.overdue.length, href: "/hostel/outpasses" },
    hr && hasPerm(user, "hr.attendance") && !hr.off && hr.notMarked > 0 && (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440 >= 9 * 60 + 30 && { level: "amber", label: "Staff attendance not marked", detail: "Mark today's staff register", value: hr.notMarked, href: "/hr/attendance" },
    att && !att.closed && att.unmarked.length > 0 && (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440 >= 9 * 60 + 30 && { level: "amber", label: "Student attendance not marked", detail: att.unmarked.slice(0, 4).join(", ") + (att.unmarked.length > 4 ? "…" : ""), value: att.unmarked.length, href: "/attendance" },
    att && !att.closed && att.absent > 0 && { level: "blue", label: "Students absent today", detail: att.percent !== null ? `Attendance ${att.percent}% so far · parents told automatically` : undefined, value: att.absent, href: "/attendance" },
    hr && hr.onLeave.length > 0 && { level: "blue", label: "Staff on leave today", detail: hr.onLeave.slice(0, 3).map((l) => l.staff.name).join(", "), value: hr.onLeave.length, href: "/hr" },
    hr && hasPerm(user, "hr.manage") && hr.docs.length + hr.probation.length > 0 && { level: "amber", label: "Staff documents or probation due", detail: "Expiring documents and probation ending in 30 days", value: hr.docs.length + hr.probation.length, href: "/hr" },
    assets && assets.underRepair > 0 && { level: "blue", label: "Assets under repair", detail: "Follow up with the repairer", value: assets.underRepair, href: "/assets?status=UNDER_REPAIR" },
    assets && assets.warrantyExpiring > 0 && { level: "amber", label: "Asset warranties ending in 30 days", detail: "Claim any faults before they lapse", value: assets.warrantyExpiring, href: "/assets?warranty=soon" },
    un && un.readyForPickup > 0 && { level: "blue", label: "Uniform orders ready for pickup", detail: "Parents have been told to collect", value: un.readyForPickup, href: "/uniforms/orders?status=READY" },
    fe && dueIn3Weeks > 0 && { level: "blue", label: "Fees falling due in the next 3 weeks", detail: `${money(deadlines.reduce((s, d) => s + Number(d._sum.balance ?? 0), 0))} across ${dueIn3Weeks} fee lines`, value: dueIn3Weeks, href: "/fees/accounts" },
  ].filter(Boolean) as AttentionItem[];

  return (
    <>
      <PageHeader title="Dashboard" description={`School status at ${fmtDateTime(new Date())}`}
        actions={<>
          {hasPerm(user, "students.manage") && <LinkButton href="/students/new"><Plus className="size-4" />Add student</LinkButton>}
          {hasPerm(user, "fees.collect") && <LinkButton href="/fees/collect" variant="primary"><HandCoins className="size-4" />Collect fee</LinkButton>}
        </>} />

      <NeedsAttention items={attention} />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {fe && <StatCard label="Collected today" value={money(fe.collectedToday)} hint={`Month ${money(fe.collectedMonth)} · Year ${money(fe.collectedYear)}`} href="/fees/payments" icon={<IndianRupee className="size-5" />} tone="green" />}
        {fe && <StatCard label="Pending dues" value={money(fe.pendingDues)} hint={`${money(fe.overdueDues)} overdue`} href="/fees/defaulters" icon={<Wallet className="size-5" />} tone="red" />}
        {can.students && <StatCard label="Active students" value={number(totalStudents)} hint={`${newAdmissions} new admission${newAdmissions === 1 ? "" : "s"} this month`} href="/students" icon={<GraduationCap className="size-5" />} />}
        {tr && <StatCard label="Bus seats filled" value={`${tr.seatsFilled} / ${tr.seats}`} hint={`${tr.buses} buses · ${tr.routes} routes`} href="/transport/buses" icon={<Bus className="size-5" />} tone="blue" />}
      </div>
      <div className="mt-3 sm:mt-4">
        <StatStrip items={[
          ...(st ? [{ label: "Stationery stock value", value: money(st.stockValue), hint: `${st.totalItems} items`, href: "/stationery/items" },
            { label: "Low-stock alerts", value: st.lowStock.length, hint: `${st.pendingRequests} pending teacher request${st.pendingRequests === 1 ? "" : "s"}`, href: "/stationery/items?stock=low" }] : []),
          ...(un ? [{ label: "Uniform orders open", value: un.openOrders, hint: `${un.readyForPickup} ready for pickup`, href: "/uniforms/orders" }] : []),
          ...(tr ? [{ label: "Transport alerts", value: tr.docsExpiringSoon.length + tr.busesDueForService.length, hint: `${tr.docsExpiringSoon.length} documents expiring · ${tr.busesDueForService.length} due for service`, href: "/transport/documents" }] : []),
        ]} />
      </div>

      <div className="mt-6 grid gap-4 sm:gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        {fe && (
          <Card className="lg:col-span-2">
            <CardHeader title="Fee collection trend" description="Last 12 months" actions={<Link href="/reports/fees.collection" className="text-xs font-medium text-brand-700">Report →</Link>} />
            <CardBody><ReportChart type="bar" data={fe.trend} x="month" y={["amount"]} labels={{ amount: "Collected" }} money /></CardBody>
          </Card>
        )}
        {fe && (
          <Card>
            <CardHeader title="Top defaulters" actions={<Link href="/fees/defaulters" className="text-xs font-medium text-brand-700">All →</Link>} />
            <div className="divide-y divide-slate-100">
              {fe.topDefaulters.length === 0 && <p className="px-5 py-6 text-center text-sm text-slate-500">No defaulters.</p>}
              {fe.topDefaulters.slice(0, 6).map((d) => (
                <Link key={d.studentId} href={`/fees/accounts/${d.studentId}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-slate-50">
                  <span className="min-w-0"><span className="block truncate font-medium">{d.name}</span><span className="text-xs text-slate-500">{d.className}</span></span>
                  <span className="font-semibold text-rose-700 tabular-nums">{money(d.amount)}</span>
                </Link>
              ))}
            </div>
          </Card>
        )}

        {can.students && (
          <Card className={fe ? "" : "lg:col-span-2"}>
            <CardHeader title="Students by class" actions={<Link href="/reports/students-strength" className="text-xs font-medium text-brand-700">Report →</Link>} />
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <THead><tr><TH>Class</TH><TH>Sections</TH><TH align="right">Total</TH></tr></THead>
                <TBody>{byClass.map((c) => <TR key={c.name}><TD>{c.name}</TD><TD className="text-xs text-slate-500">{c.sections}</TD><TD align="right">{Number(c.total)}</TD></TR>)}</TBody>
              </Table>
            </div>
          </Card>
        )}

        {st && (
          <Card>
            <CardHeader title="Low stock" description="At or below reorder level" actions={<Link href="/stationery/purchases" className="text-xs font-medium text-brand-700">Purchase orders →</Link>} />
            <div className="divide-y divide-slate-100">
              {st.lowStock.length === 0 && <p className="px-5 py-6 text-center text-sm text-slate-500">All items are above reorder level.</p>}
              {st.lowStock.slice(0, 6).map((i) => (
                <Link key={i.id} href={`/stationery/items/${i.id}`} className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-slate-50"><span>{i.name}</span><Badge tone={i.currentStock === 0 ? "red" : "yellow"}>{i.currentStock} / {i.reorderLevel}</Badge></Link>
              ))}
            </div>
          </Card>
        )}

        {un && (
          <Card>
            <CardHeader title="Uniform size shortages" actions={<Link href="/uniforms/stock" className="text-xs font-medium text-brand-700">Stock matrix →</Link>} />
            <div className="divide-y divide-slate-100">
              {un.sizeShortages.length === 0 && <p className="px-5 py-6 text-center text-sm text-slate-500">No shortages.</p>}
              {un.sizeShortages.slice(0, 6).map((s, i) => (
                <div key={i} className="flex items-center justify-between px-5 py-2.5 text-sm"><span>{s.itemName} · {s.size}</span><span className="text-xs text-slate-500">stock {s.stock} · need {s.needed}</span></div>
              ))}
            </div>
          </Card>
        )}

        {tr && (
          <Card>
            <CardHeader title="Transport alerts" actions={<Link href="/transport/maintenance" className="text-xs font-medium text-brand-700">Maintenance →</Link>} />
            <div className="divide-y divide-slate-100 text-sm">
              {tr.docsExpiringSoon.length + tr.busesDueForService.length === 0 && <p className="px-5 py-6 text-center text-slate-500">Nothing due.</p>}
              {tr.docsExpiringSoon.slice(0, 5).map((d) => (
                <Link key={d.id} href="/transport/documents" className="flex items-center justify-between gap-2 px-5 py-2.5 hover:bg-slate-50"><span className="flex items-center gap-2"><FileWarning className="size-4 text-amber-500" />{d.busNo} · {d.type.replace("_", " ").toLowerCase()}</span><span className={`text-xs ${d.expiryDate < new Date() ? "text-rose-600" : "text-amber-700"}`}>{d.expiryDate < new Date() ? "expired" : "expires"} {fmtDate(d.expiryDate)}</span></Link>
              ))}
              {tr.busesDueForService.slice(0, 5).map((s) => (
                <Link key={s.busId} href={`/transport/buses/${s.busId}`} className="flex items-center justify-between gap-2 px-5 py-2.5 hover:bg-slate-50"><span className="flex items-center gap-2"><Wrench className="size-4 text-slate-400" />{s.busNo}</span><span className="text-xs text-slate-500">{s.reason}</span></Link>
              ))}
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="Today & upcoming" />
          <CardBody className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone="green">{approvedToday[0]} stationery approvals today</Badge>
              <Badge tone="green">{approvedToday[1]} concessions approved today</Badge>
              <Badge tone="blue">{approvedToday[2]} refunds decided today</Badge>
            </div>
            {deadlines.map((d) => (
              <div key={d.dueDate.toISOString()} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><Clock className="size-4 text-slate-400" />Fees due {fmtDate(d.dueDate)}</span><span className="text-xs text-slate-500">{d._count} lines · {money(d._sum.balance)}</span></div>
            ))}
            {events.map((e) => <div key={e.id} className="flex items-center justify-between gap-2"><span className="flex items-center gap-2"><ClipboardList className="size-4 text-slate-400" />{e.title}</span><span className="text-xs text-slate-500">{fmtDate(e.date)}</span></div>)}
            {deadlines.length === 0 && events.length === 0 && <p className="text-slate-500">No deadlines in the next 3 weeks.</p>}
          </CardBody>
        </Card>

        {activity.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader title="Recent activity" actions={hasPerm(user, "audit.view") && <Link href="/audit" className="text-xs font-medium text-brand-700">Audit log →</Link>} />
            <div className="divide-y divide-slate-100">
              {activity.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><Package className="size-4 shrink-0 text-slate-400" /><span className="truncate"><b className="font-medium">{a.userName}</b> {a.action === "CREATE" ? "added" : a.action === "DELETE" ? "removed" : "updated"} {a.entity.replace(/([A-Z])/g, " $1").trim().toLowerCase()}</span></span>
                  <span className="shrink-0 text-xs text-slate-400">{fmtDateTime(a.createdAt)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

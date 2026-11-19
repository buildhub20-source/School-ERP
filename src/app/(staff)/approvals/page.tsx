import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { pendingStationeryApprovals } from "@/server/stationery/dashboard";
import { pendingFeeApprovals } from "@/server/fees/dashboard";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { PageHeader, Card, CardHeader, Badge, EmptyState } from "@/components/ui";
import { fmtDateTime, money } from "@/lib/format";
import { ChevronRight } from "lucide-react";

export const metadata = { title: "Approvals" };

type Item = { href: string; kind: string; title: string; sub: string; at: Date };

export default async function ApprovalsPage() {
  const user = await requireUser("approvals.view");
  const [stat, fees, leaves] = await Promise.all([
    hasPerm(user, "stationery.approve") ? pendingStationeryApprovals(user.branchId) : [],
    hasPerm(user, ["fees.concession.approve", "fees.refund.approve"]) ? pendingFeeApprovals(user.branchId) : { concessions: [], refunds: [], adjustments: [] },
    hasPerm(user, "hr.leave.approve") ? db.leaveRequest.findMany({ where: { branchId: user.branchId, status: "PENDING", staff: { OR: [{ userId: null }, { userId: { not: user.id } }] } }, include: { staff: true, leaveType: true } }) : [],
  ]);
  const items: Item[] = [
    ...stat.map((r) => ({ href: `/stationery/requests/${r.id}`, kind: "Stationery request", title: `${r.requestNo} · ${r.requestedBy}`, sub: `${r.lineCount} item${r.lineCount === 1 ? "" : "s"}`, at: r.createdAt })),
    ...(hasPerm(user, "fees.concession.approve") ? fees.concessions.map((c) => ({ href: `/fees/concessions?status=PENDING#${c.id}`, kind: "Concession", title: `${c.studentName} · ${c.type.replace("_", " ").toLowerCase()}`, sub: c.mode === "PERCENT" ? `${c.value}%` : money(c.value), at: c.requestedAt })) : []),
    ...(hasPerm(user, "fees.refund.approve") ? fees.refunds.map((r) => ({ href: `/fees/refunds?status=PENDING#${r.id}`, kind: "Refund", title: `${r.studentName} · ${money(r.amount)}`, sub: r.reason, at: r.requestedAt })) : []),
    ...(hasPerm(user, "fees.refund.approve") ? fees.adjustments.map((a) => ({ href: `/fees/refunds?tab=adjustments&status=PENDING#${a.id}`, kind: "Fee adjustment", title: `${a.studentName} · ${money(a.amount)}`, sub: a.reason, at: a.requestedAt })) : []),
    ...leaves.map((l) => ({ href: `/hr/leave?status=PENDING#${l.id}`, kind: "Staff leave", title: `${l.staff.name} · ${l.leaveType.name}`, sub: `${Number(l.days)} day${Number(l.days) === 1 ? "" : "s"} from ${fmtDate(l.fromDate)}: ${l.reason}`, at: l.appliedAt })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const kinds = [...new Set(items.map((i) => i.kind))];
  return (
    <>
      <PageHeader title="Approvals" description="Everything waiting for a decision — stationery requests, concessions, refunds, fee adjustments and staff leave — oldest first." />
      <div className="mb-4 flex flex-wrap gap-2">{kinds.map((k) => <Badge key={k} tone="yellow">{items.filter((i) => i.kind === k).length} {k.toLowerCase()}{items.filter((i) => i.kind === k).length === 1 ? "" : "s"}</Badge>)}</div>
      {items.length === 0 ? <EmptyState title="Nothing waiting for approval" description="New requests appear here as soon as they are submitted." /> : (
        <Card>
          <CardHeader title={`${items.length} pending`} />
          <div className="divide-y divide-slate-100">
            {items.map((i) => (
              <Link key={i.kind + i.href} href={i.href} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50">
                <Badge tone={i.kind === "Stationery request" ? "indigo" : i.kind === "Refund" ? "red" : i.kind === "Staff leave" ? "blue" : "purple"} className="w-32 justify-center">{i.kind}</Badge>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-900">{i.title}</span><span className="block truncate text-xs text-slate-500">{i.sub}</span></span>
                <span className="hidden text-xs text-slate-400 sm:block">{fmtDateTime(i.at)}</span>
                <ChevronRight className="size-4 text-slate-300" />
              </Link>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

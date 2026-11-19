import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { feesDashboard, pendingFeeApprovals } from "@/server/fees/dashboard";
import { MODE_LABEL } from "@/server/fees/access";
import { PageHeader, Card, CardHeader, StatCard, Table, THead, TBody, TR, TH, TD, EmptyRow, StatusBadge, LinkButton } from "@/components/ui";
import { fullName, money, fmtDateTime, toNum } from "@/lib/format";
import { IndianRupee, CalendarDays, AlertTriangle, Wallet, TrendingUp, Plus } from "lucide-react";

export const metadata = { title: "Fees" };

export default async function FeesOverview() {
  const user = await requireUser(["fees.view", "transport.fees.view"]);
  if (!hasPerm(user, "fees.view")) redirect("/fees/accounts");
  const [d, approvals, recent, pendingOnline] = await Promise.all([
    feesDashboard(user.branchId),
    pendingFeeApprovals(user.branchId),
    db.payment.findMany({ where: { branchId: user.branchId, status: { not: "PENDING" } }, include: { student: { include: { schoolClass: true } } }, orderBy: { paidAt: "desc" }, take: 10 }),
    db.payment.count({ where: { branchId: user.branchId, status: "PENDING", source: "ONLINE" } }),
  ]);
  const maxTrend = Math.max(1, ...d.trend.map((t) => t.amount));
  const nApprovals = approvals.concessions.length + approvals.refunds.length + approvals.adjustments.length;
  return (
    <>
      <PageHeader title="Fees" description="Collections, dues and approvals at a glance."
        actions={<>{hasPerm(user, "fees.collect") && <LinkButton href="/fees/collect" variant="primary"><IndianRupee className="size-4" />Collect fee</LinkButton>}{hasPerm(user, "fees.setup") && <LinkButton href="/fees/structure/new"><Plus className="size-4" />Add new fee</LinkButton>}<LinkButton href="/fees/defaulters">Defaulters</LinkButton></>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Collected today" value={money(d.collectedToday)} icon={<Wallet className="size-5" />} tone="green" href="/fees/cashbook" />
        <StatCard label="This month" value={money(d.collectedMonth)} icon={<CalendarDays className="size-5" />} href="/fees/payments" />
        <StatCard label="This year" value={money(d.collectedYear)} icon={<TrendingUp className="size-5" />} tone="blue" href="/reports/fees.collection?groupBy=month" />
        <StatCard label="Pending dues" value={money(d.pendingDues)} icon={<IndianRupee className="size-5" />} tone="yellow" href="/fees/accounts?dues=due" />
        <StatCard label="Overdue" value={money(d.overdueDues)} icon={<AlertTriangle className="size-5" />} tone="red" href="/fees/accounts?dues=overdue" />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Collection trend" description="Fee collections, last 12 months" />
          <div className="flex h-48 items-end gap-1.5 overflow-x-auto px-4 pb-3 pt-4">
            {d.trend.map((t) => (
              <div key={t.month} className="flex min-w-8 flex-1 flex-col items-center gap-1" title={`${t.month}: ${money(t.amount)}`}>
                <div className="w-full rounded-t bg-brand-500" style={{ height: `${Math.max(2, (t.amount / maxTrend) * 140)}px` }} />
                <span className="text-[10px] text-slate-500">{t.month}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Needs attention" />
          <ul className="divide-y divide-slate-100 text-sm">
            <li className="flex justify-between px-4 py-2.5"><Link className="hover:text-brand-700" href="/fees/concessions?status=PENDING">Concessions awaiting approval</Link><b>{approvals.concessions.length}</b></li>
            <li className="flex justify-between px-4 py-2.5"><Link className="hover:text-brand-700" href="/fees/refunds">Refunds awaiting approval</Link><b>{approvals.refunds.length}</b></li>
            <li className="flex justify-between px-4 py-2.5"><Link className="hover:text-brand-700" href="/fees/refunds?tab=adjustments">Adjustments awaiting approval</Link><b>{approvals.adjustments.length}</b></li>
            <li className="flex justify-between px-4 py-2.5"><Link className="hover:text-brand-700" href="/fees/payments?status=PENDING">Online payments pending</Link><b>{pendingOnline}</b></li>
            <li className="flex justify-between px-4 py-2.5"><span className="text-slate-500">Total approvals</span><b>{nApprovals}</b></li>
          </ul>
        </Card>
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top defaulters" actions={<LinkButton href="/fees/defaulters" size="sm">All</LinkButton>} />
          <Table>
            <THead><tr><TH>Student</TH><TH>Class</TH><TH align="right">Overdue</TH></tr></THead>
            <TBody>
              {d.topDefaulters.length === 0 && <EmptyRow colSpan={3} message="No defaulters." />}
              {d.topDefaulters.map((t) => <TR key={t.studentId}><TD><Link className="font-medium hover:text-brand-700" href={`/fees/accounts/${t.studentId}`}>{t.name}</Link></TD><TD>{t.className}</TD><TD align="right">{money(t.amount)}</TD></TR>)}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Recent receipts" actions={<LinkButton href="/fees/payments" size="sm">All</LinkButton>} />
          <Table>
            <THead><tr><TH>Receipt</TH><TH>Student</TH><TH>Mode</TH><TH align="right">Amount</TH><TH>Status</TH></tr></THead>
            <TBody>
              {recent.length === 0 && <EmptyRow colSpan={5} />}
              {recent.map((p) => (
                <TR key={p.id}>
                  <TD><Link className="font-mono text-xs hover:text-brand-700" href={`/fees/payments/${p.id}`}>{p.receiptNo ?? "—"}</Link><span className="block text-xs text-slate-500">{fmtDateTime(p.paidAt)}</span></TD>
                  <TD>{fullName(p.student)}<span className="block text-xs text-slate-500">{p.student.schoolClass.name}</span></TD>
                  <TD>{MODE_LABEL[p.mode]}</TD><TD align="right">{money(toNum(p.amount))}</TD><TD><StatusBadge status={p.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}

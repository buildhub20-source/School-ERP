import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { requireFeeScope, MODE_LABEL, CONCESSION_LABEL } from "@/server/fees/access";
import { accountDetail } from "@/server/fees/queries";
import { feeNet } from "@/server/fees/core";
import { PageHeader, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow, StatusBadge, LinkButton, StatCard, Badge } from "@/components/ui";
import { fullName, money, fmtDate, fmtDateTime, isoDate, toNum, round2, today } from "@/lib/format";
import { AddLineForm, SplitLineForm, ConcessionRequestForm, AdjustmentForm } from "../../fee-forms";
import { FileText } from "lucide-react";
import { FeeNameLink } from "../../fee-name-link";

export const metadata = { title: "Fee account" };

export default async function AccountPage({ params }: { params: Promise<{ studentId: string }> }) {
  const user = await requireUser(["fees.view", "transport.fees.view"]);
  const scope = requireFeeScope(user);
  const { studentId } = await params;
  const a = await accountDetail(user.branchId, studentId, scope);
  if (!a) notFound();
  const { student } = a;
  const full = scope === "full";
  const canSetup = full && hasPerm(user, "fees.setup");
  const canAdjust = full && hasPerm(user, "fees.refund.request");
  const [heads, year] = canSetup || full ? await Promise.all([
    db.feeHead.findMany({ where: { branchId: user.branchId, isActive: true }, orderBy: { name: "asc" } }),
    db.academicYear.findFirst({ where: { isCurrent: true }, include: { terms: { orderBy: { sequence: "asc" } } } }),
  ]) : [[], null];
  const t = today();
  const active = a.lines.filter((l) => l.status !== "CANCELLED");
  const net = round2(active.reduce((s, l) => s + feeNet(l), 0));
  const paid = round2(active.reduce((s, l) => s + toNum(l.paidAmount), 0));
  const bal = round2(active.reduce((s, l) => s + toNum(l.balance), 0));
  const overdue = round2(active.filter((l) => (l.status === "PENDING" || l.status === "PARTIAL") && l.dueDate < t).reduce((s, l) => s + Math.max(0, toNum(l.balance)), 0));
  const years = [...new Map(a.lines.map((l) => [l.academicYearId, l.academicYear])).values()];
  const headOpts = heads.map((h) => ({ value: h.id, label: h.name }));
  // Receipts that paid towards each fee line (successful receipts only), so a paid line can be opened or printed.
  const receiptsByLine = new Map<string, { id: string; receiptNo: string }[]>();
  for (const p of a.payments) {
    if (p.status !== "SUCCESS" || !p.receiptNo || p.purpose !== "FEE") continue;
    for (const x of p.allocations) {
      if (toNum(x.amount) <= 0) continue;
      const list = receiptsByLine.get(x.studentFeeId) ?? [];
      if (!list.some((r) => r.id === p.id)) list.push({ id: p.id, receiptNo: p.receiptNo });
      receiptsByLine.set(x.studentFeeId, list);
    }
  }
  return (
    <>
      <PageHeader title={fullName(student)} description={`${student.admissionNo} · ${student.schoolClass.name}${student.section ? ` - ${student.section.name}` : ""}${scope === "transport" ? " · transport fees only" : ""}`}
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Accounts", href: "/fees/accounts" }, { label: fullName(student) }]}
        actions={<>
          <LinkButton href={`/api/fees/statement/${student.id}`} target="_blank" prefetch={false}><FileText className="size-4" />Fee statement</LinkButton>
          {full && <LinkButton href={`/students/${student.id}`}>Profile</LinkButton>}
          {canSetup && <AddLineForm studentId={student.id} heads={headOpts.filter((h) => heads.find((x) => x.id === h.value)?.type !== "TRANSPORT")} terms={year?.terms.map((x) => ({ value: x.id, label: x.name })) ?? []} today={isoDate()} />}
          {full && hasPerm(user, "fees.concession.request") && <ConcessionRequestForm studentId={student.id} heads={headOpts} />}
          {full && hasPerm(user, "fees.collect") && <LinkButton href={`/fees/collect?studentId=${student.id}`} variant="primary">Collect</LinkButton>}
        </>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Payable" value={money(net)} />
        <StatCard label="Paid" value={money(paid)} tone="green" />
        <StatCard label={bal < 0 ? "Credit" : "Balance"} value={money(Math.abs(bal))} tone={bal < 0 ? "blue" : "yellow"} />
        <StatCard label="Overdue" value={money(overdue)} tone="red" />
      </div>
      {years.length === 0 && <Card className="mb-5"><Table><TBody><EmptyRow colSpan={1} message="No fees on this account yet." /></TBody></Table></Card>}
      {years.map((y) => {
        const lines = a.lines.filter((l) => l.academicYearId === y.id);
        return (
          <Card key={y.id} className="mb-5">
            <CardHeader title={`Academic year ${y.name}`} />
            <Table>
              <THead><tr><TH>Fee</TH><TH>Due</TH><TH align="right">Amount</TH><TH align="right">Concession</TH><TH align="right">Late fee</TH><TH align="right">Adjustment</TH><TH align="right">Paid</TH><TH align="right">Balance</TH><TH>Status</TH>{(canSetup || canAdjust) && <TH></TH>}</tr></THead>
              <TBody>
                {lines.map((l) => {
                  const od = (l.status === "PENDING" || l.status === "PARTIAL") && l.dueDate < t;
                  return (
                    <TR key={l.id} highlight={od ? "red" : undefined} className={l.status === "CANCELLED" ? "text-slate-400 line-through" : ""}>
                      <TD><FeeNameLink name={l.description} full={full} receipts={receiptsByLine.get(l.id) ?? []} /><span className="block text-xs text-slate-500">{l.feeHead.name}{l.source !== "STRUCTURE" ? ` · ${l.source.toLowerCase().replace("_", " ")}` : ""}</span></TD>
                      <TD className={`whitespace-nowrap ${od ? "font-medium text-rose-700" : ""}`}>{fmtDate(l.dueDate)}</TD>
                      <TD align="right">{money(l.amount)}</TD>
                      <TD align="right">{toNum(l.concessionAmount) ? `−${money(l.concessionAmount)}` : "—"}</TD>
                      <TD align="right">{toNum(l.lateFeeAmount) ? money(l.lateFeeAmount) : "—"}</TD>
                      <TD align="right">{toNum(l.adjustmentAmount) ? money(l.adjustmentAmount) : "—"}</TD>
                      <TD align="right">{money(l.paidAmount)}</TD>
                      <TD align="right" className="font-medium">{money(l.balance)}</TD>
                      <TD><StatusBadge status={od ? "OVERDUE" : l.status} /></TD>
                      {(canSetup || canAdjust) && <TD align="right" className="whitespace-nowrap">
                        {canSetup && l.status === "PENDING" && toNum(l.paidAmount) === 0 && toNum(l.lateFeeAmount) === 0 && toNum(l.adjustmentAmount) === 0 && <SplitLineForm line={{ id: l.id, description: l.description, amount: toNum(l.amount), dueDate: isoDate(l.dueDate) }} />}
                        {canAdjust && l.status !== "CANCELLED" && <AdjustmentForm line={{ id: l.id, description: l.description, net: feeNet(l) }} />}
                      </TD>}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        );
      })}
      <Card className="mb-5">
        <CardHeader title="Payments" />
        <Table>
          <THead><tr><TH>Receipt</TH><TH>Date</TH><TH>Mode</TH><TH>Allocated to</TH><TH align="right">Amount</TH><TH>Status</TH></tr></THead>
          <TBody>
            {a.payments.length === 0 && <EmptyRow colSpan={6} message="No payments yet." />}
            {a.payments.map((p) => (
              <TR key={p.id}>
                <TD>{full ? <Link href={`/fees/payments/${p.id}`} className="font-mono text-xs hover:text-brand-700">{p.receiptNo ?? "—"}</Link> : <span className="font-mono text-xs">{p.receiptNo}</span>}</TD>
                <TD className="whitespace-nowrap">{fmtDateTime(p.paidAt)}</TD>
                <TD>{MODE_LABEL[p.mode]}{p.source === "ONLINE" ? " (online)" : ""}</TD>
                <TD className="text-xs text-slate-600">{p.purpose === "UNIFORM" ? "Uniform order" : p.allocations.filter((x) => toNum(x.amount) > 0).map((x) => `${x.studentFee.description}: ${money(x.amount)}`).join("; ")}</TD>
                <TD align="right">{money(p.shownAmount)}{full && toNum(p.refundedAmount) > 0 && <span className="block text-xs text-amber-700">refunded {money(p.refundedAmount)}</span>}</TD>
                <TD><StatusBadge status={p.status} /></TD>
              </TR>
            ))}
            {a.pendingOnline.map((p) => <TR key={p.id} highlight="yellow"><TD colSpan={4} className="text-xs">Online payment in progress ({p.gateway}) since {fmtDateTime(p.createdAt)}</TD><TD align="right">{money(p.amount)}</TD><TD><StatusBadge status="PENDING" /></TD></TR>)}
          </TBody>
        </Table>
      </Card>
      {full && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Concessions" />
            <Table>
              <THead><tr><TH>Type</TH><TH>Year</TH><TH>Value</TH><TH>Reason</TH><TH>Status</TH></tr></THead>
              <TBody>
                {a.concessions.length === 0 && <EmptyRow colSpan={5} message="No concessions." />}
                {a.concessions.map((c) => <TR key={c.id}><TD>{CONCESSION_LABEL[c.type]}<span className="block text-xs text-slate-500">{c.feeHead?.name ?? "Tuition fees"}</span></TD><TD>{c.academicYear.name}</TD><TD>{c.mode === "PERCENT" ? `${toNum(c.value)}%` : money(c.value)}</TD><TD className="text-xs">{c.reason}{c.decisionNote && <span className="block text-slate-500">Decision: {c.decisionNote}</span>}</TD><TD><StatusBadge status={c.status} /></TD></TR>)}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Adjustments & refunds" />
            <Table>
              <THead><tr><TH>What</TH><TH align="right">Amount</TH><TH>Reason</TH><TH>Status</TH></tr></THead>
              <TBody>
                {a.adjustments.length + a.refunds.length === 0 && <EmptyRow colSpan={4} message="None." />}
                {a.adjustments.map((x) => <TR key={x.id}><TD>Adjustment<span className="block text-xs text-slate-500">{x.studentFee.description}</span></TD><TD align="right">{money(x.amount)}</TD><TD className="text-xs">{x.reason}</TD><TD><StatusBadge status={x.status} /></TD></TR>)}
                {a.refunds.map((x) => <TR key={x.id}><TD>Refund<span className="block text-xs text-slate-500">{x.payment.receiptNo}</span></TD><TD align="right">{money(x.amount)}</TD><TD className="text-xs">{x.reason}{x.waiveFee && <Badge className="ml-1">fee waived</Badge>}</TD><TD><StatusBadge status={x.status} /></TD></TR>)}
              </TBody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}

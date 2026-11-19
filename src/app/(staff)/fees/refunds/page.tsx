import Link from "next/link";
import type { ApprovalStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { MODE_LABEL } from "@/server/fees/access";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, StatusBadge, Tabs, Pagination, pageParams, sp, Badge } from "@/components/ui";
import { ActionButton, FilterBar, FilterSelect } from "@/components/ui/client";
import { fullName, money, fmtDate } from "@/lib/format";
import { ApproveRefundForm } from "../fee-forms";
import { decideRefundAction, decideAdjustmentAction } from "../actions";

export const metadata = { title: "Refunds & adjustments" };

export default async function RefundsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser(["fees.refund.request", "fees.refund.approve"]);
  const s = await searchParams;
  const pg = pageParams(s);
  const tab = sp(s, "tab") === "adjustments" ? "adjustments" : "refunds";
  const status = (sp(s, "status") ?? "PENDING") as ApprovalStatus;
  const canApprove = hasPerm(user, "fees.refund.approve");
  const b = user.branchId;
  const [nRef, nAdj] = await Promise.all([
    db.refund.count({ where: { status: "PENDING", student: { branchId: b } } }),
    db.feeAdjustment.count({ where: { status: "PENDING", studentFee: { student: { branchId: b } } } }),
  ]);
  const refundWhere = { status, student: { branchId: b } };
  const adjWhere = { status, studentFee: { student: { branchId: b } } };
  const [total, refunds, adjustments] = await Promise.all([
    tab === "refunds" ? db.refund.count({ where: refundWhere }) : db.feeAdjustment.count({ where: adjWhere }),
    tab === "refunds" ? db.refund.findMany({ where: refundWhere, include: { student: { include: { schoolClass: true } }, payment: true }, orderBy: { createdAt: "desc" }, skip: pg.skip, take: pg.take }) : Promise.resolve([]),
    tab === "adjustments" ? db.feeAdjustment.findMany({ where: adjWhere, include: { studentFee: { include: { student: { include: { schoolClass: true } } } } }, orderBy: { createdAt: "desc" }, skip: pg.skip, take: pg.take }) : Promise.resolve([]),
  ]);
  const ids = [...refunds.flatMap((r) => [r.requestedById, r.approvedById]), ...adjustments.flatMap((r) => [r.requestedById, r.approvedById])].filter(Boolean) as string[];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const uname = (id: string | null) => users.find((u) => u.id === id)?.name ?? "—";
  const decided = (x: { status: string; approvedById: string | null; decidedAt: Date | null; decisionNote: string | null }) => <><StatusBadge status={x.status} /><span className="block text-xs text-slate-500">{uname(x.approvedById)} · {fmtDate(x.decidedAt)}</span>{x.decisionNote && <span className="block max-w-xs whitespace-normal text-xs text-slate-500">{x.decisionNote}</span>}</>;
  return (
    <>
      <PageHeader title="Refunds & adjustments" description="Every refund and fee adjustment records its reason, requester and approver. Request refunds from a receipt; adjustments from a student's fee account."
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Refunds & adjustments" }]} />
      <Tabs active={tab === "refunds" ? "/fees/refunds" : "/fees/refunds?tab=adjustments"} tabs={[{ href: "/fees/refunds", label: "Refunds", count: nRef }, { href: "/fees/refunds?tab=adjustments", label: "Adjustments", count: nAdj }]} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <input type="hidden" name="tab" value={tab} />
            <FilterSelect name="status" label="Pending" options={[{ value: "APPROVED", label: "Approved" }, { value: "REJECTED", label: "Rejected" }]} />
          </FilterBar>
        </div>
        {tab === "refunds" ? (
          <Table>
            <THead><tr><TH>Student</TH><TH>Receipt</TH><TH align="right">Amount</TH><TH>Reason</TH><TH>Requested</TH><TH>{status === "PENDING" ? "" : "Decision"}</TH></tr></THead>
            <TBody>
              {refunds.length === 0 && <EmptyRow colSpan={6} />}
              {refunds.map((r) => (
                <TR key={r.id}>
                  <TD><Link href={`/fees/accounts/${r.studentId}`} className="font-medium hover:text-brand-700">{fullName(r.student)}</Link><span className="block text-xs text-slate-500">{r.student.admissionNo} · {r.student.schoolClass.name}</span></TD>
                  <TD><Link href={`/fees/payments/${r.paymentId}`} className="font-mono text-xs hover:text-brand-700">{r.payment.receiptNo}</Link><span className="block text-xs text-slate-500">of {money(r.payment.amount)}</span></TD>
                  <TD align="right">{money(r.amount)}<span className="block text-xs text-slate-500">by {MODE_LABEL[r.mode]}</span></TD>
                  <TD className="max-w-xs text-xs">{r.reason}{r.waiveFee && <Badge className="ml-1" tone="purple">waive fee</Badge>}</TD>
                  <TD className="whitespace-nowrap text-xs">{fmtDate(r.createdAt)}<span className="block text-slate-500">{uname(r.requestedById)}</span></TD>
                  <TD className="whitespace-nowrap">{r.status === "PENDING" ? (canApprove ? <div className="flex gap-1"><ApproveRefundForm id={r.id} amount={Number(r.amount)} /><ActionButton action={decideRefundAction} args={{ id: r.id, approve: "false" }} variant="danger" confirm="Reject this refund?" reason reasonLabel="Reason for rejecting" successMessage="Rejected">Reject</ActionButton></div> : <StatusBadge status="PENDING" />) : decided(r)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Table>
            <THead><tr><TH>Student</TH><TH>Fee line</TH><TH align="right">Change</TH><TH>Reason</TH><TH>Requested</TH><TH>{status === "PENDING" ? "" : "Decision"}</TH></tr></THead>
            <TBody>
              {adjustments.length === 0 && <EmptyRow colSpan={6} />}
              {adjustments.map((a) => (
                <TR key={a.id}>
                  <TD><Link href={`/fees/accounts/${a.studentFee.studentId}`} className="font-medium hover:text-brand-700">{fullName(a.studentFee.student)}</Link><span className="block text-xs text-slate-500">{a.studentFee.student.admissionNo} · {a.studentFee.student.schoolClass.name}</span></TD>
                  <TD className="text-xs">{a.studentFee.description}</TD>
                  <TD align="right" className={Number(a.amount) < 0 ? "text-emerald-700" : "text-rose-700"}>{Number(a.amount) > 0 ? "+" : ""}{money(a.amount)}</TD>
                  <TD className="max-w-xs text-xs">{a.reason}</TD>
                  <TD className="whitespace-nowrap text-xs">{fmtDate(a.createdAt)}<span className="block text-slate-500">{uname(a.requestedById)}</span></TD>
                  <TD className="whitespace-nowrap">{a.status === "PENDING" ? (canApprove ? <div className="flex gap-1">
                    <ActionButton action={decideAdjustmentAction} args={{ id: a.id, approve: "true" }} variant="success" confirm="Approve this adjustment?" reason="optional" reasonLabel="Decision note" successMessage="Approved">Approve</ActionButton>
                    <ActionButton action={decideAdjustmentAction} args={{ id: a.id, approve: "false" }} variant="danger" confirm="Reject this adjustment?" reason reasonLabel="Reason for rejecting" successMessage="Rejected">Reject</ActionButton>
                  </div> : <StatusBadge status="PENDING" />) : decided(a)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={pg.page} pageSize={pg.pageSize} total={total} searchParams={s} basePath="/fees/refunds" />
      </Card>
    </>
  );
}

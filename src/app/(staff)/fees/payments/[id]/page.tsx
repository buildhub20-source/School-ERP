import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { loadReceipt, receiptLines, verifyUrl } from "@/server/fees/receipts";
import { MODE_LABEL, amountInWords } from "@/server/fees/access";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, StatusBadge, LinkButton, EmptyRow } from "@/components/ui";
import { ActionButton } from "@/components/ui/client";
import { fullName, money, fmtDate, fmtDateTime, toNum, round2 } from "@/lib/format";
import { ResendReceipt, RefundRequestForm } from "../../fee-forms";
import { cancelReceiptAction, bounceChequeAction, reconcileAction } from "../../actions";
import { Printer } from "lucide-react";

export const metadata = { title: "Receipt" };

export default async function PaymentDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("fees.view");
  const { id } = await params;
  const p = await loadReceipt(id).catch(() => null);
  if (!p || p.branchId !== user.branchId) notFound();
  const ok = p.status === "SUCCESS";
  const canCollect = hasPerm(user, "fees.collect");
  const pendingRefunds = p.refunds.filter((r) => r.status === "PENDING").reduce((s, r) => s + toNum(r.amount), 0);
  const refundable = round2(toNum(p.amount) - toNum(p.refundedAmount) - pendingRefunds);
  return (
    <>
      <PageHeader title={p.receiptNo ? `Receipt ${p.receiptNo}` : "Online payment"} description={`${fullName(p.student)} · ${money(p.amount)}`}
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Payments", href: "/fees/payments" }, { label: p.receiptNo ?? p.id }]}
        actions={<>
          {p.receiptNo && <LinkButton href={`/api/fees/receipts/${p.id}`} target="_blank" prefetch={false}><Printer className="size-4" />Print PDF</LinkButton>}
          {ok && canCollect && !p.reconciled && <ActionButton action={reconcileAction} args={{ id: p.id }} successMessage="Marked as matched with the bank">{p.mode === "CHEQUE" ? "Cheque cleared" : "Matched with bank"}</ActionButton>}
          {ok && canCollect && p.mode === "CHEQUE" && p.purpose === "FEE" && <ActionButton action={bounceChequeAction} args={{ id: p.id }} variant="danger" confirm="Mark this cheque as bounced?" reason reasonLabel="Bank's reason / remarks" successMessage="Cheque marked bounced; fees are due again">Cheque bounced</ActionButton>}
          {ok && canCollect && p.purpose === "FEE" && !p.dayClosingId && toNum(p.refundedAmount) === 0 && <ActionButton action={cancelReceiptAction} args={{ id: p.id }} variant="danger" confirm="Cancel this receipt?" reason reasonLabel="Reason for cancelling" successMessage="Receipt cancelled">Cancel receipt</ActionButton>}
          {ok && p.purpose === "FEE" && hasPerm(user, "fees.refund.request") && refundable > 0 && <RefundRequestForm paymentId={p.id} max={refundable} />}
        </>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Receipt" actions={<StatusBadge status={p.status} />} />
          <CardBody className="space-y-4">
            <DescList items={[
              { label: "Receipt no", value: p.receiptNo ?? "—" }, { label: "Date", value: fmtDateTime(p.paidAt) },
              { label: "Student", value: <Link className="text-brand-700 hover:underline" href={`/fees/accounts/${p.studentId}`}>{fullName(p.student)} ({p.student.admissionNo})</Link> },
              { label: "Class", value: `${p.student.schoolClass.name}${p.student.section ? ` - ${p.student.section.name}` : ""}` },
              { label: "Mode", value: `${MODE_LABEL[p.mode]} · ${p.source.toLowerCase()}${p.gateway ? ` (${p.gateway})` : ""}` },
              { label: p.mode === "CHEQUE" ? "Cheque" : "Reference", value: p.mode === "CHEQUE" ? `${p.reference ?? ""} · ${p.chequeBank ?? ""} · ${fmtDate(p.chequeDate)}` : p.reference ?? p.gatewayPaymentId ?? "—" },
              { label: "Collected by", value: p.collectedByName ?? (p.source === "ONLINE" ? "Online" : "—") },
              { label: "Bank reconciliation", value: p.reconciled ? `Reconciled ${fmtDateTime(p.reconciledAt)}` : "Not yet" },
              { label: "Cash book", value: p.dayClosing ? `Closed ${fmtDate(p.dayClosing.date)}` : "Open day" },
              { label: "Verification link", value: <a className="break-all text-brand-700 hover:underline" href={verifyUrl(p.verifyToken)} target="_blank">{verifyUrl(p.verifyToken)}</a> },
            ]} />
            <Table>
              <THead><tr><TH>Particulars</TH><TH align="right">Amount</TH></tr></THead>
              <TBody>
                {receiptLines(p).map((l, i) => <TR key={i}><TD>{l.description}<span className="block text-xs text-slate-500">{l.head}</span></TD><TD align="right">{money(l.amount)}</TD></TR>)}
                <TR><TD className="font-semibold">Total</TD><TD align="right" className="font-semibold">{money(p.amount)}</TD></TR>
              </TBody>
            </Table>
            <p className="text-sm italic text-slate-600">{amountInWords(toNum(p.amount))}</p>
            {p.notes && <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{p.notes}</p>}
          </CardBody>
        </Card>
        <div className="space-y-5">
          {ok && canCollect && p.receiptNo && <Card><CardHeader title="Send receipt to parents" /><CardBody><ResendReceipt id={p.id} /></CardBody></Card>}
          <Card>
            <CardHeader title="Refunds" />
            <Table>
              <THead><tr><TH>Date</TH><TH align="right">Amount</TH><TH>Status</TH></tr></THead>
              <TBody>
                {p.refunds.length === 0 && <EmptyRow colSpan={3} message="No refunds." />}
                {p.refunds.map((r) => <TR key={r.id}><TD>{fmtDate(r.createdAt)}<span className="block text-xs text-slate-500">{r.reason}</span></TD><TD align="right">{money(r.amount)}</TD><TD><StatusBadge status={r.status} /></TD></TR>)}
              </TBody>
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}

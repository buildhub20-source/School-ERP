import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { dayBook } from "@/server/fees/service";
import { MODE_LABEL, MODES } from "@/server/fees/access";
import { PageHeader, Card, CardHeader, CardBody, Table, THead, TBody, TR, TH, TD, EmptyRow, StatusBadge, StatCard, DescList, Badge, sp } from "@/components/ui";
import { FilterBar, FilterDate } from "@/components/ui/client";
import { fullName, money, fmtDate, fmtDateTime, isoDate, toNum, round2, today } from "@/lib/format";
import { CloseDayForm } from "../fee-forms";
import { Lock } from "lucide-react";

export const metadata = { title: "Cash book" };

export default async function CashbookPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("fees.cashbook");
  const s = await searchParams;
  const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(sp(s, "date") ?? "") ? sp(s, "date")! : isoDate();
  const book = await dayBook(user.branchId, new Date(dateStr + "T00:00:00.000Z"));
  const recent = await db.dayClosing.findMany({ where: { branchId: user.branchId }, orderBy: { date: "desc" }, take: 10 });
  const closer = book.closing?.closedById ? await db.user.findUnique({ where: { id: book.closing.closedById }, select: { name: true } }) : null;
  const expectedCash = round2(book.cash - book.refundsCash);
  const future = book.date > today();
  const afterClosing = book.closing ? book.payments.filter((p) => p.status === "SUCCESS" && p.dayClosingId !== book.closing!.id) : [];
  return (
    <>
      <PageHeader title="Daily cash book" description={`${fmtDate(book.date)} · counter totals by payment mode, matched against the bank`}
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Cash book" }]}
        actions={book.closing ? <Badge tone="green"><Lock className="mr-1 size-3" />Closed</Badge> : !future && <CloseDayForm date={dateStr} expectedCash={expectedCash} expectedBank={book.nonCash} />} />
      <Card className="mb-5"><div className="p-3"><FilterBar><FilterDate name="date" label="Date" /></FilterBar></div></Card>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total collected" value={money(book.total)} hint={`${book.count} receipts`} tone="green" />
        <StatCard label="Cash" value={money(book.cash)} hint={book.refundsCash ? `Cash refunds ${money(book.refundsCash)}` : undefined} />
        <StatCard label="Non-cash (bank)" value={money(book.nonCash)} tone="blue" />
        <StatCard label="Online" value={money(book.online)} hint={`Counter ${money(book.counter)}`} tone="gray" />
      </div>
      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="By payment mode" />
          <Table>
            <THead><tr><TH>Mode</TH><TH align="right">Amount</TH></tr></THead>
            <TBody>
              {MODES.map((m) => <TR key={m}><TD>{MODE_LABEL[m]}</TD><TD align="right">{money(book.totals[m] ?? 0)}</TD></TR>)}
              <TR><TD className="font-semibold">Total</TD><TD align="right" className="font-semibold">{money(book.total)}</TD></TR>
            </TBody>
          </Table>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Day-end closing" />
          <CardBody>
            {book.closing ? (
              <DescList cols={3} items={[
                { label: "Cash counted", value: money(book.closing.cashCounted) }, { label: "Bank credited", value: money(book.closing.bankCredited) },
                { label: "Cash deposited", value: money(book.closing.cashDeposited) },
                { label: "Difference", value: <span className={Math.abs(toNum(book.closing.difference)) > 0.009 ? "font-semibold text-amber-700" : "text-emerald-700"}>{money(book.closing.difference)}</span> },
                { label: "Closed by", value: `${closer?.name ?? "—"} · ${fmtDateTime(book.closing.createdAt)}` }, { label: "Notes", value: book.closing.notes ?? "—" },
              ]} />
            ) : future ? <p className="text-sm text-slate-500">This date is in the future.</p> : (
              <p className="text-sm text-slate-600">Count the cash, check the bank statement for UPI/card/net banking/cheque credits, then close the day. Expected cash <b>{money(expectedCash)}</b>, expected bank <b>{money(book.nonCash)}</b>. After closing, no payment on this day can be added, back-dated or cancelled.</p>
            )}
            {afterClosing.length > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{afterClosing.length} online payment(s) ({money(afterClosing.reduce((a, p) => a + toNum(p.amount), 0))}) arrived after closing; they are listed below but not in the closing.</p>}
          </CardBody>
        </Card>
      </div>
      <Card className="mb-5">
        <CardHeader title="Receipts of the day" />
        <Table>
          <THead><tr><TH>Time</TH><TH>Receipt</TH><TH>Student</TH><TH>Mode</TH><TH>Reference</TH><TH align="right">Amount</TH><TH>Status</TH></tr></THead>
          <TBody>
            {book.payments.length === 0 && <EmptyRow colSpan={7} message="No receipts on this day." />}
            {book.payments.map((p) => (
              <TR key={p.id} className={p.status !== "SUCCESS" ? "text-slate-400" : ""}>
                <TD className="whitespace-nowrap">{fmtDateTime(p.paidAt).split(", ").pop()}</TD>
                <TD><Link href={`/fees/payments/${p.id}`} className="font-mono text-xs hover:text-brand-700">{p.receiptNo}</Link></TD>
                <TD>{fullName(p.student)}<span className="block text-xs text-slate-500">{p.student.schoolClass.name}</span></TD>
                <TD>{MODE_LABEL[p.mode]}{p.source === "ONLINE" ? " (online)" : ""}</TD>
                <TD className="text-xs">{p.reference ?? p.gatewayPaymentId ?? "—"}</TD>
                <TD align="right">{money(p.amount)}</TD><TD><StatusBadge status={p.status} /></TD>
              </TR>
            ))}
            {book.refunds.map((r) => <TR key={r.id} highlight="yellow"><TD>{fmtDateTime(r.decidedAt).split(", ").pop()}</TD><TD className="text-xs">Refund · {r.payment.receiptNo}</TD><TD>{fullName(r.student)}</TD><TD>{MODE_LABEL[r.mode]}</TD><TD className="text-xs">{r.decisionNote}</TD><TD align="right">−{money(r.amount)}</TD><TD><StatusBadge status="APPROVED" label="Refund" /></TD></TR>)}
          </TBody>
        </Table>
      </Card>
      <Card>
        <CardHeader title="Recent closings" />
        <Table>
          <THead><tr><TH>Date</TH><TH align="right">System total</TH><TH align="right">Cash counted</TH><TH align="right">Bank credited</TH><TH align="right">Difference</TH></tr></THead>
          <TBody>
            {recent.length === 0 && <EmptyRow colSpan={5} message="No days closed yet." />}
            {recent.map((c) => <TR key={c.id}><TD><Link className="hover:text-brand-700" href={`/fees/cashbook?date=${isoDate(c.date)}`}>{fmtDate(c.date)}</Link></TD><TD align="right">{money((c.totals as Record<string, number>).total ?? 0)}</TD><TD align="right">{money(c.cashCounted)}</TD><TD align="right">{money(c.bankCredited)}</TD><TD align="right" className={Math.abs(toNum(c.difference)) > 0.009 ? "text-amber-700" : ""}>{money(c.difference)}</TD></TR>)}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

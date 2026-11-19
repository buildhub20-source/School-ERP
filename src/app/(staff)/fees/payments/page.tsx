import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { paymentWhere } from "@/server/fees/queries";
import { MODE_LABEL } from "@/server/fees/access";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, StatusBadge, Badge } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect, FilterDate, ActionButton } from "@/components/ui/client";
import { fullName, money, fmtDateTime, toNum } from "@/lib/format";
import { reconcileOnlineAction } from "../actions";

export const metadata = { title: "Payments & receipts" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("fees.view");
  const s = await searchParams;
  const pg = pageParams(s);
  const where = paymentWhere(user.branchId, { q: sp(s, "q"), mode: sp(s, "mode"), status: sp(s, "status"), source: sp(s, "source"), purpose: sp(s, "purpose"), from: sp(s, "from"), to: sp(s, "to"), reconciled: sp(s, "reconciled") });
  const [total, agg, rows] = await Promise.all([
    db.payment.count({ where }),
    db.payment.aggregate({ where: { AND: [where, { status: "SUCCESS" }] }, _sum: { amount: true } }),
    db.payment.findMany({ where, include: { student: { include: { schoolClass: true } } }, orderBy: { paidAt: "desc" }, skip: pg.skip, take: pg.take }),
  ]);
  return (
    <>
      <PageHeader title="Payments & receipts" description={`${total} payments · ${money(agg._sum.amount)} successful`} breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Payments" }]}
        actions={hasPerm(user, "fees.collect") && <ActionButton action={reconcileOnlineAction} args={{}} successMessage="@result">Reconcile online payments</ActionButton>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Receipt no, reference, student, admission no" />
            <FilterSelect name="mode" label="All modes" options={Object.entries(MODE_LABEL).map(([value, label]) => ({ value, label }))} />
            <FilterSelect name="status" label="All but pending" options={["SUCCESS", "PENDING", "FAILED", "BOUNCED", "CANCELLED"].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }))} />
            <FilterSelect name="source" label="Any source" options={[{ value: "COUNTER", label: "Counter" }, { value: "ONLINE", label: "Online" }, { value: "IMPORT", label: "Imported" }]} />
            <FilterSelect name="purpose" label="Fees & uniforms" options={[{ value: "FEE", label: "Fees" }, { value: "UNIFORM", label: "Uniforms" }]} />
            <FilterSelect name="reconciled" label="Any reconciliation" options={[{ value: "no", label: "Not reconciled" }]} />
            <FilterDate name="from" label="From" /><FilterDate name="to" label="To" />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Receipt</TH><TH>Date</TH><TH>Student</TH><TH>Mode</TH><TH>Reference</TH><TH align="right">Amount</TH><TH>Status</TH></tr></THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={7} />}
            {rows.map((p) => (
              <TR key={p.id}>
                <TD><Link href={`/fees/payments/${p.id}`} className="font-mono text-xs font-medium hover:text-brand-700">{p.receiptNo ?? "(no receipt)"}</Link>{p.purpose === "UNIFORM" && <Badge className="ml-1" tone="blue">Uniform</Badge>}</TD>
                <TD className="whitespace-nowrap">{fmtDateTime(p.paidAt)}</TD>
                <TD className="whitespace-nowrap"><Link href={`/fees/accounts/${p.studentId}`} className="hover:text-brand-700">{fullName(p.student)}</Link><span className="block text-xs text-slate-500">{p.student.admissionNo} · {p.student.schoolClass.name}</span></TD>
                <TD>{MODE_LABEL[p.mode]}<span className="block text-xs text-slate-500">{p.source.toLowerCase()}{p.status === "SUCCESS" && !p.reconciled ? " · not reconciled" : ""}</span></TD>
                <TD className="text-xs">{p.reference ?? p.gatewayPaymentId ?? "—"}</TD>
                <TD align="right">{money(p.amount)}{toNum(p.refundedAmount) > 0 && <span className="block text-xs text-amber-700">−{money(p.refundedAmount)} refunded</span>}</TD>
                <TD><StatusBadge status={p.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Pagination page={pg.page} pageSize={pg.pageSize} total={total} searchParams={s} basePath="/fees/payments" />
      </Card>
    </>
  );
}

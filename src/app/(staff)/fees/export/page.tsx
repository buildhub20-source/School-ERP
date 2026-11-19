import { requireUser } from "@/lib/auth/session";
import { exportSummary } from "@/server/fees/export";
import { getSetting } from "@/lib/settings";
import { PageHeader, Card, CardHeader, CardBody, Field, Input, FormGrid, sp, Button } from "@/components/ui";
import { money, isoDate } from "@/lib/format";

export const metadata = { title: "Export to accounting" };

export default async function ExportPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("fees.export");
  const s = await searchParams;
  const now = isoDate();
  const valid = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const from = valid(sp(s, "from")) ?? now.slice(0, 8) + "01";
  const to = valid(sp(s, "to")) ?? now;
  const [sum, school] = await Promise.all([exportSummary(user.branchId, { from, to }), getSetting("school", user.branchId)]);
  return (
    <>
      <PageHeader title="Export to accounting" description="Receipts and refunds for a date range — Excel for the auditor, or Tally-compatible XML (Gateway of Tally → Import Data → Vouchers)."
        breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Export" }]} />
      <Card>
        <CardHeader title="Date range and ledgers" description={`${sum.receipts} valid receipts · ${money(sum.amount)}${sum.excluded ? ` · ${sum.excluded} cancelled/bounced (listed in Excel, left out of Tally)` : ""} · ${sum.refunds} refunds (${money(sum.refundAmount)})`} />
        <CardBody>
          <form method="get" action="/api/fees/export" className="space-y-4" target="_blank">
            <FormGrid cols={3}>
              <Field label="From"><Input type="date" name="from" defaultValue={from} max={now} required /></Field>
              <Field label="To"><Input type="date" name="to" defaultValue={to} max={now} required /></Field>
              <Field label="Tally company name"><Input name="company" defaultValue={school.name} /></Field>
              <Field label="Cash ledger"><Input name="cashLedger" defaultValue="Cash" /></Field>
              <Field label="Bank ledger" hint="Used for cheque, UPI, card, net banking, transfer and online"><Input name="bankLedger" defaultValue="Bank Account" /></Field>
            </FormGrid>
            <p className="text-xs text-slate-500">Income ledgers are named after fee heads (create them in Tally under Indirect/Direct Incomes); uniform receipts go to “Uniform Sales”, refunds to “Fee Refunds”.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="format" value="xlsx">Download Excel</Button>
              <Button type="submit" name="format" value="tally" variant="secondary">Download Tally XML</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

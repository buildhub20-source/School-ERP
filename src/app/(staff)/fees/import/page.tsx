import { requireUser } from "@/lib/auth/session";
import { PageHeader, Card, CardHeader, CardBody, LinkButton } from "@/components/ui";
import { FeeImportForm } from "./import-form";
import { Download } from "lucide-react";

export const metadata = { title: "Import fees" };

export default async function FeeImportPage() {
  await requireUser("fees.setup");
  return (
    <>
      <PageHeader title="Import opening dues and past payments" breadcrumbs={[{ label: "Fees", href: "/fees" }, { label: "Import" }]} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Excel file" description="One row per due or payment, matched by admission number, into the current academic year."
            actions={<LinkButton href="/api/import/template?type=fees" size="sm" prefetch={false}><Download className="size-4" />Template</LinkButton>} />
          <CardBody><FeeImportForm /></CardBody>
        </Card>
        <Card>
          <CardHeader title="How it works" />
          <CardBody className="space-y-2 text-sm text-slate-600">
            <p><b>Type DUE</b>: Fee Head (must exist), Amount, Due Date, optional Description.</p>
            <p><b>Type PAYMENT</b>: Amount, Payment Date, Mode (Cash, Cheque, UPI, Card, Net banking, Bank transfer), optional Reference (e.g. old receipt no).</p>
            <p>Dues are created first; payments are allocated to the oldest open dues and get new receipt numbers. A payment cannot exceed the student&apos;s dues, and payments on closed cash-book days are rejected.</p>
            <p>Dates: DD/MM/YYYY. Check the file first — nothing is imported until every row is valid.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

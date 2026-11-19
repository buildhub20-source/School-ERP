import { requireUser } from "@/lib/auth/session";
import { PageHeader, Card, CardHeader, CardBody, LinkButton } from "@/components/ui";
import { Download } from "lucide-react";
import { StationeryImportForm } from "./import-form";

export const metadata = { title: "Import stationery" };

export default async function StationeryImportPage() {
  await requireUser("stationery.manage");
  return (
    <>
      <PageHeader title="Import items & opening stock" description="Start with your current stock register from Excel." breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Items", href: "/stationery/items" }, { label: "Import" }]} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Stationery items" description="One row per item. Check the file first; nothing is saved until you import."
            actions={<LinkButton href="/api/import/template?type=stationery" size="sm"><Download className="size-4" />Template</LinkButton>} />
          <CardBody><StationeryImportForm /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Columns" />
          <CardBody className="space-y-2 text-sm text-slate-600">
            <p><b>Name</b> is required and must be new. <b>Code</b> is the barcode/QR value; leave blank to generate one.</p>
            <p><b>Category</b>: Notebook, Pen, Pencil, Eraser, Sharpener, Ruler, File, Paper, Art &amp; Craft, Office or Other. <b>Unit</b> defaults to pcs.</p>
            <p><b>Opening Stock</b> is recorded as an opening-stock movement. <b>Unit Cost</b> in rupees.</p>
            <p><b>Reorder Level</b> / <b>Reorder Qty</b> drive low-stock alerts and draft purchase orders.</p>
            <p><b>Supplier</b>: the usual supplier&apos;s name; a new supplier is created if it does not exist.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

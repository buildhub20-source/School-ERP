import { requireUser } from "@/lib/auth/session";
import { PageHeader, Card, CardHeader, CardBody, LinkButton } from "@/components/ui";
import { ImportForm } from "./import-form-students";
import { Download } from "lucide-react";

export const metadata = { title: "Bulk import" };

export default async function ImportPage() {
  await requireUser("students.import");
  return (
    <>
      <PageHeader title="Bulk import from Excel" description="Start with your existing data: students, stationery stock, uniform stock and fee dues." breadcrumbs={[{ label: "Students", href: "/students" }, { label: "Import" }]} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Students and parents" description="One row per student. Classes must already exist; missing sections are created. Each parent mobile gets a parent login."
            actions={<LinkButton href="/api/import/template?type=students" size="sm"><Download className="size-4" />Template</LinkButton>} />
          <CardBody><ImportForm /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Other imports" />
          <CardBody className="space-y-3 text-sm">
            <p><a className="font-medium text-brand-700 hover:underline" href="/stationery/import">Stationery items and opening stock →</a></p>
            <p><a className="font-medium text-brand-700 hover:underline" href="/uniforms/import">Uniform items, sizes and opening stock →</a></p>
            <p><a className="font-medium text-brand-700 hover:underline" href="/fees/import">Opening fee dues and past payments →</a></p>
            <p className="text-xs text-slate-500">Import students first; the other imports match rows by admission number.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

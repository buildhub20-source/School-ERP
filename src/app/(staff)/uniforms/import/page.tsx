import { requireUser } from "@/lib/auth/session";
import { PageHeader, Card, CardHeader, CardBody, LinkButton } from "@/components/ui";
import { UniformImportForm } from "../_components/forms";
import { Download } from "lucide-react";

export const metadata = { title: "Import uniforms" };

export default async function UniformImportPage() {
  await requireUser("uniforms.manage");
  return (
    <>
      <PageHeader title="Import uniform items and stock" breadcrumbs={[{ label: "Uniforms", href: "/uniforms" }, { label: "Items", href: "/uniforms/items" }, { label: "Import" }]} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Items, sizes and opening stock" description="One row per item size. Check the file first; nothing is saved until you import."
            actions={<LinkButton href="/api/import/template?type=uniforms" size="sm"><Download className="size-4" />Template</LinkButton>} />
          <CardBody><UniformImportForm /></CardBody>
        </Card>
        <Card>
          <CardHeader title="How rows are matched" />
          <CardBody className="space-y-2 text-sm text-slate-600">
            <p><b>Item + Gender</b> identify an item; a new name creates the item.</p>
            <p><b>Size</b> identifies a size of that item; new sizes are added with <b>Stock</b> as opening stock.</p>
            <p>For existing sizes, <b>Stock</b> is the counted quantity: the difference is logged as an adjustment. Price and reorder level are updated.</p>
            <p>Category: Shirt, Pant, Skirt, Shorts, Shoes, Socks, Belt, Tie, ID card, Sweater, Badge, Other. Gender: Boy, Girl or Unisex.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

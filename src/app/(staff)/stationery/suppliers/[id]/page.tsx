import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { itemOptions } from "@/server/stationery/lookups";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, EmptyRow, StatusBadge, Badge, LinkButton, Pagination, pageParams } from "@/components/ui";
import { fmtDate, isoDate, money, toNum } from "@/lib/format";
import { Plus } from "lucide-react";
import { SupplierFormButton, QuoteButton } from "../supplier-forms";

export const metadata = { title: "Supplier" };

export default async function SupplierDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("stationery.view");
  const { id } = await params;
  const s = await searchParams;
  const sup = await db.supplier.findFirst({ where: { id, branchId: user.branchId } });
  if (!sup) notFound();
  const { page, pageSize, skip, take } = pageParams(s, 15);
  const [poCount, pos, prices, items, preferred] = await Promise.all([
    db.purchaseOrder.count({ where: { supplierId: id, type: "STATIONERY" } }),
    db.purchaseOrder.findMany({ where: { supplierId: id, type: "STATIONERY" }, include: { lines: { select: { qtyOrdered: true, unitPrice: true } } }, orderBy: { createdAt: "desc" }, skip, take }),
    db.supplierPrice.findMany({ where: { supplierId: id, stationeryItemId: { not: null } }, include: { stationeryItem: { select: { id: true, name: true, unit: true } } }, orderBy: { effectiveDate: "desc" }, take: 50 }),
    itemOptions(user.branchId),
    db.stationeryItem.findMany({ where: { preferredSupplierId: id, isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const manage = hasPerm(user, "stationery.manage");
  return (
    <>
      <PageHeader title={sup.name} breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Suppliers", href: "/stationery/suppliers" }, { label: sup.name }]}
        description={sup.isActive ? undefined : <Badge>Inactive</Badge>}
        actions={manage && <>
          <QuoteButton suppliers={[{ id: sup.id, name: sup.name }]} items={items} supplierId={sup.id} today={isoDate()} />
          <SupplierFormButton supplier={sup} />
          <LinkButton href={`/stationery/purchases/new?supplierId=${sup.id}`} variant="primary"><Plus className="size-4" />New order</LinkButton>
        </>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Contact" />
          <CardBody>
            <DescList cols={1} items={[
              { label: "Contact person", value: sup.contactPerson }, { label: "Mobile", value: sup.phone ? <a className="text-brand-700" href={`tel:${sup.phone}`}>{sup.phone}</a> : "—" },
              { label: "Email", value: sup.email ? <a className="text-brand-700" href={`mailto:${sup.email}`}>{sup.email}</a> : "—" }, { label: "GSTIN", value: sup.gstin },
              { label: "Address", value: sup.address }, { label: "Notes", value: sup.notes },
              { label: "Usual supplier for", value: preferred.length ? preferred.map((p, i) => <span key={p.id}>{i > 0 && ", "}<Link className="text-brand-700 hover:underline" href={`/stationery/items/${p.id}`}>{p.name}</Link></span>) : "—" },
            ]} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Purchase orders" description={`${poCount} order${poCount === 1 ? "" : "s"}`} />
          <Table>
            <THead><tr><TH>PO</TH><TH>Date</TH><TH align="right">Value</TH><TH>Status</TH></tr></THead>
            <TBody>
              {pos.length === 0 && <EmptyRow colSpan={4} message="No orders yet." />}
              {pos.map((p) => (
                <TR key={p.id}>
                  <TD><Link href={`/stationery/purchases/${p.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">{p.poNumber}</Link></TD>
                  <TD>{fmtDate(p.createdAt)}</TD>
                  <TD align="right">{money(p.lines.reduce((a, l) => a + l.qtyOrdered * toNum(l.unitPrice), 0))}</TD>
                  <TD><StatusBadge status={p.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={pageSize} total={poCount} searchParams={s} basePath={`/stationery/suppliers/${id}`} />
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="Price history" description="Most recent 50 prices. Compare with other suppliers on the Compare prices tab." actions={<LinkButton href="/stationery/suppliers?view=compare" size="sm">Compare prices</LinkButton>} />
          <Table>
            <THead><tr><TH>Date</TH><TH>Item</TH><TH align="right">Price</TH><TH>Source</TH></tr></THead>
            <TBody>
              {prices.length === 0 && <EmptyRow colSpan={4} message="No prices yet." />}
              {prices.map((p) => (
                <TR key={p.id}>
                  <TD>{fmtDate(p.effectiveDate)}</TD>
                  <TD><Link href={`/stationery/items/${p.stationeryItem!.id}`} className="hover:text-brand-700">{p.stationeryItem!.name}</Link></TD>
                  <TD align="right">{money(p.price)} <span className="text-xs text-slate-400">/ {p.stationeryItem!.unit}</span></TD>
                  <TD><Badge tone={p.source === "PURCHASE" ? "indigo" : "gray"}>{p.source === "PURCHASE" ? "Purchase" : "Quote"}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { CATEGORIES, UNITS, stockState } from "@/server/stationery/core";
import { supplierOptions } from "@/server/stationery/lookups";
import { priceComparison } from "@/server/stationery/service";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, EmptyRow, LinkButton, StatusBadge, Badge, Pagination, pageParams } from "@/components/ui";
import { fmtDate, money, toNum } from "@/lib/format";
import { QrCode } from "lucide-react";
import { ItemFormButton, ToggleItemButton } from "../item-form";
import { MovementTable, movementInclude } from "../../_components/movement-table";

export const metadata = { title: "Stationery item" };

export default async function ItemDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("stationery.view");
  const { id } = await params;
  const s = await searchParams;
  const item = await db.stationeryItem.findFirst({ where: { id, branchId: user.branchId }, include: { preferredSupplier: true } });
  if (!item) notFound();
  const { page, pageSize, skip, take } = pageParams(s, 20);
  const [total, moves, prices, suppliers, cmp, openPo] = await Promise.all([
    db.stockMovement.count({ where: { itemId: id } }),
    db.stockMovement.findMany({ where: { itemId: id }, include: movementInclude, orderBy: { createdAt: "desc" }, skip, take }),
    db.supplierPrice.findMany({ where: { stationeryItemId: id }, include: { supplier: { select: { id: true, name: true } } }, orderBy: { effectiveDate: "desc" }, take: 30 }),
    supplierOptions(user.branchId),
    priceComparison(user.branchId, [id]),
    db.purchaseOrderLine.findMany({ where: { stationeryItemId: id, po: { status: { in: ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"] } } }, include: { po: true } }),
  ]);
  const st = stockState(item);
  const latest = [...(cmp.latest.get(id)?.entries() ?? [])].map(([sid, v]) => ({ supplierId: sid, name: cmp.suppliers.get(sid) ?? "", ...v })).sort((a, b) => a.price - b.price);
  const manage = hasPerm(user, "stationery.manage");
  return (
    <>
      <PageHeader title={item.name} breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Items", href: "/stationery/items" }, { label: item.name }]}
        description={<><span className="font-mono">{item.code}</span> · {item.category} · <StatusBadge status={st === "OUT" ? "LOW" : st} label={st === "OUT" ? "Out of stock" : st === "LOW" ? "Low stock" : "In stock"} />{!item.isActive && <> · <Badge>Inactive</Badge></>}</>}
        actions={<>
          <LinkButton href={`/api/stationery/labels?ids=${item.id}&copies=12`} target="_blank"><QrCode className="size-4" />Print labels</LinkButton>
          {manage && <ItemFormButton suppliers={suppliers} categories={CATEGORIES} units={UNITS}
            item={{ id: item.id, code: item.code, name: item.name, category: item.category, unit: item.unit, reorderLevel: item.reorderLevel, reorderQty: item.reorderQty, unitCost: toNum(item.unitCost), preferredSupplierId: item.preferredSupplierId, isActive: item.isActive }} />}
          {manage && <ToggleItemButton id={item.id} isActive={item.isActive} />}
        </>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <CardBody>
            <DescList cols={3} items={[
              { label: "In stock", value: <b className={st !== "OK" ? "text-rose-700" : ""}>{item.currentStock} {item.unit}</b> },
              { label: "Reorder level", value: item.reorderLevel },
              { label: "Reorder quantity", value: item.reorderQty },
              { label: "Unit cost", value: money(item.unitCost) },
              { label: "Stock value", value: money(item.currentStock * toNum(item.unitCost)) },
              { label: "Usual supplier", value: item.preferredSupplier ? <Link className="text-brand-700 hover:underline" href={`/stationery/suppliers/${item.preferredSupplier.id}`}>{item.preferredSupplier.name}</Link> : "—" },
              { label: "Low-stock alert", value: item.lowStockAlertedAt ? `Sent ${fmtDate(item.lowStockAlertedAt)}` : "—" },
              { label: "On open orders", value: openPo.length ? openPo.map((l) => <Link key={l.id} href={`/stationery/purchases/${l.poId}`} className="mr-2 text-brand-700 hover:underline">{l.po.poNumber} ({l.qtyOrdered - l.qtyReceived})</Link>) : "—" },
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Compare suppliers" description="Latest price from each supplier" />
          <Table>
            <THead><tr><TH>Supplier</TH><TH align="right">Price</TH><TH>Date</TH></tr></THead>
            <TBody>
              {latest.length === 0 && <EmptyRow colSpan={3} message="No prices recorded yet." />}
              {latest.map((p, i) => (
                <TR key={p.supplierId} highlight={i === 0 && latest.length > 1 ? "green" : undefined}>
                  <TD><Link href={`/stationery/suppliers/${p.supplierId}`} className="hover:text-brand-700">{p.name}</Link>{i === 0 && latest.length > 1 && <Badge tone="green" className="ml-2">Lowest</Badge>}</TD>
                  <TD align="right">{money(p.price)}</TD>
                  <TD>{fmtDate(p.date)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Movement history" description={`${total} movement${total === 1 ? "" : "s"}`} />
          <MovementTable rows={moves} showItem={false} />
          <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath={`/stationery/items/${id}`} />
        </Card>
        <Card>
          <CardHeader title="Price history" />
          <Table>
            <THead><tr><TH>Date</TH><TH>Supplier</TH><TH align="right">Price</TH><TH>Source</TH></tr></THead>
            <TBody>
              {prices.length === 0 && <EmptyRow colSpan={4} message="No price history." />}
              {prices.map((p) => (
                <TR key={p.id}>
                  <TD>{fmtDate(p.effectiveDate)}</TD>
                  <TD>{p.supplier.name}</TD>
                  <TD align="right">{money(p.price)}</TD>
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

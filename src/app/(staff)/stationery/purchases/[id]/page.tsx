import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { itemOptions, supplierOptions, supplierPriceMap } from "@/server/stationery/lookups";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, StatusBadge, Badge, LinkButton } from "@/components/ui";
import { fmtDate, fmtDateTime, isoDate, money, toNum } from "@/lib/format";
import { FileText } from "lucide-react";
import { PoForm } from "../po-form";
import { ReceiveForm, OrderButton, CancelPoButton, ClosePoButton } from "./po-actions";
import { MovementTable, movementInclude } from "../../_components/movement-table";

export const metadata = { title: "Purchase order" };

export default async function PoDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("stationery.view");
  const { id } = await params;
  const po = await db.purchaseOrder.findFirst({ where: { id, branchId: user.branchId, type: "STATIONERY" }, include: { supplier: true, lines: { include: { stationeryItem: true }, orderBy: { id: "asc" } } } });
  if (!po) notFound();
  const manage = hasPerm(user, "stationery.manage");
  const [receipts, creator, editData] = await Promise.all([
    db.stockMovement.findMany({ where: { poId: id }, include: movementInclude, orderBy: { createdAt: "asc" } }),
    po.createdById ? db.user.findUnique({ where: { id: po.createdById }, select: { name: true } }) : null,
    manage && po.status === "DRAFT" ? Promise.all([itemOptions(user.branchId), supplierOptions(user.branchId), supplierPriceMap(user.branchId)]) : null,
  ]);
  const total = po.lines.reduce((s, l) => s + l.qtyOrdered * toNum(l.unitPrice), 0);
  const receivedValue = po.lines.reduce((s, l) => s + l.qtyReceived * toNum(l.unitPrice), 0);
  return (
    <>
      <PageHeader title={`Purchase order ${po.poNumber}`} breadcrumbs={[{ label: "Stationery", href: "/stationery" }, { label: "Purchase orders", href: "/stationery/purchases" }, { label: po.poNumber }]}
        description={<>{po.supplier.name} · <StatusBadge status={po.status} />{po.isAutoDraft && <> · <Badge tone="purple">Auto-drafted for low stock</Badge></>}</>}
        actions={<>
          <LinkButton href={`/api/stationery/po/${po.id}`} target="_blank"><FileText className="size-4" />PDF</LinkButton>
          {manage && po.status === "DRAFT" && <OrderButton id={po.id} />}
          {manage && (po.status === "DRAFT" || po.status === "ORDERED") && <CancelPoButton id={po.id} />}
          {manage && po.status === "PARTIALLY_RECEIVED" && <ClosePoButton id={po.id} />}
        </>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {manage && (po.status === "ORDERED" || po.status === "PARTIALLY_RECEIVED") && (
            <Card>
              <CardHeader title="Receive goods" description="Enter what arrived. Stock is added and the supplier price recorded." />
              <CardBody><ReceiveForm id={po.id} lines={po.lines.map((l) => ({ id: l.id, name: l.stationeryItem?.name ?? "—", unit: l.stationeryItem?.unit ?? "", ordered: l.qtyOrdered, received: l.qtyReceived }))} /></CardBody>
            </Card>
          )}
          {editData ? (
            <Card>
              <CardHeader title="Edit draft" />
              <CardBody>
                <PoForm items={editData[0]} suppliers={editData[1]} prices={editData[2]}
                  po={{ id: po.id, supplierId: po.supplierId, expectedDate: po.expectedDate ? isoDate(po.expectedDate) : "", notes: po.notes ?? "", lines: po.lines.map((l) => ({ itemId: l.stationeryItemId!, qty: l.qtyOrdered, unitPrice: toNum(l.unitPrice) })) }} />
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Lines" />
              <Table>
                <THead><tr><TH>Item</TH><TH align="right">Ordered</TH><TH align="right">Received</TH><TH align="right">Price</TH><TH align="right">Amount</TH></tr></THead>
                <TBody>
                  {po.lines.map((l) => (
                    <TR key={l.id} highlight={l.qtyReceived >= l.qtyOrdered ? "green" : l.qtyReceived > 0 ? "yellow" : undefined}>
                      <TD>{l.stationeryItem ? <Link href={`/stationery/items/${l.stationeryItem.id}`} className="font-medium text-slate-900 hover:text-brand-700">{l.stationeryItem.name}</Link> : "—"}</TD>
                      <TD align="right">{l.qtyOrdered} {l.stationeryItem?.unit}</TD>
                      <TD align="right">{l.qtyReceived}</TD>
                      <TD align="right">{money(l.unitPrice)}</TD>
                      <TD align="right">{money(l.qtyOrdered * toNum(l.unitPrice))}</TD>
                    </TR>
                  ))}
                  <TR><TD className="font-semibold">Total</TD><TD /><TD /><TD /><TD align="right" className="font-semibold">{money(total)}</TD></TR>
                </TBody>
              </Table>
            </Card>
          )}
          {receipts.length > 0 && <Card><CardHeader title="Goods received" /><MovementTable rows={receipts} /></Card>}
        </div>
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescList cols={1} items={[
              { label: "Supplier", value: <Link href={`/stationery/suppliers/${po.supplier.id}`} className="text-brand-700 hover:underline">{po.supplier.name}</Link> },
              { label: "Contact", value: [po.supplier.contactPerson, po.supplier.phone, po.supplier.email].filter(Boolean).join(" · ") || "—" },
              { label: "Order value", value: money(total) },
              { label: "Received value", value: money(receivedValue) },
              { label: "Created", value: `${fmtDateTime(po.createdAt)}${creator ? ` by ${creator.name}` : po.isAutoDraft ? " (automatic)" : ""}` },
              { label: "Ordered", value: fmtDateTime(po.orderedAt) },
              { label: "Expected", value: fmtDate(po.expectedDate) },
              { label: "Received", value: fmtDateTime(po.receivedAt) },
              { label: "Invoice no", value: po.invoiceNo },
              { label: "Notes", value: po.notes ? <span className="whitespace-pre-line">{po.notes}</span> : "—" },
            ]} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

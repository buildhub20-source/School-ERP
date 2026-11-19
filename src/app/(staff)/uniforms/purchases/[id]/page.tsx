import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, StatusBadge } from "@/components/ui";
import { fmtDate, money, round2, toNum } from "@/lib/format";
import { PoStatusButtons, ReceiveForm } from "../../_components/purchase-extra";

export const metadata = { title: "Uniform purchase" };

export default async function PurchaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("uniforms.view");
  const { id } = await params;
  const po = await db.purchaseOrder.findFirst({ where: { id, branchId: user.branchId, type: "UNIFORM" }, include: { supplier: true, lines: { include: { uniformVariant: { include: { item: true } } } } } });
  if (!po) notFound();
  const creator = po.createdById ? await db.user.findUnique({ where: { id: po.createdById }, select: { name: true } }) : null;
  const canManage = hasPerm(user, "uniforms.manage");
  const open = po.lines.filter((l) => l.qtyReceived < l.qtyOrdered);
  const receivable = canManage && ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"].includes(po.status) && open.length > 0;
  const label = (l: (typeof po.lines)[number]) => (l.uniformVariant ? `${l.uniformVariant.item.name} — ${l.uniformVariant.size}` : "—");
  return (
    <>
      <PageHeader title={`Purchase ${po.poNumber}`} description={<StatusBadge status={po.status} />} breadcrumbs={[{ label: "Uniforms", href: "/uniforms" }, { label: "Purchases", href: "/uniforms/purchases" }, { label: po.poNumber }]}
        actions={canManage && <PoStatusButtons poId={po.id} status={po.status} received={po.lines.some((l) => l.qtyReceived > 0)} />} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Items" />
            <Table>
              <THead><tr><TH>Item / size</TH><TH align="right">Ordered</TH><TH align="right">Received</TH><TH align="right">Unit cost</TH><TH align="right">Amount</TH></tr></THead>
              <TBody>
                {po.lines.map((l) => (
                  <TR key={l.id} highlight={l.qtyReceived >= l.qtyOrdered ? "green" : undefined}><TD>{label(l)}</TD><TD align="right">{l.qtyOrdered}</TD><TD align="right">{l.qtyReceived}</TD><TD align="right">{money(l.unitPrice)}</TD><TD align="right">{money(round2(l.qtyOrdered * toNum(l.unitPrice)))}</TD></TR>
                ))}
              </TBody>
            </Table>
          </Card>
          {receivable && (
            <Card><CardHeader title="Receive goods" description="Stock is added for the quantities you enter." /><CardBody><ReceiveForm poId={po.id} lines={open.map((l) => ({ id: l.id, label: label(l), left: l.qtyOrdered - l.qtyReceived }))} /></CardBody></Card>
          )}
        </div>
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescList cols={1} items={[
              { label: "Supplier", value: <>{po.supplier.name}{po.supplier.phone && <span className="block text-xs text-slate-500">{po.supplier.phone}</span>}</> },
              { label: "Total value", value: money(round2(po.lines.reduce((a, l) => a + l.qtyOrdered * toNum(l.unitPrice), 0))) },
              { label: "Ordered on", value: fmtDate(po.orderedAt) }, { label: "Expected by", value: fmtDate(po.expectedDate) }, { label: "Received on", value: fmtDate(po.receivedAt) },
              { label: "Supplier invoice", value: po.invoiceNo ?? "—" }, { label: "Created by", value: creator?.name ?? "—" },
              ...(po.notes ? [{ label: "Notes", value: po.notes }] : []),
            ]} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}

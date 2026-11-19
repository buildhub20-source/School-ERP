import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, CardBody, DescList, Table, THead, TBody, TR, TH, TD, EmptyRow, StatusBadge, Badge } from "@/components/ui";
import { fmtDate, fmtDateTime, fullName, money, round2, toNum } from "@/lib/format";
import { MODE_LABELS } from "@/server/uniforms/labels";
import { OrderTimeline } from "../../_components/timeline";
import { PaymentModal, StatusButtons, ExchangeModal, ReturnModal } from "../../_components/order-actions";

export const metadata = { title: "Uniform order" };

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("uniforms.view");
  const { id } = await params;
  const o = await db.uniformOrder.findFirst({
    where: { id, branchId: user.branchId },
    include: {
      student: { include: { schoolClass: true, section: true } }, academicYear: true,
      lines: { include: { variant: { include: { item: { include: { variants: { where: { isActive: true }, orderBy: { sizeOrder: "asc" } } } } } } }, orderBy: { id: "asc" } },
      payments: { orderBy: { paidAt: "desc" } },
      exchanges: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!o) notFound();
  const variantIds = o.exchanges.flatMap((e) => [e.fromVariantId, e.toVariantId].filter(Boolean) as string[]);
  const [exVariants, placedBy] = await Promise.all([
    db.uniformVariant.findMany({ where: { id: { in: variantIds } }, include: { item: true } }),
    o.placedById ? db.user.findUnique({ where: { id: o.placedById }, select: { name: true } }) : Promise.resolve(null),
  ]);
  const vName = (vid: string | null) => { const v = exVariants.find((x) => x.id === vid); return v ? `${v.item.name} ${v.size}` : "—"; };
  const canOrders = hasPerm(user, "uniforms.orders");
  const balance = round2(toNum(o.total) - toNum(o.paidAmount));
  const canReady = o.lines.every((l) => l.variant.stock >= l.qty - l.qtyReturned);
  const lineOpts = o.lines.filter((l) => l.qty - l.qtyReturned > 0).map((l) => ({
    id: l.id, label: `${l.variant.item.name} — size ${l.variant.size} (${l.qty - l.qtyReturned})`, open: l.qty - l.qtyReturned, unitPrice: toNum(l.unitPrice),
    options: l.variant.item.variants.filter((v) => v.id !== l.variantId).map((v) => ({ id: v.id, size: v.size, price: toNum(v.price), stock: v.stock })),
  }));
  return (
    <>
      <PageHeader title={`Order ${o.orderNo}`} breadcrumbs={[{ label: "Uniforms", href: "/uniforms" }, { label: "Orders", href: "/uniforms/orders" }, { label: o.orderNo }]}
        description={<><StatusBadge status={o.status} />{o.isPreOrder && <Badge tone="purple" className="ml-1">Pre-order {o.academicYear.name}</Badge>}</>}
        actions={canOrders && <>
          {o.status !== "CANCELLED" && balance > 0 && <PaymentModal orderId={o.id} balance={balance} />}
          <StatusButtons orderId={o.id} status={o.status} canReady={canReady} />
        </>} />
      {o.status === "PAID" && !canReady && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">Not enough stock for some sizes (highlighted). Receive a purchase or exchange the size before marking ready.</p>}
      {balance < 0 && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">₹{(-balance).toLocaleString("en-IN")} was paid in excess (after a return, exchange or cancellation). Raise a refund against the payment in Fees.</p>}
      {o.status === "CANCELLED" && toNum(o.paidAmount) > 0 && <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">This order was cancelled after ₹{toNum(o.paidAmount).toLocaleString("en-IN")} was paid. Raise a refund in Fees.</p>}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Items" actions={canOrders && lineOpts.length > 0 && <>
              {["READY", "DELIVERED"].includes(o.status) && <ExchangeModal orderId={o.id} lines={lineOpts} />}
              {o.status === "DELIVERED" && <ReturnModal orderId={o.id} lines={lineOpts} />}
            </>} />
            <Table>
              <THead><tr><TH>Item</TH><TH>Size</TH><TH align="right">Qty</TH><TH align="right">Returned</TH><TH align="right">Price</TH><TH align="right">Amount</TH>{["ORDERED", "PAID"].includes(o.status) && <TH align="right">In stock</TH>}</tr></THead>
              <TBody>
                {!o.lines.length && <EmptyRow colSpan={7} />}
                {o.lines.map((l) => {
                  const need = l.qty - l.qtyReturned;
                  const short = ["ORDERED", "PAID"].includes(o.status) && l.variant.stock < need;
                  return (
                    <TR key={l.id} highlight={short ? "yellow" : undefined}>
                      <TD className="font-medium"><Link href={`/uniforms/items/${l.variant.itemId}`} className="hover:text-brand-700">{l.variant.item.name}</Link></TD>
                      <TD>{l.variant.size}</TD>
                      <TD align="right">{l.qty}</TD>
                      <TD align="right">{l.qtyReturned || "—"}</TD>
                      <TD align="right">{money(l.unitPrice)}</TD>
                      <TD align="right">{money(need * toNum(l.unitPrice))}</TD>
                      {["ORDERED", "PAID"].includes(o.status) && <TD align="right" className={short ? "font-semibold text-rose-700" : ""}>{l.variant.stock}</TD>}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <div className="flex flex-wrap justify-end gap-6 border-t border-slate-100 px-4 py-3 text-sm">
              <span>Total <b>{money(o.total)}</b></span><span>Paid <b className="text-emerald-700">{money(o.paidAmount)}</b></span>
              <span>Balance <b className={balance > 0 ? "text-rose-700" : ""}>{money(Math.max(0, balance))}</b></span>
            </div>
          </Card>
          <Card>
            <CardHeader title="Payments" />
            <Table>
              <THead><tr><TH>Date</TH><TH>Receipt</TH><TH>Mode</TH><TH>Source</TH><TH align="right">Amount</TH><TH>Status</TH></tr></THead>
              <TBody>
                {!o.payments.length && <EmptyRow colSpan={6} message="No payments yet." />}
                {o.payments.map((p) => (
                  <TR key={p.id}>
                    <TD>{fmtDateTime(p.paidAt)}</TD><TD className="font-mono text-xs">{p.receiptNo ?? "—"}</TD><TD>{MODE_LABELS[p.mode] ?? p.mode}{p.reference && <span className="block text-xs text-slate-500">{p.reference}</span>}</TD>
                    <TD>{p.source === "ONLINE" ? "Online" : "Counter"}</TD><TD align="right">{money(p.amount)}{toNum(p.refundedAmount) > 0 && <span className="block text-xs text-amber-700">refunded {money(p.refundedAmount)}</span>}</TD><TD><StatusBadge status={p.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          {o.exchanges.length > 0 && (
            <Card>
              <CardHeader title="Exchanges & returns" />
              <Table>
                <THead><tr><TH>Date</TH><TH>Type</TH><TH>From</TH><TH>To</TH><TH align="right">Qty</TH><TH align="right">Price difference</TH><TH>Reason</TH></tr></THead>
                <TBody>
                  {o.exchanges.map((e) => (
                    <TR key={e.id}><TD>{fmtDateTime(e.createdAt)}</TD><TD>{e.type === "RETURN" ? "Return" : "Exchange"}</TD><TD>{vName(e.fromVariantId)}</TD><TD>{e.toVariantId ? vName(e.toVariantId) : "Back to stock"}</TD><TD align="right">{e.qty}</TD><TD align="right">{money(e.priceDiff)}</TD><TD>{e.reason ?? "—"}</TD></TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Student" />
            <CardBody>
              <DescList cols={1} items={[
                { label: "Name", value: hasPerm(user, "students.view") ? <Link href={`/students/${o.student.id}`} className="text-brand-700 hover:underline">{fullName(o.student)}</Link> : fullName(o.student) },
                { label: "Admission no", value: o.student.admissionNo },
                { label: "Class", value: `${o.student.schoolClass.name}${o.student.section ? ` - ${o.student.section.name}` : ""}` },
                { label: "Placed", value: `${fmtDate(o.createdAt)} · ${o.placedVia === "PARENT" ? "by parent (portal)" : `at counter${placedBy ? ` by ${placedBy.name}` : ""}`}` },
                ...(o.notes ? [{ label: "Notes", value: <span className="whitespace-pre-line">{o.notes}</span> }] : []),
              ]} />
            </CardBody>
          </Card>
          <Card><CardHeader title="Status" /><CardBody><OrderTimeline order={o} /></CardBody></Card>
        </div>
      </div>
    </>
  );
}

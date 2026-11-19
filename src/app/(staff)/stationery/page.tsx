import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { stationeryDashboard, pendingStationeryApprovals } from "@/server/stationery/dashboard";
import { MOVEMENT_LABELS } from "@/server/stationery/core";
import { PageHeader, Card, CardHeader, StatCard, Table, THead, TBody, TR, TH, TD, EmptyRow, LinkButton, Badge } from "@/components/ui";
import { money, number, fmtDateTime, fmtDate } from "@/lib/format";
import { Package, IndianRupee, AlertTriangle, ClipboardList, Plus, ScanLine, ShoppingCart } from "lucide-react";

export const metadata = { title: "Stationery" };

export default async function StationeryOverview() {
  const user = await requireUser("stationery.view");
  const [dash, pending, recent, openPos] = await Promise.all([
    stationeryDashboard(user.branchId),
    pendingStationeryApprovals(user.branchId),
    db.stockMovement.findMany({ where: { item: { branchId: user.branchId } }, include: { item: true, createdBy: { select: { name: true } }, recipientUser: { select: { name: true } }, student: { select: { firstName: true, lastName: true } }, schoolClass: true, department: true }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.purchaseOrder.count({ where: { branchId: user.branchId, type: "STATIONERY", status: { in: ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"] } } }),
  ]);
  const manage = hasPerm(user, "stationery.manage");
  return (
    <>
      <PageHeader title="Stationery" description="Stock, teacher requests, purchases and distribution."
        actions={manage && <>
          <LinkButton href="/stationery/scan"><ScanLine className="size-4" />Scan</LinkButton>
          <LinkButton href="/stationery/purchases/new?quick=1"><ShoppingCart className="size-4" />Record purchase</LinkButton>
          <LinkButton href="/stationery/issue" variant="primary"><Plus className="size-4" />Issue items</LinkButton>
        </>} />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Items" value={number(dash.totalItems)} href="/stationery/items" icon={<Package className="size-5" />} />
        <StatCard label="Stock value" value={money(dash.stockValue)} href="/reports/stationery-valuation" icon={<IndianRupee className="size-5" />} tone="green" />
        <StatCard label="Low stock" value={number(dash.lowStock.length)} hint={`${openPos} open purchase order${openPos === 1 ? "" : "s"}`} href="/stationery/items?stock=low" icon={<AlertTriangle className="size-5" />} tone={dash.lowStock.length ? "red" : "gray"} />
        <StatCard label="Pending requests" value={number(dash.pendingRequests)} href="/stationery/requests?status=PENDING" icon={<ClipboardList className="size-5" />} tone={dash.pendingRequests ? "yellow" : "gray"} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Low stock" description="At or below the reorder level" actions={<LinkButton href="/stationery/items?stock=low" size="sm">All</LinkButton>} />
          <Table>
            <THead><tr><TH>Item</TH><TH align="right">Stock</TH><TH align="right">Reorder level</TH></tr></THead>
            <TBody>
              {dash.lowStock.length === 0 && <EmptyRow colSpan={3} message="All items are above their reorder level." />}
              {dash.lowStock.slice(0, 8).map((i) => (
                <TR key={i.id} highlight={i.currentStock <= 0 ? "red" : "yellow"}>
                  <TD><Link href={`/stationery/items/${i.id}`} className="font-medium text-slate-900 hover:text-brand-700">{i.name}</Link></TD>
                  <TD align="right">{i.currentStock}</TD>
                  <TD align="right">{i.reorderLevel}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Pending teacher requests" actions={<LinkButton href="/stationery/requests?status=PENDING" size="sm">All</LinkButton>} />
          <Table>
            <THead><tr><TH>Request</TH><TH>Teacher</TH><TH>Items</TH><TH>Since</TH></tr></THead>
            <TBody>
              {pending.length === 0 && <EmptyRow colSpan={4} message="No requests waiting." />}
              {pending.slice(0, 8).map((r) => (
                <TR key={r.id}>
                  <TD><Link href={`/stationery/requests/${r.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline">{r.requestNo}</Link></TD>
                  <TD>{r.requestedBy}</TD>
                  <TD>{r.lineCount}</TD>
                  <TD>{fmtDate(r.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Recent stock movements" actions={<LinkButton href="/stationery/movements" size="sm">Full log</LinkButton>} />
          <Table>
            <THead><tr><TH>When</TH><TH>Item</TH><TH>Type</TH><TH align="right">Qty</TH><TH>To / from</TH><TH>By</TH></tr></THead>
            <TBody>
              {recent.length === 0 && <EmptyRow colSpan={6} message="No movements yet." />}
              {recent.map((m) => (
                <TR key={m.id}>
                  <TD className="whitespace-nowrap">{fmtDateTime(m.createdAt)}</TD>
                  <TD><Link href={`/stationery/items/${m.itemId}`} className="hover:text-brand-700">{m.item.name}</Link></TD>
                  <TD><Badge tone={m.qty > 0 ? "green" : "red"}>{MOVEMENT_LABELS[m.type]}</Badge></TD>
                  <TD align="right" className={m.qty > 0 ? "text-emerald-700" : "text-rose-700"}>{m.qty > 0 ? `+${m.qty}` : m.qty}</TD>
                  <TD>{m.student ? `${m.student.firstName} ${m.student.lastName ?? ""}` : m.recipientUser?.name ?? m.schoolClass?.name ?? m.department?.name ?? "—"}</TD>
                  <TD>{m.createdBy?.name ?? "System"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}

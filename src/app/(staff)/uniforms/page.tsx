import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, StatCard, Table, THead, TBody, TR, TH, TD, EmptyRow, StatusBadge, LinkButton, Badge } from "@/components/ui";
import { uniformsDashboard } from "@/server/uniforms/dashboard";
import { fmtDate, fullName, money } from "@/lib/format";
import { ClipboardList, PackageCheck, AlertTriangle, CalendarClock, Plus, Grid3x3 } from "lucide-react";

export const metadata = { title: "Uniforms" };

export default async function UniformsOverview() {
  const user = await requireUser("uniforms.view");
  const [dash, recent, preYear, counts] = await Promise.all([
    uniformsDashboard(user.branchId),
    db.uniformOrder.findMany({ where: { branchId: user.branchId }, include: { student: { include: { schoolClass: true, section: true } } }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.academicYear.findFirst({ where: { preorderOpen: true, closedAt: null }, orderBy: { startDate: "desc" } }),
    db.uniformOrder.groupBy({ by: ["status"], where: { branchId: user.branchId }, _count: true }),
  ]);
  const c = (s: string) => counts.find((x) => x.status === s)?._count ?? 0;
  return (
    <>
      <PageHeader title="Uniforms & accessories" description="Stock by size, student orders, sets, purchases and ID cards."
        actions={<>
          <LinkButton href="/uniforms/stock"><Grid3x3 className="size-4" />Size-wise stock</LinkButton>
          {hasPerm(user, "uniforms.orders") && <LinkButton href="/uniforms/orders/new" variant="primary"><Plus className="size-4" />New order</LinkButton>}
        </>} />
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open orders" value={dash.openOrders} hint={`${c("ORDERED")} awaiting payment · ${c("PAID")} paid`} href="/uniforms/orders?status=OPEN" icon={<ClipboardList className="size-5" />} />
        <StatCard label="Ready for pickup" value={dash.readyForPickup} href="/uniforms/orders?status=READY" icon={<PackageCheck className="size-5" />} tone="blue" />
        <StatCard label="Size shortages" value={dash.sizeShortages.length} hint="Below demand or reorder level" href="/uniforms/stock?gaps=1" icon={<AlertTriangle className="size-5" />} tone={dash.sizeShortages.length ? "red" : "green"} />
        <StatCard label="Pre-orders" value={preYear ? "Open" : "Closed"} hint={preYear ? `For ${preYear.name}` : "Open the window from Pre-order demand"} href="/uniforms/preorders" icon={<CalendarClock className="size-5" />} tone={preYear ? "green" : "gray"} />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recent orders" actions={<Link href="/uniforms/orders" className="text-sm font-medium text-brand-700 hover:underline">All orders</Link>} />
          <Table>
            <THead><tr><TH>Order</TH><TH>Student</TH><TH align="right">Total</TH><TH>Status</TH></tr></THead>
            <TBody>
              {!recent.length && <EmptyRow colSpan={4} message="No orders yet." />}
              {recent.map((o) => (
                <TR key={o.id}>
                  <TD><Link href={`/uniforms/orders/${o.id}`} className="font-medium text-brand-700 hover:underline">{o.orderNo}</Link><span className="block text-xs text-slate-500">{fmtDate(o.createdAt)}</span></TD>
                  <TD>{fullName(o.student)}<span className="block text-xs text-slate-500">{o.student.schoolClass.name}{o.student.section ? ` - ${o.student.section.name}` : ""}</span></TD>
                  <TD align="right">{money(o.total)}</TD>
                  <TD><StatusBadge status={o.status} />{o.isPreOrder && <Badge tone="purple" className="ml-1">Pre-order</Badge>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Size shortages" description="Stock below open demand or reorder level" actions={hasPerm(user, "uniforms.manage") && <LinkButton href="/uniforms/purchases" size="sm">Purchase</LinkButton>} />
          <Table>
            <THead><tr><TH>Item</TH><TH>Size</TH><TH align="right">In stock</TH><TH align="right">Needed</TH></tr></THead>
            <TBody>
              {!dash.sizeShortages.length && <EmptyRow colSpan={4} message="No shortages." />}
              {dash.sizeShortages.slice(0, 12).map((s, i) => (
                <TR key={i} highlight={s.stock === 0 ? "red" : "yellow"}><TD>{s.itemName}</TD><TD>{s.size}</TD><TD align="right">{s.stock}</TD><TD align="right">{s.needed}</TD></TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}

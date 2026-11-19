import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader, Card, CardHeader, CardBody, Table, THead, TBody, TR, TH, TD, EmptyRow, sp, StatCard, Badge } from "@/components/ui";
import { FilterBar, FilterSelect } from "@/components/ui/client";
import { preorderDemand } from "@/server/uniforms/queries";
import { CATEGORIES, CATEGORY_LABELS } from "@/server/uniforms/labels";
import { fmtDateTime, money } from "@/lib/format";
import { PreorderToggle } from "../_components/forms";
import { PurchaseModal } from "../_components/purchase-extra";
import { purchaseOptions } from "../_components/purchase-data";

export const metadata = { title: "Pre-order demand" };

export default async function PreordersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("uniforms.view");
  const s = await searchParams;
  const years = await db.academicYear.findMany({ where: { closedAt: null }, orderBy: { startDate: "desc" } });
  const year = years.find((y) => y.id === sp(s, "yearId")) ?? years.find((y) => y.preorderOpen) ?? years.find((y) => y.isCurrent) ?? years[0];
  const canManage = hasPerm(user, "uniforms.manage");
  if (!year) return <PageHeader title="Pre-order demand" description="No open academic year." />;
  const [rows, orders, opts] = await Promise.all([
    preorderDemand(user.branchId, year.id, { category: sp(s, "category") }),
    db.uniformOrder.groupBy({ by: ["status"], where: { branchId: user.branchId, academicYearId: year.id, isPreOrder: true }, _count: true, _sum: { total: true, paidAmount: true } }),
    canManage ? purchaseOptions(user.branchId) : Promise.resolve(null),
  ]);
  const live = orders.filter((o) => o.status !== "CANCELLED");
  const count = live.reduce((a, o) => a + o._count, 0);
  const value = live.reduce((a, o) => a + Number(o._sum.total ?? 0), 0);
  const paid = live.reduce((a, o) => a + Number(o._sum.paidAmount ?? 0), 0);
  const short = rows.filter((r) => r.shortfall > 0);
  return (
    <>
      <PageHeader title="Pre-order demand" description="Parents pre-order before the year starts; see demand by size before buying." breadcrumbs={[{ label: "Uniforms", href: "/uniforms" }, { label: "Pre-orders" }]} />
      <Card className="mb-5">
        <CardHeader title={<>Pre-order window — {year.name} {year.preorderOpen ? <Badge tone="green">Open</Badge> : <Badge>Closed</Badge>}</>}
          description={year.preorderOpen ? `Opened ${fmtDateTime(year.preorderOpensAt)}. Parents can pre-order in the portal.` : "Parents cannot pre-order until the window is opened."}
          actions={canManage && <PreorderToggle yearId={year.id} open={year.preorderOpen} />} />
        <CardBody>
          <FilterBar>
            <FilterSelect name="yearId" label={`Year: ${year.name}`} options={years.filter((y) => y.id !== year.id).map((y) => ({ value: y.id, label: y.name + (y.isCurrent ? " (current)" : "") }))} />
            <FilterSelect name="category" label="All categories" options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
          </FilterBar>
        </CardBody>
      </Card>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Pre-orders" value={count} href={`/uniforms/orders?status=ALL&type=pre`} />
        <StatCard label="Value" value={money(value)} hint={`${money(paid)} paid online/counter`} tone="green" />
        <StatCard label="Sizes short" value={short.length} hint={`${short.reduce((a, r) => a + r.shortfall, 0)} pieces to buy`} tone={short.length ? "red" : "green"} />
      </div>
      <Card>
        <CardHeader title="Demand by item and size" description="Open pre-orders plus other open orders competing for the same stock"
          actions={canManage && opts && <PurchaseModal label="Draft purchase for shortfall" defaultStatus="DRAFT" suppliers={opts.suppliers} variants={opts.variants} initial={short.map((r) => ({ variantId: r.variantId, qty: r.shortfall }))} />} />
        <Table>
          <THead><tr><TH>Item</TH><TH>Size</TH><TH align="right">Pre-orders</TH><TH align="right">Other open orders</TH><TH align="right">In stock</TH><TH align="right">Shortfall</TH></tr></THead>
          <TBody>
            {!rows.length && <EmptyRow colSpan={6} message="No open pre-orders for this year." />}
            {rows.map((r) => (
              <TR key={r.variantId} highlight={r.shortfall > 0 ? "red" : undefined}>
                <TD><Link href={`/uniforms/items/${r.itemId}`} className="font-medium hover:text-brand-700">{r.itemName}</Link></TD><TD>{r.size}</TD>
                <TD align="right">{r.preorders}</TD><TD align="right">{r.otherOpen}</TD><TD align="right">{r.stock}</TD>
                <TD align="right" className={r.shortfall ? "font-semibold text-rose-700" : ""}>{r.shortfall || "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

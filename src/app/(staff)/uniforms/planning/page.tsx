import type { UniformCategory } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { PageHeader, Card, CardHeader, Table, THead, TBody, TR, TH, TD, EmptyRow, sp, StatCard } from "@/components/ui";
import { FilterBar, FilterSelect } from "@/components/ui/client";
import { seasonalPlan } from "@/server/uniforms/queries";
import { CATEGORY_LABELS } from "@/server/uniforms/labels";
import { money } from "@/lib/format";
import { PurchaseModal } from "../_components/purchase-extra";
import { purchaseOptions } from "../_components/purchase-data";

export const metadata = { title: "Seasonal planning" };

export default async function PlanningPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("uniforms.view");
  const s = await searchParams;
  const cat = sp(s, "category");
  const categories: UniformCategory[] = cat === "SWEATER" || cat === "SHOES" ? [cat] : ["SWEATER", "SHOES"];
  const growth = Math.max(-50, Math.min(200, Number(sp(s, "growth") ?? 0) || 0));
  const shift = sp(s, "shift") !== "0";
  const canManage = hasPerm(user, "uniforms.manage");
  const [plan, opts] = await Promise.all([seasonalPlan(user.branchId, { categories, growthPercent: growth, shiftSizes: shift }), canManage ? purchaseOptions(user.branchId) : Promise.resolve(null)]);
  const short = plan.rows.filter((r) => r.shortfall > 0);
  const cost = short.reduce((a, r) => a + r.shortfall * r.lastCost, 0);
  return (
    <>
      <PageHeader title="Seasonal planning" breadcrumbs={[{ label: "Uniforms", href: "/uniforms" }, { label: "Seasonal planning" }]}
        description={plan.lastYear ? `Sweater and shoe demand for ${plan.year.name}, forecast from ${plan.lastYear.name} orders by size.` : "No previous academic year to forecast from yet."} />
      <Card className="mb-5">
        <div className="p-3">
          <FilterBar>
            <FilterSelect name="category" label="Sweaters & shoes" options={[{ value: "SWEATER", label: "Sweaters" }, { value: "SHOES", label: "Shoes" }]} />
            <FilterSelect name="shift" label={`Move sizes up ${plan.steps || "by growth steps"} (children grow)`} options={[{ value: "0", label: "Keep last year's sizes" }]} />
            <FilterSelect name="growth" label="Same number of students" options={[{ value: "5", label: "+5% students" }, { value: "10", label: "+10% students" }, { value: "20", label: "+20% students" }, { value: "-10", label: "−10% students" }]} />
          </FilterBar>
        </div>
      </Card>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Forecast pieces" value={plan.rows.reduce((a, r) => a + r.forecast, 0)} hint={`Last year: ${plan.rows.reduce((a, r) => a + r.lastYear, 0)}`} />
        <StatCard label="Shortfall" value={short.reduce((a, r) => a + r.shortfall, 0)} hint={`${short.length} sizes`} tone={short.length ? "red" : "green"} />
        <StatCard label="Estimated cost" value={money(cost)} hint="At last purchase price" tone="yellow" />
      </div>
      <Card>
        <CardHeader title="Forecast by size" description="Shortfall = forecast not yet ordered this year + orders not yet set aside − stock"
          actions={canManage && opts && <PurchaseModal label="Draft purchase for shortfall" defaultStatus="DRAFT" suppliers={opts.suppliers} variants={opts.variants} initial={short.map((r) => ({ variantId: r.variantId, qty: r.shortfall }))} />} />
        <Table>
          <THead><tr><TH>Item</TH><TH>Size</TH><TH align="right">Last year</TH><TH align="right">Forecast</TH><TH align="right">Ordered this year</TH><TH align="right">Awaiting stock</TH><TH align="right">In stock</TH><TH align="right">Shortfall</TH></tr></THead>
          <TBody>
            {!plan.rows.length && <EmptyRow colSpan={8} message="No sweater or shoe items yet." />}
            {plan.rows.map((r) => (
              <TR key={r.variantId} highlight={r.shortfall > 0 ? "red" : undefined}>
                <TD className="font-medium">{r.itemName}<span className="block text-xs text-slate-500">{CATEGORY_LABELS[r.category]}</span></TD><TD>{r.size}</TD>
                <TD align="right">{r.lastYear}</TD><TD align="right" className="font-semibold">{r.forecast}</TD><TD align="right">{r.orderedThisYear}</TD>
                <TD align="right">{r.pendingOut}</TD><TD align="right">{r.stock}</TD><TD align="right" className={r.shortfall ? "font-semibold text-rose-700" : ""}>{r.shortfall || "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}

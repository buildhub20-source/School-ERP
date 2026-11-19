import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { PageHeader, Card, CardHeader, sp, EmptyState, Badge } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { stockMatrix } from "@/server/uniforms/queries";
import { CATEGORIES, CATEGORY_LABELS, GENDER_LABELS, UNIFORM_GENDERS } from "@/server/uniforms/labels";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Size-wise stock" };

const CELL = { out: "bg-rose-100 text-rose-800 font-semibold", short: "bg-orange-100 text-orange-800 font-semibold", low: "bg-amber-50 text-amber-800", ok: "text-slate-800" };

export default async function StockMatrixPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("uniforms.view");
  const s = await searchParams;
  const groups = await stockMatrix(user.branchId, { category: sp(s, "category"), gender: sp(s, "gender"), q: sp(s, "q"), onlyGaps: sp(s, "gaps") === "1" });
  return (
    <>
      <PageHeader title="Size-wise stock" description="Item × size. Gaps and low stock are highlighted; the small number is open demand not yet set aside."
        breadcrumbs={[{ label: "Uniforms", href: "/uniforms" }, { label: "Size-wise stock" }]} />
      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3 p-3">
          <FilterBar>
            <SearchField placeholder="Item name" />
            <FilterSelect name="category" label="All categories" options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
            <FilterSelect name="gender" label="Boys, girls & unisex" options={UNIFORM_GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))} />
            <FilterSelect name="gaps" label="All items" options={[{ value: "1", label: "Only items with gaps" }]} />
          </FilterBar>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={cn("rounded px-2 py-1", CELL.out)}>Out of stock</span>
            <span className={cn("rounded px-2 py-1", CELL.short)}>Below demand</span>
            <span className={cn("rounded px-2 py-1", CELL.low)}>At/below reorder level</span>
          </div>
        </div>
      </Card>
      {!groups.length && <EmptyState title="No items match" description="Add uniform items and sizes, or change the filters." />}
      <div className="space-y-5">
        {groups.map((g) => (
          <Card key={g.category}>
            <CardHeader title={CATEGORY_LABELS[g.category]} description={`${g.rows.length} item${g.rows.length === 1 ? "" : "s"}`} />
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-0 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="sticky left-0 z-10 border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500">Item</th>
                    {g.sizes.map((z) => <th key={z.size} className="border-b border-slate-200 px-2 py-2 text-center text-xs font-semibold text-slate-600">{z.size}</th>)}
                    <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-semibold uppercase text-slate-500">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.itemId}>
                      <td className="sticky left-0 z-10 whitespace-nowrap border-b border-slate-100 bg-white px-3 py-2">
                        <Link href={`/uniforms/items/${r.itemId}`} className="font-medium text-slate-900 hover:text-brand-700">{r.name}</Link>
                        {r.gender !== "UNISEX" && <Badge className="ml-1.5" tone={r.gender === "BOY" ? "blue" : "purple"}>{GENDER_LABELS[r.gender]}</Badge>}
                      </td>
                      {g.sizes.map((z) => {
                        const c = r.cells.get(z.size);
                        if (!c) return <td key={z.size} className="border-b border-slate-100 px-2 py-2 text-center text-slate-300">·</td>;
                        return (
                          <td key={z.size} className="border-b border-slate-100 p-1 text-center" title={`Stock ${c.stock} · reorder at ${c.reorderLevel} · open demand ${c.demand}`}>
                            <div className={cn("min-w-10 rounded px-1.5 py-1 tabular-nums", CELL[c.state])}>
                              {c.stock}
                              {c.demand > 0 && <span className="block text-[10px] font-normal opacity-75">need {c.demand}</span>}
                            </div>
                          </td>
                        );
                      })}
                      <td className="border-b border-slate-100 px-3 py-2 text-right font-semibold tabular-nums">{r.totalStock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

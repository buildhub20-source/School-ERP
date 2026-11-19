import Link from "next/link";
import type { Prisma, UniformCategory, UniformGender } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/permissions";
import { db } from "@/lib/db";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, EmptyRow, Pagination, pageParams, sp, Badge, LinkButton } from "@/components/ui";
import { FilterBar, SearchField, FilterSelect } from "@/components/ui/client";
import { CATEGORIES, CATEGORY_LABELS, GENDER_LABELS, UNIFORM_GENDERS } from "@/server/uniforms/labels";
import { money, toNum } from "@/lib/format";
import { ItemModal } from "../_components/forms";
import { Upload } from "lucide-react";

export const metadata = { title: "Uniform items" };

export default async function ItemsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const user = await requireUser("uniforms.view");
  const s = await searchParams;
  const { page, pageSize, skip, take } = pageParams(s);
  const where: Prisma.UniformItemWhereInput = {
    branchId: user.branchId,
    ...(sp(s, "q") ? { OR: [{ name: { contains: sp(s, "q"), mode: "insensitive" } }, { variants: { some: { sku: { contains: sp(s, "q"), mode: "insensitive" } } } }] } : {}),
    ...(sp(s, "category") ? { category: sp(s, "category") as UniformCategory } : {}),
    ...(sp(s, "gender") ? { gender: sp(s, "gender") as UniformGender } : {}),
    isActive: sp(s, "status") === "inactive" ? false : true,
  };
  const [total, items] = await Promise.all([
    db.uniformItem.count({ where }),
    db.uniformItem.findMany({ where, include: { variants: { orderBy: { sizeOrder: "asc" } } }, orderBy: [{ category: "asc" }, { name: "asc" }], skip, take }),
  ]);
  const canManage = hasPerm(user, "uniforms.manage");
  return (
    <>
      <PageHeader title="Items & sizes" description={`${total} item${total === 1 ? "" : "s"}`} breadcrumbs={[{ label: "Uniforms", href: "/uniforms" }, { label: "Items" }]}
        actions={canManage && <><LinkButton href="/uniforms/import"><Upload className="size-4" />Import</LinkButton><ItemModal /></>} />
      <Card>
        <div className="border-b border-slate-100 p-3">
          <FilterBar>
            <SearchField placeholder="Item name or SKU" />
            <FilterSelect name="category" label="All categories" options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
            <FilterSelect name="gender" label="Any gender" options={UNIFORM_GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))} />
            <FilterSelect name="status" label="Active" options={[{ value: "inactive", label: "Inactive" }]} />
          </FilterBar>
        </div>
        <Table>
          <THead><tr><TH>Item</TH><TH>Category</TH><TH>For</TH><TH>Sizes</TH><TH align="right">Price</TH><TH align="right">Stock</TH><TH align="right">Low sizes</TH></tr></THead>
          <TBody>
            {!items.length && <EmptyRow colSpan={7} />}
            {items.map((it) => {
              const active = it.variants.filter((v) => v.isActive);
              const prices = active.map((v) => toNum(v.price));
              const low = active.filter((v) => v.stock <= 0 || (v.reorderLevel > 0 && v.stock <= v.reorderLevel)).length;
              return (
                <TR key={it.id}>
                  <TD><Link href={`/uniforms/items/${it.id}`} className="font-medium text-slate-900 hover:text-brand-700">{it.name}</Link></TD>
                  <TD>{CATEGORY_LABELS[it.category]}</TD>
                  <TD>{GENDER_LABELS[it.gender]}</TD>
                  <TD className="max-w-xs text-xs text-slate-600">{active.map((v) => v.size).join(", ") || "—"}</TD>
                  <TD align="right">{prices.length ? (Math.min(...prices) === Math.max(...prices) ? money(prices[0]) : `${money(Math.min(...prices))}–${money(Math.max(...prices))}`) : "—"}</TD>
                  <TD align="right">{active.reduce((a, v) => a + v.stock, 0)}</TD>
                  <TD align="right">{low ? <Badge tone="red">{low}</Badge> : <Badge tone="green">0</Badge>}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={s} basePath="/uniforms/items" />
      </Card>
    </>
  );
}
